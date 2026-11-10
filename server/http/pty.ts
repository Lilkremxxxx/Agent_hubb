// Interactive terminal routes (PtyManager, server/pty/manager.ts):
//   GET  /api/pty                      feature status and open terminals
//   POST /api/pty                      {cwd, account?, cols?, rows?}: new Claude Code session
//   GET  /api/pty/:id/stream           SSE: reset (screen buffer) | data | exit
//   POST /api/pty/:id/input|resize|close
//   POST /api/agents/:id/stop          stops agent (here or in another terminal)
//   POST /api/agents/:id/takeover      takes over session: stops there and resumes here
// Controlling these terminals executes commands on the machine: connections from computer itself only, with
// local Host and (when browser sends it) same-origin Origin. Request guard (http/guard.ts) already requires
// JSON on POST.
// Over the remote port only the OWNER session gets in, and only for: attach (stream), input, resize, takeover of an
// agent, and a new session (POST /api/pty, ＋ Boss included). Attach, takeover and new session each burn a single-use
// passkey step-up grant (remote/ptygrant.ts); a new-session grant is bound to its exact arguments and `boss` flag, the
// folder must be one the hub offers (inside HOME, no dot folders), and at most 3 stay open from remote. Input and
// resize need that session's stream to be open. List, close and stop stay local-only.
import { realpathSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, isAbsolute, sep } from 'node:path';
import { checkModel, checkPrompt, PtyError, type PtyManager } from '../pty/manager';
import type { PtyInfo } from '../../shared/types';
import { log } from '../log';
import { HttpError, readJson, sendJson } from './app';
import { isLoopbackHost } from './guard';
import type { SessionInfo } from './remote';
import { createTarget, PtyAccess, sessionKey } from '../remote/ptygrant';
import { tr } from '../../shared/i18n';

/** /api/agents/:id/(stop|takeover) (ids never contain '/'). */
const AGENT_ACTION_ROUTE = /^\/api\/agents\/([^/]+)\/(stop|takeover)$/;

function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.startsWith('::ffff:') ? addr.slice(7) : addr;
  return a === '::1' || a.startsWith('127.');
}

/** Rejection reason, or null. */
export function ptyRequestProblem(req: IncomingMessage): string | null {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return tr('the interactive terminal can only be used on the computer running Habblaud');
  const host = req.headers.host;
  if (!isLoopbackHost(host)) return tr('open Habblaud at http://localhost to use the interactive terminal');
  const origin = req.headers.origin;
  if (typeof origin === 'string') {
    let same = false;
    try {
      same = new URL(origin).host.toLowerCase() === String(host).trim().toLowerCase();
    } catch {
      same = false;
    }
    if (!same) return tr('origin not allowed for the interactive terminal');
  }
  // Browsers tag requests from another site (or another port on localhost = "same-site").
  const site = req.headers['sec-fetch-site'];
  if (site === 'cross-site' || site === 'same-site') return tr('origin not allowed for the interactive terminal');
  return null;
}

/** New sessions opened from the remote port stay few: this many may be running at once. */
const REMOTE_CREATE_MAX = 3;

/**
 * The real folder to open, or undefined. It must be the realpath of one of `allowed` (equal, not a prefix) and lie
 * strictly inside the realpath of `home` with no dot segment (so ~/.ssh, ~/.habblaud, ~/.config, ~/.claude, ~/.gnupg and
 * ~/.cloudflared are out, also through a symlink). No ".." in what was asked.
 */
export function remoteCwd(cwd: unknown, allowed: readonly string[], home: string): string | undefined {
  if (typeof cwd !== 'string' || !isAbsolute(cwd) || cwd.split('/').includes('..')) return undefined;
  try {
    const h = realpathSync(home);
    const real = realpathSync(cwd);
    if (h === sep || !real.startsWith(h + sep) || real.slice(h.length + 1).split(sep).some((x) => !x || x.startsWith('.'))) return undefined;
    // Room paths are reported by agents: a relative one would resolve against the hub's own cwd.
    return allowed.some((a) => { try { return isAbsolute(a) && realpathSync(a) === real; } catch { return false; } }) ? real : undefined;
  } catch {
    return undefined;
  }
}

export interface RemotePty {
  access: PtyAccess;
  sessionOf(req: IncomingMessage): SessionInfo | undefined;
  isRemote(req: IncomingMessage): boolean;
  /** New sessions from the remote port; without it POST /api/pty stays local-only. */
  create?: {
    /** Folders offered: the team folder (and the rooms' folders unless `boss`). */
    folders(boss: boolean): string[];
    accounts(): string[];
    home: string;
    /** False when the boss is not a Claude Code one (then the boss cannot be opened this way). */
    bossOk(): boolean;
    /** Appoints the session just opened as boss. */
    appoint(p: PtyInfo): { ok: boolean };
    /** Client address, for the log. */
    ip(req: IncomingMessage): string;
  };
}

export function createPtyRoutes(ptys: PtyManager, remote?: RemotePty): (req: IncomingMessage, res: ServerResponse, path: string) => void {
  /** Terminals opened from the remote port that may still be running (pruned against the manager's list on each request). */
  const remoteMade = new Set<string>();
  const fail = (res: ServerResponse, err: unknown) => {
    if (res.headersSent) return void res.destroy();
    if (err instanceof HttpError || err instanceof PtyError) sendJson(res, err.status, { error: err.message });
    else sendJson(res, 500, { error: tr('internal error') });
  };
  const notAllowed = (res: ServerResponse, allow: string) => {
    res.setHeader('Allow', allow);
    sendJson(res, 405, { error: tr('method not allowed') });
  };
  const noContent = (res: ServerResponse) => {
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
  };
  const decode = (raw: string): string => {
    try {
      return decodeURIComponent(raw);
    } catch {
      throw new HttpError(400, tr('invalid id'));
    }
  };

  /** Remote-port request (already signed in, owner with a passkey per app.ts). Checks in order; a grant is burned only after the cheap ones pass. */
  const handleRemote = async (req: IncomingMessage, res: ServerResponse, path: string, rp: RemotePty) => {
    const session = rp.sessionOf(req);
    if (!session?.owner) throw new HttpError(403, tr('only the owner can type in the terminal'));
    if (req.headers['sec-fetch-site'] !== 'same-origin') throw new HttpError(403, tr('origin not allowed for the interactive terminal'));
    const key = sessionKey(session.sig);
    const method = req.method ?? 'GET';
    const needGrant = () => new HttpError(403, tr('typing in the terminal needs a passkey check'));
    const queryGrant = new URL(req.url ?? '/', 'http://x').searchParams.get('grant');
    const take = (g: unknown, target: string) => typeof g === 'string' && rp.access.consume(g, key, target);
    if (path === '/api/pty') {
      const cr = rp.create;
      if (method !== 'POST' || !cr) throw new HttpError(403, tr('the interactive terminal can only be used on the computer running Habblaud'));
      // Owner only here; still no bigger than a full prompt needs (20 000 characters, JSON-escaped).
      const body = ((await readJson(req, 140 * 1024)) ?? {}) as Record<string, unknown>;
      // The grant comes from the body only, and any presentation burns it, also against the wrong arguments.
      if (!take(body.grant, createTarget(body) ?? '')) throw needGrant();
      const live = new Map(ptys.list().map((p) => [p.id, p]));
      for (const id of remoteMade) if (live.get(id)?.exitedAt !== undefined || !live.has(id)) remoteMade.delete(id);
      if (remoteMade.size >= REMOTE_CREATE_MAX) throw new HttpError(429, tr('limit of {0} terminals opened from remote access', [REMOTE_CREATE_MAX]));
      const boss = body.boss === true;
      if (boss && !cr.bossOk()) throw new HttpError(409, tr('the boss is an Antigravity account set in team.json'));
      const cwd = remoteCwd(body.cwd, cr.folders(boss), cr.home);
      if (!cwd) throw new HttpError(400, tr('this folder cannot be opened from remote access'));
      const account = typeof body.account === 'string' ? body.account : undefined;
      if (account !== undefined && !cr.accounts().includes(account)) throw new HttpError(400, tr('unknown account'));
      const prompt = body.prompt ?? undefined;
      const model = body.model ?? undefined;
      checkPrompt(prompt);
      checkModel(model);
      const info = ptys.create({ cwd, account, prompt, model, cols: body.cols, rows: body.rows });
      remoteMade.add(info.id);
      const ua = (req.headers['user-agent'] ?? '-').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80) || '-';
      log.info(tr('New terminal opened from remote access: {0}, {1}, folder {2}', [cr.ip(req), ua, basename(cwd).replace(/[\x00-\x1f\x7f]/g, '?')]));
      const appointed = boss ? cr.appoint(info) : undefined;
      // The owner just proved presence for this session: hand over the grant to attach it (null when 20 are outstanding: the client asks again).
      return sendJson(res, 201, { ...info, grant: rp.access.issue(key, `pty:${info.id}`) ?? null, ...(appointed ? { boss: appointed.ok } : {}) });
    }
    const action = AGENT_ACTION_ROUTE.exec(path);
    if (action) {
      if (action[2] !== 'takeover' || method !== 'POST') throw new HttpError(403, tr('the interactive terminal can only be used on the computer running Habblaud'));
      const id = decode(action[1]);
      const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
      if (!take(body.grant ?? queryGrant, `agent:${id}`)) throw needGrant();
      const info = await ptys.takeover(id, { cols: body.cols, rows: body.rows });
      // The owner just proved presence for this takeover: hand over the grant for the new terminal so it opens without a second prompt.
      // null when 20 grants are outstanding: the client then asks for a passkey check as for any attach.
      return sendJson(res, 201, { ...info, grant: rp.access.issue(key, `pty:${info.id}`) ?? null });
    }
    const m = /^\/api\/pty\/([^/]+)\/(stream|input|resize)$/.exec(path);
    if (!m) throw new HttpError(403, tr('the interactive terminal can only be used on the computer running Habblaud'));
    const id = decode(m[1]);
    if (m[2] === 'stream') {
      if (method !== 'GET') return notAllowed(res, 'GET');
      if (!take(queryGrant, `pty:${id}`)) throw needGrant();
      ptys.attach(id, req, res);
      return rp.access.open(id, key, session.exp, res);
    }
    if (method !== 'POST') return notAllowed(res, 'POST');
    if (!rp.access.live(id, key)) throw needGrant();
    const body = (await readJson(req)) as Record<string, unknown>;
    if (m[2] === 'input') ptys.input(id, body?.data);
    else ptys.resize(id, body?.cols, body?.rows);
    noContent(res);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse, path: string) => {
    if (remote?.isRemote(req)) return handleRemote(req, res, path, remote);
    const problem = ptyRequestProblem(req);
    if (problem) throw new HttpError(403, problem);
    const method = req.method ?? 'GET';
    const action = AGENT_ACTION_ROUTE.exec(path);
    if (action) {
      if (method !== 'POST') return notAllowed(res, 'POST');
      const body = (await readJson(req)) as Record<string, unknown>;
      const id = decode(action[1]);
      if (action[2] === 'stop') {
        await ptys.stop(id);
        return noContent(res);
      }
      return sendJson(res, 201, await ptys.takeover(id, { cols: body?.cols, rows: body?.rows }));
    }
    const [rawId, act] = path.slice('/api/pty'.length).split('/').filter(Boolean);
    if (!rawId) {
      if (method === 'GET') return sendJson(res, 200, { status: ptys.status(), ptys: ptys.list() });
      if (method !== 'POST') return notAllowed(res, 'GET, POST');
      const body = (await readJson(req)) as Record<string, unknown>;
      return sendJson(res, 201, ptys.create({ cwd: body?.cwd, account: body?.account, cols: body?.cols, rows: body?.rows, prompt: body?.prompt, model: body?.model }));
    }
    const id = decode(rawId);
    if (act === 'stream') {
      if (method !== 'GET') return notAllowed(res, 'GET');
      return ptys.attach(id, req, res);
    }
    if (method !== 'POST') return notAllowed(res, 'POST');
    const body = (await readJson(req)) as Record<string, unknown>;
    if (act === 'input') ptys.input(id, body?.data);
    else if (act === 'resize') ptys.resize(id, body?.cols, body?.rows);
    else if (act === 'close') ptys.close(id);
    else throw new HttpError(404, tr('unknown route'));
    noContent(res);
  };

  return (req, res, path) => {
    handle(req, res, path).catch((err) => fail(res, err));
  };
}
