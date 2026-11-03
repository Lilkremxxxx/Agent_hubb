// API routes (/api/*). JSON responses; unknown routes -> 404 JSON.
import type { OfficeRules, RuleFor } from '../../shared/rules';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NAME_MAX, parseAppearanceParts, parseCharacterName, parseSeed } from '../../shared/appearance';
import type { AccessInfo, PtyInfo, SourceInfo, WorkerJob } from '../../shared/types';
import type { AccountsService } from '../accounts/service';
import type { Office } from '../model/office';
import type { SessionLookup } from '../sources/source';
import { isJsonContentType, isLoopbackHost } from './guard';
import type { RemoteFeature } from './remote';
import { handleSessionsRoute } from './sessions';
import type { Hub } from './sse';
import type { TerminalStreams } from './terminal';
import type { AgyJobResult, AgyMode } from '../sources/agy/source';
import type { OfficeResult, TeamResult } from '../team';
import type { PlanEditResult } from '../board';
import type { PlanEdit } from '../sources/handoff';
import { errMsg } from '../log';
import type { AskInput, AskResult } from '../workers/service';
import { tr } from '../../shared/i18n';
import type { SpawnService } from '../spawn/spawn';
import { ATTACHMENT_BODY_MAX, parseAttachment, type AttachmentStore } from '../spawn/attachments';
import type { SpawnFolder } from '../spawn/folders';

export interface ApiDeps {
  office: Office;
  hub: Hub;
  accounts: AccountsService;
  sources: () => SourceInfo[];
  version: string;
  inDocker: boolean;
  /** Terminal enabled (ServerConfig.terminal: local bind only). */
  terminal?: boolean;
  /** Terminal streams; without them the feature is disabled even with `terminal`. */
  terminals?: TerminalStreams;
  /**
   * Terminal session history (GET /api/sessions/*, http/sessions.ts): HistorySet of all tools
   * (or a single provider); same lock as terminal.
   */
  sessions?: SessionLookup;
  /**
   * Interactive terminal and agent actions (/api/pty/*, POST /api/agents/:id/stop|takeover; http/pty.ts).
   * Missing = disabled (without HABBLAUD_PTY=1, Docker, without node-pty, or without local bind).
   */
  pty?: (req: IncomingMessage, res: ServerResponse, path: string) => void;
  /** New agent from the office (/api/spawn and, for host helper, /api/host/spawn/*; server/spawn/spawn.ts). */
  spawn?: SpawnService;
  /** Suggested folders in "New agent" (GET /api/spawn/folders; spawn/folders.ts): recent projects. */
  spawnFolders?: () => Promise<SpawnFolder[]>;
  /** Attachments for "New agent" (POST /api/spawn/attachments; spawn/attachments.ts). */
  attachments?: AttachmentStore;
  /**
   * Renames room (POST /api/rooms/rename {id, name}; empty restores default). Returns active name, or undefined
   * if room does not exist.
   */
  renameRoom?: (id: string, name: string) => string | undefined;
  /**
   * Antigravity workers in manual mode (POST /api/agy/jobs {agentId, prompt, mode, role?} and POST /api/agy/stop
   * {agentId}): same lock as terminal (local bind + local Host), never via remote access.
   */
  agy?: {
    assign: (agentId: string, job: { prompt: string; mode?: AgyMode; role?: string; effort?: string }) => AgyJobResult;
    stop: (agentId: string) => number;
    /** POST /api/agy/defaults {agentId, mode?, effort?}: the worker's defaults for jobs that do not say. */
    setDefaults: (agentId: string, d: { mode?: string; effort?: string }) => AgyJobResult;
  };
  /** Accounts dialog: add and sign in accounts (/api/accounts/*, http/accounts.ts); only with the interactive terminal. */
  accountsApi?: (req: IncomingMessage, res: ServerResponse, path: string) => void;
  /**
   * POST /api/board/todo {room | office, mtime, edit}: edits a room's to-do list in its HANDOFF file, or that of an
   * office's folder (server/board.ts).
   */
  editPlan?: (target: { room: string } | { office: string }, mtime: number | undefined, edit: PlanEdit) => PlanEditResult;
  /** POST /api/team: appoints the boss or (un)registers a worker (server/team.ts); this computer only. */
  team?: {
    /** `office`: OfficeInfo.id (undefined = the first office). */
    appoint: (office: string | undefined, agentId: string | null, pending?: { account: string }) => TeamResult;
    setWorker: (office: string | undefined, acc: string, on: boolean) => TeamResult;
    /** "＋ Boss" with an Antigravity account: appoints it and opens its terminal (in the office's folder). */
    appointAgy?: (office: string | undefined, acc: string, cwd?: string) => Promise<{ ok: true; pty?: PtyInfo } | { ok: false; status: number; error: string }>;
    createOffice: (name: string, folder: string) => OfficeResult;
    renameOffice: (office: string | undefined, name: string) => TeamResult;
    setFolder: (office: string | undefined, folder: string) => TeamResult;
    deleteOffice: (office: string) => TeamResult;
    /** Office rules (shared/rules.ts): the user saves them; a boss proposes one; the user accepts or rejects it. */
    setRules?: (office: string | undefined, rules: unknown, rev: number) => TeamResult;
    proposeRule?: (office: string | undefined, p: { text: string; for?: RuleFor; why?: string; by?: string }) => TeamResult;
    decideRule?: (office: string | undefined, id: string, accept: boolean) => TeamResult;
    /** GET /api/team/rules?office=&who=: what a script needs (tools/agy). */
    rulesView?: (office: string | undefined, who: 'boss' | 'workers') => { office: string; name: string; folder: string; rules: OfficeRules; text: string } | undefined;
  };
  /** Worker terminals (/api/workers/*, server/workers): jobs, cancel; this computer only. */
  workers?: {
    ask: (input: AskInput) => Promise<AskResult>;
    waitJob: (id: string, waitS: number) => Promise<WorkerJob | undefined>;
    cancel: (p: { job?: string; worker?: string; all?: boolean }) => number;
  };
  /**
   * Remote port with login (http/remote.ts): `is` indicates if request arrived through it (already authenticated);
   * `allows`, what HABBLAUD_REMOTE_ALLOW allows. Remote request never trusted by Host: only by what `allows` permits.
   */
  remote?: { is(req: IncomingMessage): boolean; allows(feature: RemoteFeature): boolean };
  /**
   * Habblaud World routes (/api/world/*, server/world/http.ts). Missing = HABBLAUD_WORLD=0: 404 on all. Local port
   * with local Host only: never via mobile port, even with login (403 `local_only`).
   */
  world?: (req: IncomingMessage, res: ServerResponse, url: URL) => void;
}

/** GET /api/agents/:id/terminal (ids never contain '/'). */
const TERMINAL_ROUTE = /^\/api\/agents\/([^/]+)\/terminal$/;
/** POST /api/agents/:id/stop|takeover (interactive terminal). */
const AGENT_ACTION_ROUTE = /^\/api\/agents\/[^/]+\/(stop|takeover)$/;

/** PUT|DELETE /api/agents/:id/character: project character (see Office.setCharacter). */
const CHARACTER_ROUTE = /^\/api\/agents\/([^/]+)\/character$/;
const NOT_EDITABLE = tr('agent not found: only the main agent of an open session has an editable character');

/** Connection from the computer itself (127.x, ::1, or ::ffff:127.x). */
function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/i, '');
  return a === '::1' || /^127\./.test(a);
}

/** Host helper routes: local port only; remote port denied even with login. */
function isLocalOnlyPath(path: string): boolean {
  return path.startsWith('/api/host/');
}

const MAX_BODY = 256 * 1024;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    // The API is only read by the page itself: no "no-cors" reads by other origins.
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  res.end(data);
}

/** Reads JSON body. Requires `Content-Type: application/json` (CSRF barrier; see http/guard.ts). */
export function readJson(req: IncomingMessage, max = MAX_BODY): Promise<unknown> {
  if (!isJsonContentType(req.headers['content-type'])) {
    req.resume();
    return Promise.reject(new HttpError(415, tr('send the body as JSON (Content-Type: application/json)')));
  }
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      // Too large: keep draining (without storing) to respond with 413.
      if (size > max) return void fail(new HttpError(413, tr('body too large')));
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > max) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return ok({});
      try {
        ok(JSON.parse(raw));
      } catch {
        fail(new HttpError(400, tr('invalid JSON')));
      }
    });
    req.on('error', fail);
  });
}

/** Returns a handler that processes /api/* and returns false for the rest. */
export function createApiHandler(deps: ApiDeps): (req: IncomingMessage, res: ServerResponse, url: URL) => boolean {
  const { office, hub, accounts } = deps;
  const terminals = deps.terminal ? deps.terminals : undefined;

  const isRemote = (req: IncomingMessage): boolean => !!deps.remote?.is(req);
  /**
   * "From the computer itself" lock: on local port, Host must be loopback (as before); on remote port, only
   * what HABBLAUD_REMOTE_ALLOW permits (missing `feature` = never on remote port).
   */
  const trusted = (req: IncomingMessage, feature?: RemoteFeature): boolean =>
    isRemote(req) ? !!feature && !!deps.remote?.allows(feature) : isLoopbackHost(req.headers.host);
  const denied = (req: IncomingMessage, localMessage: string): string =>
    isRemote(req) ? tr('not allowed over remote access (see HABBLAUD_REMOTE_ALLOW)') : localMessage;

  const methodNotAllowed = (res: ServerResponse, allow: string) => {
    res.setHeader('Allow', allow);
    sendJson(res, 405, { error: tr('method not allowed') });
  };

  const handleCharacter = async (req: IncomingMessage, res: ServerResponse, id: string, method: string) => {
    if (method === 'DELETE') {
      req.resume();
      if (office.resetCharacter(id) === 'not-found') return sendJson(res, 404, { error: NOT_EDITABLE });
      return sendJson(res, 200, { ok: true });
    }
    const body = (await readJson(req)) as { name?: unknown; seed?: unknown; parts?: unknown } | null;
    const name = parseCharacterName(body?.name);
    const seed = parseSeed(body?.seed);
    const parts = parseAppearanceParts(body?.parts);
    if (!name || seed === null || !parts) {
      throw new HttpError(400, tr('expected {name: text of 1 to {0} characters, seed: integer from 0 to 4294967295, parts: appearance parts}', [NAME_MAX]));
    }
    const r = office.setCharacter(id, { name, seed, parts });
    if (r.result === 'not-found') return sendJson(res, 404, { error: NOT_EDITABLE });
    if (r.result === 'conflict') return sendJson(res, 409, { error: r.message });
    sendJson(res, 200, { ok: true });
  };

  const fail = (res: ServerResponse, err: unknown) => {
    if (res.headersSent) return void res.destroy();
    if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
    else sendJson(res, 500, { error: tr('internal error') });
  };

  const waitOf = (url: URL): number => Math.max(0, Math.min(60, Number(url.searchParams.get('wait')) || 0));

  /** /api/workers/*: ask, jobs/<id>, cancel (server/workers/service.ts). */
  const handleWorkers = async (req: IncomingMessage, res: ServerResponse, url: URL, method: string, w: NonNullable<ApiDeps['workers']>): Promise<void> => {
    const sub = url.pathname.slice('/api/workers/'.length);
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    if (sub.startsWith('jobs/')) {
      if (method !== 'GET') return methodNotAllowed(res, 'GET');
      const job = await w.waitJob(decodeURIComponent(sub.slice(5)), waitOf(url));
      if (!job) throw new HttpError(404, tr('job not found'));
      return sendJson(res, 200, { job });
    }
    if (method !== 'POST') return methodNotAllowed(res, 'POST');
    const b = ((await readJson(req)) ?? {}) as Record<string, unknown>;
    if (sub === 'ask') {
      const worker = str(b.worker);
      const prompt = typeof b.prompt === 'string' ? b.prompt : '';
      if (!worker) throw new HttpError(400, tr('expected {worker, prompt}'));
      const by = b.by === 'boss' || b.by === 'you' || b.by === 'script' ? b.by : undefined;
      const input: AskInput = { worker, prompt };
      for (const k of ['cwd', 'role', 'mode', 'effort', 'office'] as const) {
        const v = str(b[k]);
        if (v) input[k] = v;
      }
      if (input.role && !/^[\p{L}\p{N}_-]{1,24}$/u.test(input.role)) throw new HttpError(400, tr('invalid role (up to 24 letters, digits, - or _)'));
      if (input.mode && !['plan', 'default', 'accept-edits', 'auto'].includes(input.mode)) throw new HttpError(400, tr('unknown mode'));
      if (input.effort && !['low', 'medium', 'high', 'xhigh', 'max'].includes(input.effort)) throw new HttpError(400, tr('unknown effort'));
      const model = str(b.model);
      if (model) {
        if (!/^[\w.][\w.:[\]-]{0,63}$/.test(model)) throw new HttpError(400, tr('invalid model'));
        input.model = model;
      }
      if (typeof b.max === 'number') input.max = b.max;
      if (b.lean === true) input.lean = true;
      if (by) input.by = by;
      if (typeof b.callerPid === 'number') input.callerPid = b.callerPid;
      const r = await w.ask(input);
      if (r.ok) return sendJson(res, 200, { job: r.job });
      if (r.busy) return sendJson(res, 409, { status: 'BUSY', reason: r.busy, message: r.error, error: r.error });
      throw new HttpError(r.status, r.error);
    }
    if (sub === 'cancel') {
      const p = b.all === true ? { all: true } : str(b.job) ? { job: str(b.job) } : str(b.worker) ? { worker: str(b.worker) } : undefined;
      if (!p) throw new HttpError(400, tr('expected {job}, {worker} or {all: true}'));
      return sendJson(res, 200, { ok: true, cancelled: w.cancel(p) });
    }
    throw new HttpError(404, tr('unknown route'));
  };

  return (req, res, url) => {
    const path = url.pathname;
    if (path !== '/api' && !path.startsWith('/api/')) return false;
    const method = req.method ?? 'GET';
    const isRead = method === 'GET' || method === 'HEAD';

    if (isRemote(req) && isLocalOnlyPath(path)) {
      req.resume();
      sendJson(res, 403, { error: tr('route only for the computer running Habblaud (hooks, plugins and the host helper)') });
      return true;
    }
    if (path === '/api/world' || path.startsWith('/api/world/')) {
      // Habblaud World account acts on your behalf: only from the computer itself, like terminal. Local Host
      // alone is not enough (Tailscale arrives over loopback and Host can be forged): remote port never allowed,
      // even with login.
      if (!deps.world) {
        req.resume();
        sendJson(res, 404, { error: tr('unknown route') });
      } else if (isRemote(req) || !isLoopbackHost(req.headers.host)) {
        req.resume();
        sendJson(res, 403, { error: { code: 'local_only', message: tr('Habblaud World can only be used from this computer (http://localhost)') } });
      } else deps.world(req, res, url);
      return true;
    }
    if (path === '/api/stream') {
      if (method !== 'GET') methodNotAllowed(res, 'GET');
      else hub.attach(req, res);
      return true;
    }
    if (path === '/api/snapshot') {
      if (!isRead) methodNotAllowed(res, 'GET');
      else sendJson(res, 200, hub.current());
      return true;
    }
    if (path === '/api/health') {
      if (!isRead) methodNotAllowed(res, 'GET');
      else {
        const remote = isRemote(req);
        sendJson(res, 200, {
          ok: true,
          version: deps.version,
          docker: deps.inDocker,
          remote,
          terminal: !!terminals && (!remote || trusted(req, 'terminal')),
          // Interactive terminal (pty) is never allowed over remote port.
          pty: !!deps.pty && !remote,
          sources: deps.sources(),
          accounts: accounts.allEntries().map((a) =>
            a.provider === 'claude'
              ? { id: a.id, usageStatus: accounts.usageView(a.id).status }
              : { id: a.id, provider: a.provider, usageStatus: accounts.usageView(a.id).status },
          ),
        });
      }
      return true;
    }
    if (path === '/api/access') {
      if (!isRead) methodNotAllowed(res, 'GET');
      else {
        const remote = isRemote(req);
        const access: AccessInfo = {
          remote,
          local: !remote && isLoopbackHost(req.headers.host),
          terminal: !!terminals && trusted(req, 'terminal'),
          spawn: !!deps.spawn && trusted(req, 'spawn'),
          world: !!deps.world && !!deps.terminal && !remote && isLoopbackHost(req.headers.host),
        };
        sendJson(res, 200, access);
      }
      return true;
    }
    const terminalMatch = TERMINAL_ROUTE.exec(path);
    if (terminalMatch) {
      if (method !== 'GET') methodNotAllowed(res, 'GET');
      else if (!terminals) {
        sendJson(res, 403, { error: tr('terminal disabled: it only works when Habblaud is reachable only from the computer running it') });
      } else if (!trusted(req, 'terminal')) {
        sendJson(res, 403, { error: denied(req, tr('the terminal only opens from the computer running Habblaud (http://localhost or http://127.0.0.1)')) });
      } else {
        let id: string;
        try {
          id = decodeURIComponent(terminalMatch[1]);
        } catch {
          sendJson(res, 400, { error: tr('invalid id') });
          return true;
        }
        terminals.attach(req, res, id);
      }
      return true;
    }
    if (path.startsWith('/api/sessions/')) {
      handleSessionsRoute(req, res, path, {
        history: deps.terminal ? deps.sessions : undefined,
        terminals,
        trusted: isRemote(req) ? trusted(req, 'terminal') : undefined,
      });
      return true;
    }
    if (path === '/api/pty' || path.startsWith('/api/pty/') || AGENT_ACTION_ROUTE.test(path)) {
      // Runs commands on host: never over remote port, even with login (Host and remote address are not
      // sufficient: Tailscale arrives over loopback and Host can be forged).
      if (isRemote(req)) sendJson(res, 403, { error: tr('the interactive terminal can only be used on the computer running Habblaud') });
      else if (!deps.pty) sendJson(res, 403, { error: tr('interactive terminal disabled (see the server log)') });
      else deps.pty(req, res, path);
      return true;
    }
    const characterMatch = CHARACTER_ROUTE.exec(path);
    if (characterMatch) {
      // Changing character affects office: same lock as terminal (local bind + local Host).
      if (method !== 'PUT' && method !== 'DELETE') methodNotAllowed(res, 'PUT, DELETE');
      else if (!deps.terminal) {
        sendJson(res, 403, { error: tr('character editing disabled: it only works when Habblaud is reachable only from the computer running it') });
      } else if (!trusted(req)) {
        sendJson(res, 403, { error: denied(req, tr('the character can only be edited from the computer running Habblaud (http://localhost or http://127.0.0.1)')) });
      } else {
        let id: string;
        try {
          id = decodeURIComponent(characterMatch[1]);
        } catch {
          sendJson(res, 400, { error: tr('invalid id') });
          return true;
        }
        handleCharacter(req, res, id, method).catch((err) => fail(res, err));
      }
      return true;
    }
    if (path === '/api/spawn' || path.startsWith('/api/spawn/')) {
      // Opens new session in Claude app: runs code on computer, so same lock as the terminal.
      const spawn = deps.spawn;
      if (!spawn) sendJson(res, 403, { error: tr('new agent from the office disabled') });
      else if (!trusted(req, 'spawn')) sendJson(res, 403, { error: denied(req, tr('new agents can only be opened from the computer running Habblaud (http://localhost)')) });
      else if (path === '/api/spawn' && isRead) sendJson(res, 200, { available: spawn.available(), mode: spawn.mode() });
      else if (path === '/api/spawn/folders') {
        if (!isRead) methodNotAllowed(res, 'GET');
        else (deps.spawnFolders ?? (async () => []))().then((folders) => sendJson(res, 200, { folders }), (err) => fail(res, err));
      } else if (path === '/api/spawn/attachments') {
        const store = deps.attachments;
        if (method !== 'POST') methodNotAllowed(res, 'POST');
        else if (!store) sendJson(res, 403, { error: tr('attachments disabled') });
        else
          readJson(req, ATTACHMENT_BODY_MAX)
            .then((body) => {
              const a = parseAttachment(body);
              if ('error' in a) return sendJson(res, 400, { error: a.error });
              const r = store.put(a);
              if ('error' in r) return sendJson(res, 429, { error: r.error });
              sendJson(res, 201, { id: r.id, name: a.name, size: a.data.length });
            })
            .catch((err) => fail(res, err));
      }
      else if (path === '/api/spawn' && method === 'POST') {
        readJson(req)
          .then((body) => {
            const r = spawn.submit(body);
            if ('spawn' in r) return sendJson(res, 201, r.spawn);
            sendJson(res, r.error === 'invalid' ? 400 : r.error === 'too-many' ? 429 : 409, { error: r.reason });
          })
          .catch((err) => fail(res, err));
      } else if (path !== '/api/spawn' && isRead) {
        const info = spawn.get(decodeURIComponent(path.slice('/api/spawn/'.length)));
        if (info) sendJson(res, 200, info);
        else sendJson(res, 404, { error: tr('unknown request') });
      } else methodNotAllowed(res, path === '/api/spawn' ? 'GET, POST' : 'GET');
      return true;
    }
    if (path === '/api/host/spawn/poll' || path === '/api/host/spawn/ack') {
      // Host helper only, via local port (never remote); outside Docker, loopback only.
      const spawn = deps.spawn;
      if (method !== 'POST') methodNotAllowed(res, 'POST');
      else if (!spawn) sendJson(res, 403, { error: tr('new agent from the office disabled') });
      else if (!trusted(req) || (!deps.inDocker && !isLoopbackAddress(req.socket.remoteAddress))) {
        sendJson(res, 403, { error: denied(req, tr('only the helper on the computer running Habblaud')) });
      } else if (path === '/api/host/spawn/poll') {
        req.resume();
        sendJson(res, 200, { spawns: spawn.poll() });
      } else {
        readJson(req)
          .then((body) => {
            spawn.ack(body);
            sendJson(res, 200, { ok: true });
          })
          .catch((err) => fail(res, err));
      }
      return true;
    }
    if (path.startsWith('/api/agents/')) {
      if (!isRead) {
        methodNotAllowed(res, 'GET');
        return true;
      }
      let id: string;
      try {
        id = decodeURIComponent(path.slice('/api/agents/'.length));
      } catch {
        sendJson(res, 400, { error: tr('invalid id') });
        return true;
      }
      const detail = office.detail(id);
      if (detail) sendJson(res, 200, detail);
      else sendJson(res, 404, { error: tr('agent not found') });
      return true;
    }
    if (path === '/api/rooms/rename') {
      // Like character: same lock as terminal (local bind + local Host).
      if (method !== 'POST') methodNotAllowed(res, 'POST');
      else if (!deps.terminal) sendJson(res, 403, { error: tr('room renaming disabled: it only works when Habblaud is reachable only from the computer running it') });
      else if (!trusted(req)) sendJson(res, 403, { error: denied(req, tr('rooms can only be renamed from the computer running Habblaud (http://localhost)')) });
      else
        readJson(req)
          .then((body) => {
            const b = body as { id?: unknown; name?: unknown };
            if (typeof b?.id !== 'string' || typeof b.name !== 'string') throw new HttpError(400, tr('expected {id, name}'));
            const name = deps.renameRoom?.(b.id, b.name);
            if (name === undefined) throw new HttpError(404, tr('room not found'));
            sendJson(res, 200, { name });
          })
          .catch((err) => fail(res, err));
      return true;
    }
    if (path === '/api/fun/party') {
      // Easter egg (Konami code on page): party across all rooms. Computer only.
      if (method !== 'POST') methodNotAllowed(res, 'POST');
      else if (isRemote(req) || !trusted(req)) sendJson(res, 403, { error: denied(req, tr('only from this computer')) });
      else {
        office.partyEverywhere(tr('🎮 ↑↑↓↓←→←→BA'));
        sendJson(res, 200, { ok: true });
      }
      return true;
    }
    if (path === '/api/team/rules') {
      // The office's rules and the text agents read: {office, name, folder, rules, text}; this computer only.
      if (method !== 'GET') methodNotAllowed(res, 'GET');
      else if (!deps.team?.rulesView) sendJson(res, 404, { error: tr('unknown route') });
      else if (isRemote(req) || !trusted(req)) sendJson(res, 403, { error: denied(req, tr('office rules only from this computer (http://localhost)')) });
      else {
        const q = new URL(req.url ?? '', 'http://x').searchParams;
        const v = deps.team.rulesView(q.get('office') ?? undefined, q.get('who') === 'boss' ? 'boss' : 'workers');
        if (v) sendJson(res, 200, v);
        else sendJson(res, 404, { error: tr('office not found: {0}', [q.get('office') ?? '']) });
      }
      return true;
    }
    if (path === '/api/team') {
      // Every change names its `office` (id; absent = the first office): {office, boss: agentId | null, pendingAccount?}
      // appoints its boss (pendingAccount = a session just opened with POST /api/pty, not in the office yet); {office,
      // bossAgy, cwd?} an Antigravity boss; {office, worker, on} (un)registers a worker; {office, rename} / {office,
      // folder}; {createOffice: {name, folder}} -> {office}; {deleteOffice: id}; office rules: {office, rules, rev} (the
      // user saves them), {office, propose: {text, for?, why?, by?}} (a boss suggests one), {office, proposal, accept}.
      if (method !== 'POST') methodNotAllowed(res, 'POST');
      else if (!deps.team) sendJson(res, 404, { error: tr('unknown route') });
      else if (isRemote(req) || !trusted(req)) sendJson(res, 403, { error: denied(req, tr('changing the team only from this computer (http://localhost)')) });
      else
        readJson(req)
          .then((body) => {
            const b = (body ?? {}) as {
              office?: unknown;
              boss?: unknown;
              pendingAccount?: unknown;
              worker?: unknown;
              on?: unknown;
              bossAgy?: unknown;
              cwd?: unknown;
              createOffice?: { name?: unknown; folder?: unknown };
              rename?: unknown;
              folder?: unknown;
              deleteOffice?: unknown;
              rules?: unknown;
              rev?: unknown;
              propose?: { text?: unknown; for?: unknown; why?: unknown; by?: unknown };
              proposal?: unknown;
              accept?: unknown;
            };
            const t = deps.team!;
            if (b.office !== undefined && typeof b.office !== 'string') throw new HttpError(400, tr('invalid office'));
            const office = b.office as string | undefined;
            let r: TeamResult;
            if (b.createOffice) {
              const { name, folder } = b.createOffice;
              if (typeof name !== 'string' || typeof folder !== 'string') throw new HttpError(400, tr('expected {createOffice: {name, folder}}'));
              const c = t.createOffice(name, folder);
              if (!c.ok) throw new HttpError(c.status, c.error);
              return sendJson(res, 200, { ok: true, office: c.office });
            }
            if (b.rules !== undefined) {
              if (!t.setRules || typeof b.rules !== 'object' || typeof b.rev !== 'number') throw new HttpError(400, tr('expected {office, rules, rev}'));
              r = t.setRules(office, b.rules, b.rev);
            } else if (b.propose) {
              const { text, why, by } = b.propose;
              const f = b.propose.for;
              if (!t.proposeRule || typeof text !== 'string') throw new HttpError(400, tr('expected {office, propose: {text}}'));
              r = t.proposeRule(office, {
                text,
                ...(f === 'boss' || f === 'workers' || f === 'all' ? { for: f } : {}),
                ...(typeof why === 'string' ? { why } : {}),
                ...(typeof by === 'string' ? { by } : {}),
              });
            } else if (typeof b.proposal === 'string') {
              if (!t.decideRule || typeof b.accept !== 'boolean') throw new HttpError(400, tr('expected {office, proposal, accept}'));
              r = t.decideRule(office, b.proposal, b.accept);
            } else if (typeof b.deleteOffice === 'string') r = t.deleteOffice(b.deleteOffice);
            else if (typeof b.rename === 'string') r = t.renameOffice(office, b.rename);
            else if (typeof b.folder === 'string') r = t.setFolder(office, b.folder);
            else if (typeof b.bossAgy === 'string') {
              if (!t.appointAgy) throw new HttpError(404, tr('no Antigravity accounts here'));
              if (b.cwd !== undefined && typeof b.cwd !== 'string') throw new HttpError(400, tr('invalid cwd'));
              return t.appointAgy(office, b.bossAgy, b.cwd as string | undefined).then((a) => {
                if (!a.ok) throw new HttpError(a.status, a.error);
                sendJson(res, 200, { ok: true, ...(a.pty ? { pty: a.pty } : {}) });
              });
            }
            else if ('boss' in b) {
              if (b.boss !== null && typeof b.boss !== 'string') throw new HttpError(400, tr('expected {boss} (null = no boss)'));
              if (b.pendingAccount !== undefined && typeof b.pendingAccount !== 'string') throw new HttpError(400, tr('invalid pendingAccount'));
              r = t.appoint(office, b.boss, typeof b.pendingAccount === 'string' ? { account: b.pendingAccount } : undefined);
            } else if (typeof b.worker === 'string' && typeof b.on === 'boolean') {
              r = t.setWorker(office, b.worker, b.on);
            } else throw new HttpError(400, tr('expected {boss} or {worker, on}'));
            if (!r.ok) throw new HttpError(r.status, r.error);
            sendJson(res, 200, { ok: true });
          })
          .catch((err) => fail(res, err));
      return true;
    }
    if (path === '/api/board/todo') {
      if (method !== 'POST') methodNotAllowed(res, 'POST');
      else if (!deps.editPlan) sendJson(res, 404, { error: tr('unknown route') });
      else if (isRemote(req) || !trusted(req)) sendJson(res, 403, { error: denied(req, tr('editing the to-do list only from this computer (http://localhost)')) });
      else
        readJson(req)
          .then((body) => {
            const b = (body ?? {}) as { room?: unknown; office?: unknown; mtime?: unknown; edit?: Record<string, unknown> };
            const e = b.edit ?? {};
            const text = typeof e.text === 'string' ? e.text.slice(0, 500) : '';
            const index = typeof e.index === 'number' && Number.isInteger(e.index) ? e.index : -1;
            const edit: PlanEdit | undefined =
              e.op === 'toggle' && index >= 0 && typeof e.done === 'boolean'
                ? { op: 'toggle', index, done: e.done }
                : e.op === 'remove' && index >= 0
                  ? { op: 'remove', index }
                  : e.op === 'add' && text.trim()
                    ? { op: 'add', text }
                    : e.op === 'create' && typeof e.heading === 'string' && e.heading.trim()
                      ? { op: 'create', heading: e.heading.slice(0, 80), ...(text.trim() ? { text } : {}) }
                      : undefined;
            const target = typeof b.room === 'string' ? { room: b.room } : typeof b.office === 'string' ? { office: b.office } : undefined;
            if (!target || !edit) throw new HttpError(400, tr('expected {room or office, edit}'));
            const r = deps.editPlan!(target, typeof b.mtime === 'number' ? b.mtime : undefined, edit);
            if (!r.ok) throw new HttpError(r.status, r.error);
            sendJson(res, 200, { ok: true, plan: r.plan ?? null });
          })
          .catch((err) => fail(res, err));
      return true;
    }
    if (path.startsWith('/api/workers/')) {
      // Called by agy-ask / claude-ask (curl, no Origin) and the page: loopback Host only.
      if (isRemote(req) || !trusted(req)) sendJson(res, 403, { error: denied(req, tr('worker jobs only from this computer (http://localhost)')) });
      else if (!deps.workers) sendJson(res, 503, { error: tr('worker terminals need the interactive terminal (HABBLAUD_PTY=1)') });
      else handleWorkers(req, res, url, method, deps.workers).catch((err) => fail(res, err));
      return true;
    }
    if (path === '/api/accounts' || path.startsWith('/api/accounts/')) {
      if (isRemote(req)) sendJson(res, 403, { error: tr('accounts can only be added on the computer running Habblaud') });
      else if (!deps.accountsApi) sendJson(res, 403, { error: tr('interactive terminal disabled (see the server log)') });
      else deps.accountsApi(req, res, path);
      return true;
    }
    if (path === '/api/agy/jobs' || path === '/api/agy/stop' || path === '/api/agy/defaults') {
      if (method !== 'POST') methodNotAllowed(res, 'POST');
      else if (!deps.agy || !deps.terminal) sendJson(res, 403, { error: tr('Antigravity workers: only with Habblaud reachable from this computer alone') });
      else if (isRemote(req) || !trusted(req)) sendJson(res, 403, { error: denied(req, tr('sending a job to a worker only from this computer (http://localhost)')) });
      else
        readJson(req)
          .then((body) => {
            const b = body as { agentId?: unknown; prompt?: unknown; mode?: unknown; role?: unknown; effort?: unknown };
            const opt = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
            if (typeof b?.agentId !== 'string') throw new HttpError(400, tr('expected {agentId}'));
            if (path === '/api/agy/stop') return sendJson(res, 200, { ok: true, stopped: deps.agy!.stop(b.agentId) });
            if (path === '/api/agy/defaults') {
              const d = deps.agy!.setDefaults(b.agentId, { mode: opt(b.mode), effort: opt(b.effort) });
              if (!d.ok) throw new HttpError(d.status, d.error);
              return sendJson(res, 200, { ok: true });
            }
            if (typeof b.prompt !== 'string' || (b.role !== undefined && typeof b.role !== 'string')) {
              throw new HttpError(400, tr('expected {agentId, prompt, mode?, role?}'));
            }
            const r = deps.agy!.assign(b.agentId, { prompt: b.prompt, mode: opt(b.mode) as AgyMode | undefined, role: opt(b.role), effort: opt(b.effort) });
            if (!r.ok) throw new HttpError(r.status, r.error);
            sendJson(res, 202, { ok: true });
          })
          .catch((err) => fail(res, err));
      return true;
    }
    sendJson(res, 404, { error: tr('unknown route') });
    return true;
  };
}
