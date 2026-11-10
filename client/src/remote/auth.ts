// Browser code of the remote sign-in and Passkeys pages. Built on its own (scripts/build-server.mjs) into
// /assets/remote/auth.js; not part of the office bundle. Texts come from the server (#auth-t); nothing here reads
// cookies (the session cookie is HttpOnly) and nothing puts data into innerHTML.
export interface Texts { failed: string; cancelled: string; offline: string; unusable: string; exists: string }
export type Post = (path: string, body: unknown) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
export type Ceremony = (o: { optionsJSON: never }) => Promise<unknown>;

const P = '/api/remote/passkeys';
type Reply = { ok: boolean; status: number; body: Record<string, unknown> };

async function call(post: Post, path: string, body: unknown): Promise<Reply> {
  const r = await post(path, body);
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: j && typeof j === 'object' ? (j as Record<string, unknown>) : {} };
}
const refusal = (r: Reply, t: Texts) => (typeof r.body.error === 'string' && r.body.error) || t.failed;

const cancelled = (e: unknown, t: Texts) => {
  const n = (e as { name?: string })?.name;
  return n === 'NotAllowedError' || n === 'AbortError' ? t.cancelled : n === 'InvalidStateError' ? t.exists : t.unusable;
};

/** Once a passkey exists, a change needs a fresh passkey check. A grant, or the text to show. Never throws. */
async function stepUpGrant(post: Post, start: Ceremony, t: Texts, action: 'passkey:add' | 'passkey:del'): Promise<{ grant: string } | { error: string }> {
  try {
    const o = await call(post, '/api/remote/stepup/options', {});
    if (!o.ok) return { error: refusal(o, t) };
    let response: unknown;
    try { response = await start({ optionsJSON: o.body as never }); } catch (e) { return { error: cancelled(e, t) }; }
    const v = await call(post, '/api/remote/stepup/verify', { response, action });
    return v.ok && typeof v.body.grant === 'string' ? { grant: v.body.grant } : { error: refusal(v, t) };
  } catch { return { error: t.offline }; }
}

/** Options, ceremony, verify. undefined = done; a string = the text to show. Never throws. `stepup`: a passkey exists already. */
async function ceremony(post: Post, start: Ceremony, t: Texts, base: string, name?: string, stepup = false): Promise<string | undefined> {
  try {
    let first: unknown = {};
    if (stepup) {
      const g = await stepUpGrant(post, start, t, 'passkey:add');
      if ('error' in g) return g.error;
      first = { grant: g.grant };
    }
    const o = await call(post, `${P}/${base}/options`, first);
    if (!o.ok) return refusal(o, t);
    let res: unknown;
    try { res = await start({ optionsJSON: o.body as never }); } catch (e) { return cancelled(e, t); }
    const v = await call(post, `${P}/${base}/verify`, name === undefined ? res : { response: res, name });
    return v.ok ? undefined : refusal(v, t);
  } catch { return t.offline; }
}

export const signInWithPasskey = (post: Post, start: Ceremony, t: Texts) => ceremony(post, start, t, 'login');
export const addPasskey = (name: string, post: Post, start: Ceremony, t: Texts, stepup = false) => ceremony(post, start, t, 'register', name, stepup);

export async function removePasskey(id: string, post: Post, start: Ceremony, t: Texts, stepup = false): Promise<string | undefined> {
  let grant: string | undefined;
  if (stepup) {
    const g = await stepUpGrant(post, start, t, 'passkey:del');
    if ('error' in g) return g.error;
    grant = g.grant;
  }
  try {
    const d = await call(post, `${P}/delete`, grant ? { id, grant } : { id });
    return d.ok ? undefined : refusal(d, t);
  } catch { return t.offline; }
}

export async function signInWithPassword(user: string, password: string, post: Post, t: Texts): Promise<string | undefined> {
  try {
    const r = await call(post, '/api/remote/login', { user, password });
    return r.ok ? undefined : refusal(r, t);
  } catch { return t.offline; }
}

async function main(): Promise<void> {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
  const t = JSON.parse($('auth-t')?.textContent || '{}') as Texts & Record<string, string>;
  let lastStatus = 0;
  const post: Post = async (path, body) => {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
    lastStatus = r.status;
    return r;
  };
  const err = $('err')!;
  const show = (m?: string) => { err.textContent = m ?? ''; };
  // Loaded only when a passkey is used, so the password form works (and never submits natively) without it.
  const startAuth: Ceremony = async (o) => (await import('@simplewebauthn/browser')).startAuthentication(o as never);
  const startReg: Ceremony = async (o) => (await import('@simplewebauthn/browser')).startRegistration(o as never);
  const busy = (b: HTMLButtonElement | null, on: boolean) => { if (b) b.disabled = on; };

  if (document.body.dataset.page === 'login') {
    const pk = $<HTMLButtonElement>('pk');
    pk?.addEventListener('click', async () => {
      busy(pk, true); show();
      const m = await signInWithPasskey(post, startAuth, t);
      if (m === undefined) return location.replace('/');
      show(m); busy(pk, false);
    });
    const f = $<HTMLFormElement>('f');
    f?.addEventListener('submit', async (e) => {
      e.preventDefault(); // first thing, synchronously: a native submit must never carry the password in a URL
      const b = $<HTMLButtonElement>('b'); busy(b, true); show();
      const m = await signInWithPassword((f.elements.namedItem('username') as HTMLInputElement).value, (f.elements.namedItem('password') as HTMLInputElement).value, post, t);
      if (m === undefined) return location.replace('/');
      show(m); busy(b, false);
    });
    return;
  }

  // Passkeys page
  const list = $('list')!, again = $<HTMLButtonElement>('again')!, add = $<HTMLButtonElement>('add')!;
  let count = 0; // passkeys registered: once there is one, changes need a passkey check
  const fail = (m: string) => { show(m); again.hidden = lastStatus !== 403 && lastStatus !== 401; };
  const load = async () => {
    try {
      const r = await fetch(P, { credentials: 'same-origin' });
      if (r.status === 401) return location.replace('/login'); // session gone
      if (!r.ok) { lastStatus = r.status; return fail(t.loadFail); }
      const items = ((await r.json()) as { passkeys?: Array<{ id: string; name: string; createdAt: number }> }).passkeys ?? [];
      count = items.length;
      list.replaceChildren(...(items.length ? items : [{ id: '', name: t.none, createdAt: 0 }]).map((p) => {
        const li = document.createElement('li'), s = document.createElement('span');
        s.textContent = p.name;
        if (p.createdAt) { const d = document.createElement('small'); d.textContent = new Date(p.createdAt).toLocaleString(document.documentElement.lang); s.append(d); }
        li.append(s);
        if (p.id) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'ghost small'; b.textContent = t.remove;
          b.addEventListener('click', async () => {
            busy(b, true); show();
            const m = await removePasskey(p.id, post, startAuth, t, items.length > 0);
            if (m !== undefined) { fail(m); busy(b, false); return; }
            show(t.removed); again.hidden = true; await load();
          });
          li.append(b);
        }
        return li;
      }));
    } catch { fail(t.offline); }
  };
  add.addEventListener('click', async () => {
    busy(add, true); show();
    const name = ($<HTMLInputElement>('n')!.value.trim() || t.defaultName).slice(0, 60);
    const m = await addPasskey(name, post, startReg, t, count > 0);
    busy(add, false);
    if (m !== undefined) return fail(m);
    show(t.added); again.hidden = true; await load();
  });
  // A change needs a sign-in from the last 10 minutes: drop the session and go back to the login page.
  again.addEventListener('click', async () => {
    try { await post('/api/remote/logout', {}); } catch { /* the login page will tell */ }
    location.replace('/login');
  });
  await load();
}

if (typeof document !== 'undefined') void main();
