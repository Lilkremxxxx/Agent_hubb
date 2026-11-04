// Browser code of the remote sign-in and Passkeys pages. Built on its own (scripts/build-server.mjs) into
// /assets/remote/auth.js; not part of the office bundle. Texts come from the server (#auth-t); nothing here reads
// cookies (the session cookie is HttpOnly) and nothing puts data into innerHTML.
export interface Texts { failed: string; cancelled: string; offline: string }
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

/** Options, ceremony, verify. undefined = done; a string = the text to show. Never throws. */
async function ceremony(post: Post, start: Ceremony, t: Texts, base: string, name?: string): Promise<string | undefined> {
  try {
    const o = await call(post, `${P}/${base}/options`, {});
    if (!o.ok) return refusal(o, t);
    let res: unknown;
    try { res = await start({ optionsJSON: o.body as never }); } catch { return t.cancelled; }
    const v = await call(post, `${P}/${base}/verify`, name === undefined ? res : { response: res, name });
    return v.ok ? undefined : refusal(v, t);
  } catch { return t.offline; }
}

export const signInWithPasskey = (post: Post, start: Ceremony, t: Texts) => ceremony(post, start, t, 'login');
export const addPasskey = (name: string, post: Post, start: Ceremony, t: Texts) => ceremony(post, start, t, 'register', name);

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
  const lib = await import('@simplewebauthn/browser');
  const startAuth = lib.startAuthentication as unknown as Ceremony;
  const startReg = lib.startRegistration as unknown as Ceremony;
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
      e.preventDefault();
      const b = $<HTMLButtonElement>('b'); busy(b, true); show();
      const m = await signInWithPassword((f.elements.namedItem('username') as HTMLInputElement).value, (f.elements.namedItem('password') as HTMLInputElement).value, post, t);
      if (m === undefined) return location.replace('/');
      show(m); busy(b, false);
    });
    return;
  }

  // Passkeys page
  const list = $('list')!, again = $<HTMLButtonElement>('again')!, add = $<HTMLButtonElement>('add')!;
  const fail = (m: string) => { show(m); again.hidden = lastStatus !== 403; };
  const load = async () => {
    try {
      const r = await fetch(P, { credentials: 'same-origin' });
      if (!r.ok) return fail(t.loadFail);
      const items = ((await r.json()) as { passkeys?: Array<{ id: string; name: string; createdAt: number }> }).passkeys ?? [];
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
            try {
              const d = await call(post, `${P}/delete`, { id: p.id });
              if (!d.ok) { fail(refusal(d, t)); busy(b, false); return; }
            } catch { fail(t.offline); busy(b, false); return; }
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
    const name = ($<HTMLInputElement>('n')!.value.trim() || 'Passkey').slice(0, 60);
    const m = await addPasskey(name, post, startReg, t);
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
