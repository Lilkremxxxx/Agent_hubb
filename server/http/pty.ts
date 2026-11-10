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
// Over the remote port only the OWNER session gets in, and only for: attach (stream), input, resize, and takeover
// of an agent. Attach and takeover each burn a single-use passkey step-up grant (remote/ptygrant.ts); input and
// resize need that session's stream to be open. List, new session, close and stop stay local-only.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PtyError, type PtyManager } from '../pty/manager';
import { HttpError, readJson, sendJson } from './app';
import { isLoopbackHost } from './guard';
import type { SessionInfo } from './remote';
import { PtyAccess, sessionKey } from '../remote/ptygrant';
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

export interface RemotePty {
  access: PtyAccess;
  sessionOf(req: IncomingMessage): SessionInfo | undefined;
  isRemote(req: IncomingMessage): boolean;
}

export function createPtyRoutes(ptys: PtyManager, remote?: RemotePty): (req: IncomingMessage, res: ServerResponse, path: string) => void {
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
    const action = AGENT_ACTION_ROUTE.exec(path);
    if (action) {
      if (action[2] !== 'takeover' || method !== 'POST') throw new HttpError(403, tr('the interactive terminal can only be used on the computer running Habblaud'));
      const id = decode(action[1]);
      const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
      if (!take(body.grant ?? queryGrant, `agent:${id}`)) throw needGrant();
      const info = await ptys.takeover(id, { cols: body.cols, rows: body.rows });
      // The owner just proved presence for this takeover: hand over the grant for the new terminal so it opens without a second prompt.
      return sendJson(res, 201, { ...info, grant: rp.access.issue(key, `pty:${info.id}`) });
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
      return sendJson(res, 201, ptys.create({ cwd: body?.cwd, account: body?.account, cols: body?.cols, rows: body?.rows }));
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
