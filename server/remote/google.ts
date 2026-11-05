// "Sign in with Google" for the remote port: OAuth authorization-code flow with PKCE (S256), state and nonce.
// Only the hub domain is ever used to build the redirect URI (never the Host header). Active only when the domain, the
// Google client id and secret, and a non-empty email allowlist are all configured (hub.env, written by remote:setup).
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const GOOGLE_COOKIE = '__Host-habblaud_oauth';
export const GOOGLE_COOKIE_S = 600; // 10 minutes
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// hub.env is read by sh and systemd: every value is validated here (and single-quoted when written).
export const GOOGLE_ID_RE = /^[A-Za-z0-9._-]{10,200}$/;
export const GOOGLE_SECRET_RE = /^[A-Za-z0-9._~-]{8,200}$/;
export const GOOGLE_EMAIL_RE = /^[a-z0-9._+-]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** Lower-case addresses allowed to sign in (exact match). */
  emails: ReadonlySet<string>;
  redirectUri: string;
}

export const googleRedirectUri = (domain: string): string => `https://${domain}/api/remote/google/callback`;

/** Config from env, or undefined (silently off) unless the domain and all three Google keys are present and valid. */
export function parseGoogleConfig(env: NodeJS.ProcessEnv, domain: string | undefined): GoogleConfig | undefined {
  const clientId = env.HABBLAUD_REMOTE_GOOGLE_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.HABBLAUD_REMOTE_GOOGLE_CLIENT_SECRET?.trim() ?? '';
  const emails = (env.HABBLAUD_REMOTE_GOOGLE_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!domain || !GOOGLE_ID_RE.test(clientId) || !GOOGLE_SECRET_RE.test(clientSecret)) return undefined;
  if (!emails.length || !emails.every((e) => GOOGLE_EMAIL_RE.test(e))) return undefined;
  return { clientId, clientSecret, emails: new Set(emails), redirectUri: googleRedirectUri(domain) };
}

const b64 = (n: number): string => randomBytes(n).toString('base64url');
const eq = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export const maskEmail = (email: string): string => {
  const [local = '', host = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${host}`;
};

export type GoogleResult = { ok: true; email: string } | { ok: false; reason: string };

export class GoogleAuth {
  private readonly key: Buffer;
  /** State -> cookie expiry, for states already used (a replayed cookie finds its state here). */
  private readonly used = new Map<string, number>();

  constructor(
    readonly cfg: GoogleConfig,
    secret: Buffer,
    private readonly opts: { fetch?: typeof fetch; now?: () => number; timeoutMs?: number } = {},
  ) {
    this.key = createHmac('sha256', secret).update('google-oauth-v1').digest();
  }

  private now(): number { return (this.opts.now ?? Date.now)(); }
  private sign(p: string): string { return createHmac('sha256', this.key).update(p).digest('base64url'); }

  /** Where to send the browser, and the value of the short-lived signed cookie that pairs the callback with it. */
  start(): { location: string; cookie: string } {
    const state = b64(32);
    const verifier = b64(32);
    const nonce = b64(16);
    const payload = `${state}.${verifier}.${nonce}.${this.now() + GOOGLE_COOKIE_S * 1000}`;
    const q = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      response_type: 'code',
      scope: 'openid email',
      prompt: 'select_account',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    return { location: `${AUTH_URL}?${q}`, cookie: `${payload}.${this.sign(payload)}` };
  }

  async finish(q: { code?: string; state?: string; error?: string }, cookie: string | undefined): Promise<GoogleResult> {
    const no = (reason: string): GoogleResult => ({ ok: false, reason });
    if (q.error) return no('denied');
    if (!q.code || !q.state || q.code.length > 2048 || q.state.length > 256) return no('params');
    const m = /^([\w-]{43})\.([\w-]{43})\.([\w-]{22})\.(\d{10,16})\.([\w-]{43})$/.exec(cookie ?? '');
    if (!m) return no('cookie');
    const [, state, verifier, nonce, exp, sig] = m;
    if (!eq(sig, this.sign(`${state}.${verifier}.${nonce}.${exp}`))) return no('cookie');
    const now = this.now();
    if (Number(exp) <= now) return no('cookie');
    for (const [s, e] of this.used) if (e <= now) this.used.delete(s);
    if (this.used.has(state)) return no('replay');
    if (!eq(q.state, state)) return no('state');
    this.used.set(state, Number(exp)); // single use, from here on whatever happens

    let idToken: unknown;
    try {
      const res = await (this.opts.fetch ?? fetch)(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: q.code,
          client_id: this.cfg.clientId,
          client_secret: this.cfg.clientSecret,
          code_verifier: verifier,
          redirect_uri: this.cfg.redirectUri,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
      });
      const text = await res.text();
      if (!res.ok || text.length > 64 * 1024) return no('exchange');
      idToken = (JSON.parse(text) as { id_token?: unknown }).id_token;
    } catch {
      return no('exchange');
    }
    if (typeof idToken !== 'string') return no('token');

    // The id_token came straight from Google's token endpoint over TLS, so its signature check may be skipped
    // (OIDC Core 3.1.3.7); the claims below are still verified.
    const parts = idToken.split('.');
    let c: Record<string, unknown>;
    try {
      c = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
    } catch {
      return no('token');
    }
    if (parts.length !== 3 || !c || typeof c !== 'object') return no('token');
    if (c.iss !== 'https://accounts.google.com' && c.iss !== 'accounts.google.com') return no('iss');
    if (c.aud !== this.cfg.clientId) return no('aud');
    if (typeof c.exp !== 'number' || c.exp * 1000 <= now) return no('exp');
    if (typeof c.nonce !== 'string' || !eq(c.nonce, nonce)) return no('nonce');
    if (c.email_verified !== true) return no('unverified');
    const email = typeof c.email === 'string' ? c.email.toLowerCase() : '';
    if (!this.cfg.emails.has(email)) return no('email');
    return { ok: true, email };
  }
}
