// Habblaud server: watches open Claude Code sessions (all accounts),
// maintains the office model, and broadcasts via SSE. No runtime dependencies.
//   npm run dev    -> tsx server/index.ts --dev (Vite in middleware mode, HMR on the same server)
//   npm start      -> node dist/server/index.js (serves dist/client)
import http from 'node:http';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { PtyInfo } from '../shared/types';
import { isDefaultDir } from './accounts/detect';
import { AccountsService } from './accounts/service';
import { isTruthy, loadConfig, terminalOffReason, worldSocketUrl } from './config';
import { createApiHandler, sendJson } from './http/app';
import { createRequestGuard } from './http/guard';
import { createRemoteGate, isRemoteRequest, loadSecret, RemoteSessions, startRemoteListener, type RemoteListener } from './http/remote';
import { Hub } from './http/sse';
import { createStaticHandler } from './http/static';
import { TerminalStreams } from './http/terminal';
import { errMsg, log } from './log';
import { NameStore } from './model/names';
import { Office } from './model/office';
import { RoomAliases } from './model/room-aliases';
import { createAccountsRoutes } from './http/accounts';
import { createPtyRoutes } from './http/pty';
import { claudeBinFrom, isExecutableFile, loadPty, PtyManager, type ScreenFactory, type SpawnPty } from './pty/manager';
import { loadHeadlessScreen } from './pty/screen';
import { openMainAgent, SessionHistory } from './sources/history';
import { HistorySet, SourceSet } from './sources/source';
import { ClaudeWatcher } from './sources/watcher';
import { AgySource, type AgySeat } from './sources/agy/source';
import { CLAUDE_WORKER, seatSuffix, TeamService, workerAgentId } from './team';
import { GhostWatch } from './workers/ghosts';
import { WorkerService, type WorkerTarget } from './workers/service';
import { BoardService } from './board';
import { agyProfilesRoot } from './sources/agy/profiles';
import { createBuildReader, readBuildInfo } from './build';
import { tr } from '../shared/i18n';
import type { WorldLocale } from '../shared/world/protocol';
import { createCliRunner, createOpener, SpawnService } from './spawn/spawn';
import { runnableClaudeBin } from './claude-bin';
import { AttachmentStore } from './spawn/attachments';
import { recentFolders } from './spawn/folders';
import { WorldClient } from './world/client';
import { createWorldRoutes } from './world/http';
import { WorldService } from './world/service';
import { WorldSettingsStore } from './world/settings';
import { OwnerSocial } from './world/social';
import { BuildingUplink } from './world/uplink';
import { WorldViewer } from './world/viewer';

const config = loadConfig();
const startedAt = Date.now();

const names = new NameStore(join(config.dataDir, 'names.json'));
names.load();
// Room names chosen by the user (right-click > Rename).
const roomAliases = new RoomAliases(join(config.dataDir, 'rooms.json'));
roomAliases.load();

// Office, accounts, and agent sources reference each other (change notifications / sources): late binding.
const late: { office?: Office; agents?: SourceSet; ptys?: PtyManager; ptyOff?: string; workers?: WorkerService } = {};
// Habblaud World (server/world/): account and character on this computer. Enabled by default (server.habblaud.com, or
// HABBLAUD_WORLD_URL); nothing leaves the computer before the user creates an account and signs in. HABBLAUD_WORLD=0
// hides everything (404 routes and nothing in the UI); a rejected HABBLAUD_WORLD_URL keeps the feature disabled.
const worldStore = new WorldSettingsStore(join(config.dataDir, 'world.json'));
if (config.world.enabled && config.world.url) worldStore.load();
// Owner's light social features (world/social.ts): daily likes, "while you were away", door knocks, and blocked users.
const worldSocial = config.world.enabled ? new OwnerSocial({ session: () => worldStore.get()?.deviceId, onChange: () => late.office?.markDirty() }) : undefined;
const world = config.world.enabled
  ? new WorldService({
      config: config.world,
      terminal: config.terminal,
      store: worldStore,
      client: config.world.url ? new WorldClient({ baseUrl: config.world.url, version: config.version }) : undefined,
      onChange: () => late.office?.markDirty(),
      social: worldSocial,
    })
  : undefined;
const accounts = new AccountsService({
  dirs: config.claudeDirs,
  home: config.home,
  env: process.env,
  onChange: () => late.office?.markDirty(),
});
const office = new Office({
  names,
  roomAlias: (path) => roomAliases.get(path),
  version: config.version,
  // In dev mode Vite serves the client directly from source code: no build to compare.
  build: config.dev ? undefined : createBuildReader(config.rootDir),
  startedAt,
  accounts: (sessions) => accounts.list(sessions),
  sources: () => late.agents?.sources() ?? [],
  accountName: (id) => accounts.find(id)?.detected.name,
  terminal: config.terminal,
  ptys: () => (late.ptys ? { status: late.ptys.status(), list: late.ptys.list() } : { status: { enabled: false, reason: late.ptyOff ?? tr('off') }, list: [] }),
  world: () => world?.meta() ?? { enabled: false, configured: false, state: 'off' },
});
// Claude workers' sessions run in the office's terminals and are shown by server/workers, not as sessions.
const claude = new ClaudeWatcher({ accounts, office, inDocker: config.inDocker, ignore: (_acc, pid) => !!late.workers?.ownsPid(pid) });
const agents = new SourceSet([claude]);
// Board › Tasks (server/board.ts): each room's handoff file.
const board = new BoardService({ office, folders: () => team.offices.map((o) => o.folder) });
// Antigravity CLI workers (sources/agy/): every profile in ~/.agy_profiles is an account, the ones registered in the
// team are workers in config.agy.room; HABBLAUD_AGY=0 turns it off. Linux only (reads /proc).
const agyRoot = agyProfilesRoot(process.env, config.home);
const agy = config.agy.enabled && process.platform === 'linux'
  ? new AgySource({
      accounts,
      office,
      root: agyRoot,
      room: config.agy.room,
      home: config.home,
      usageMs: config.agy.usageMs,
      jobsDir: join(config.dataDir, 'agy-jobs'),
    })
  : undefined;
if (agy) agents.add(agy);
// The offices (server/team.ts): one team per project folder (its boss and registered workers), in
// ~/.agy_profiles/team.json, where agy-ask reads it too (without Antigravity, in the data dir: only the bosses matter).
const team = new TeamService({
  office,
  folderPlan: (folder) => board.folderPlan(folder),
  file: join(agy ? agyRoot : config.dataDir, 'team.json'),
  // Each office's building has its workers room: the first one is the Antigravity room, the others "<it>@<office>".
  workersRoom: (id, first) => (first ? config.agy.room : `${config.agy.room}@${id}`),
  legacyBossFile: join(config.dataDir, 'boss.json'),
  profiles: () => agy?.profiles() ?? [],
  rescanProfiles: () => agy?.rescan(),
  claudeAccounts: () => accounts.entries().map((e) => ({ worker: `${CLAUDE_WORKER}${e.id}`, account: e.id })),
  seed: () => agy?.seed() ?? [],
  onWorkers: (w, agyBosses) => {
    agy?.setTeam(w, agyBosses, agySeats());
    late.workers?.sync();
  },
  onDeleteOffice: (id) => {
    late.workers?.cancel({ office: id });
  },
  extra: () => (late.workers ? { sessions: late.workers.sessionList(), jobs: late.workers.jobs() } : {}),
});
agy?.setTeam(team.workers, team.agyBosses, agySeats());

/**
 * The Antigravity characters: one per office a worker belongs to (its first office keeps "agy:accN", the next ones
 * "agy:accN@<office>" named "… (2)"), each in its office's workers room; each Antigravity boss in its office's folder.
 */
function agySeats(): AgySeat[] {
  const out: AgySeat[] = [];
  for (const seat of team.seats()) {
    if (seat.worker.startsWith(CLAUDE_WORKER)) continue;
    const p = agy?.profileOf(seat.worker);
    if (!p) continue;
    out.push({ acc: seat.worker, agentId: seat.agentId, name: `${p.name}${seatSuffix(seat.n)}`, room: team.workersRoomOf(seat.office) ?? config.agy.room, office: seat.office });
  }
  for (const o of team.offices) {
    if (o.boss?.kind !== 'agy' || !o.boss.acc) continue;
    const p = agy?.profileOf(o.boss.acc);
    if (p) out.push({ acc: o.boss.acc, agentId: o.boss.id, name: p.name, room: o.folder || config.agy.room, office: o.id });
  }
  return out;
}
team.start();
late.office = office;
late.agents = agents;
const hub = new Hub(office);
// Building in Habblaud World (world/uplink.ts): only with accepted world server. Connects automatically with approved
// account, created character, terminal lock, and without pause; packet comes only from projection
// (shared/world/projection.ts).
const worldUplink =
  world && config.world.url
    ? new BuildingUplink({
        url: worldSocketUrl(config.world.url),
        version: config.version,
        build: () => {
          const b = readBuildInfo(config.rootDir);
          return { commit: b.commit, dirty: b.dirty };
        },
        locale: (): WorldLocale => 'en', // the World has no Vietnamese
        store: worldStore,
        canAct: () => config.terminal,
        agents: () => office.list(),
        subscribe: (cb) => office.onChange(cb),
        booting: () => office.isBooting(),
        lastFile: join(config.dataDir, 'world-last-uplink.json'),
        onGoodbye: (reason) => world.goodbye(reason),
        onLeft: () => world.leftElsewhere(),
        onChange: () => office.markDirty(),
      })
    : undefined;
if (world && worldUplink) world.attachUplink(worldUplink);
// World scene (world/viewer.ts): the city over the same building connection, only with the scene open in the browser.
const worldViewer = worldUplink ? new WorldViewer() : undefined;
if (worldUplink && worldViewer) {
  worldViewer.attach(worldUplink);
  worldUplink.attachCity(worldViewer);
}
if (worldUplink && worldSocial) {
  worldSocial.attach(worldUplink);
  worldUplink.attachOwner(worldSocial);
}
// Terminal: only exists with local bind (see terminalOffReason in config.ts).
// Each agent uses its tool's parser (Claude Code's by default).
const terminals = config.terminal
  ? new TerminalStreams({ office, transcriptPathOf: (id) => agents.transcriptPathOf(id), parserFor: (id) => agents.parserFor(id) })
  : undefined;
// Terminal history (recent sessions, open or closed, across all tools): same lock.
const history = config.terminal
  ? new HistorySet([new SessionHistory({ accounts: () => accounts.entries(), openAgentOf: (acc, sid) => openMainAgent(office.list(), acc, sid) })])
  : undefined;
// Interactive terminal and New agent: both run Claude Code on this computer, so require the same opt-in,
// HABBLAUD_PTY=1 (accepts the same values as HABBLAUD_TERMINAL).
const ptyFlag = process.env.HABBLAUD_PTY?.trim();
const ptyOptIn = isTruthy(ptyFlag);
// New agent from the office (Claude Code background session, or pre-filled Claude app screen): the
// opt-in above plus the terminal lock.
const spawnOn = config.terminal && ptyOptIn;
const attachments = spawnOn ? new AttachmentStore() : undefined;
const spawnBin = config.inDocker ? undefined : runnableClaudeBin(process.env);
const spawn = spawnOn
  ? new SpawnService(config.inDocker ? { attachments } : { opener: createOpener(), cli: spawnBin ? createCliRunner(spawnBin) : undefined, attachments })
  : undefined;
// Interactive terminal (open/take over sessions and stop agents): opt-in with HABBLAUD_PTY=1, local bind only,
// outside Docker, with node-pty and claude executable in PATH.
const claudeBinSetting = process.env.HABBLAUD_CLAUDE_BIN?.trim();
const claudeBin = claudeBinFrom();
let spawnPty: SpawnPty | null = null;
let ptyScreen: ScreenFactory | undefined;
let ptyOff: string | undefined;
if (!ptyOptIn) ptyOff = ptyFlag ? tr('off via HABBLAUD_PTY={0}', [ptyFlag]) : tr('off (turn it on with HABBLAUD_PTY=1)');
else if (config.inDocker) ptyOff = tr('unavailable in Docker (run with npm start)');
else if (!config.terminal) ptyOff = tr('same lock as the terminal ({0})', [terminalOffReason(process.env, config.host, config.inDocker)]);
else if (!claudeBin) ptyOff = claudeBinSetting ? tr('HABBLAUD_CLAUDE_BIN not found in PATH ({0})', [claudeBinSetting]) : tr('"claude" executable not found in PATH (set HABBLAUD_CLAUDE_BIN)');
else if (!isExecutableFile(claudeBin)) ptyOff = tr("the Claude Code executable doesn't run: {0} (check HABBLAUD_CLAUDE_BIN)", [claudeBin]);
else {
  const loaded = await loadPty();
  spawnPty = loaded.spawn;
  ptyOff = loaded.reason;
  if (spawnPty) {
    const screen = await loadHeadlessScreen();
    ptyScreen = screen.create ?? undefined;
    if (screen.reason) log.warn(tr('Interactive terminal without the full screen ({0}): on reconnect, modes like bracketed paste may be lost.', [screen.reason]));
  }
}
const ptys = spawnPty
  ? new PtyManager({
      spawn: spawnPty,
      claudeBin: claudeBin ?? 'claude',
      agy: agy ? { bin: join(config.home, '.local', 'bin', 'agy-as'), cwd: config.agy.room, worker: (id) => agy.worker(id) } : undefined,
      accounts: () => accounts.entries().map((a) => ({ id: a.id, dir: a.dir, isDefault: isDefaultDir(a.dir, config.home) })),
      agent: (id) => {
        const a = office.get(id);
        return a && { id: a.id, kind: a.kind, account: a.account, sessionId: a.sessionId, cwd: office.roomPath(a.roomId) };
      },
      onChange: () => office.markDirty(),
      reopen: (id) => {
        const o = team.offices.find((x) => x.boss?.kind === 'agy' && x.boss.id === id);
        return o ? openAgyBossTerminal(o.id, o.boss!.acc!) : undefined;
      },
      createScreen: ptyScreen,
    })
  : undefined;
late.ptys = ptys;
late.ptyOff = ptyOff;

// Worker terminals (server/workers): jobs typed into each registered worker's terminal, answered from its conversation
// file; you can watch them. Needs the interactive terminal.
const agyBin = join(config.home, '.local', 'bin', 'agy-as');
/** A worker's characters per office (named "… (2)" after the first), each in its office's workers room. */
const seatsOf = (worker: string, name: string) =>
  team
    .seats()
    .filter((x) => x.worker === worker)
    .map((x) => ({ office: x.office, agentId: x.agentId, name: `${name}${seatSuffix(x.n)}`, room: team.workersRoomOf(x.office) ?? config.agy.room }));
const workers = ptys
  ? new WorkerService({
      office,
      ptys,
      targets: () =>
        team.workers.flatMap((id): WorkerTarget[] => {
          if (id.startsWith(CLAUDE_WORKER)) {
            const e = accounts.entries().find((x) => x.id === id.slice(CLAUDE_WORKER.length));
            if (!e) return [];
            const name = tr('{0} (Claude worker)', [e.detected.email?.split('@')[0] ?? e.id]);
            return [{ id, kind: 'claude', agentId: workerAgentId(id), account: e.id, name, configDir: e.dir, isDefault: isDefaultDir(e.dir, config.home), seats: seatsOf(id, name) }];
          }
          const p = agy?.profileOf(id);
          return p ? [{ id, kind: 'agy', agentId: workerAgentId(id), account: p.account, name: p.name, acc: id, stateDir: p.stateDir, seats: seatsOf(id, p.name) }] : [];
        }),
      agyBin,
      claudeBin: claudeBin ?? 'claude',
      room: config.agy.room,
      logFile: join(agyRoot, 'agy-ask.log.jsonl'),
      onChange: () => team.publish(),
      offices: { has: (w, o) => team.isWorker(w, o), of: (w) => team.officeOfWorker(w) },
      board: (item) => agy?.upsertJob(item),
    })
  : undefined;
late.workers = workers;
if (workers) {
  agy?.setExternal((acc, officeId) => workers.statusOf(acc, officeId));
  workers.start();
}

/** "＋ Boss" with an Antigravity account: appoints it and opens its terminal (after its worker terminal closed). */
async function appointAgyBoss(officeId: string | undefined, acc: string, cwd?: string): Promise<{ ok: true; pty?: PtyInfo } | { ok: false; status: number; error: string }> {
  if (!ptys) return { ok: false, status: 503, error: tr('the interactive terminal is off (HABBLAUD_PTY=1)') };
  if (cwd !== undefined && !isAbsolute(cwd)) return { ok: false, status: 400, error: tr('folder not found: {0}', [cwd]) };
  const wasWorker = team.isWorker(acc);
  const r = team.appointAgy(officeId, acc, agy?.profileOf(acc)?.name);
  if (!r.ok) return r;
  const agentId = `agy:${acc}`;
  // Its worker terminal is closing (one agy per profile): wait for it before opening the boss's.
  for (let i = 0; wasWorker && ptys.ofAgent(agentId) && i < 40; i++) await new Promise((ok) => setTimeout(ok, 200));
  try {
    return { ok: true, pty: openAgyBossTerminal(team.officeOf(officeId)!.id, acc, cwd) };
  } catch (err) {
    return { ok: false, status: 500, error: errMsg(err) };
  }
}

/**
 * An Antigravity boss's terminal (the open one, or a new idle agy: no prompt, no quota), in its office's folder;
 * AGY_BOSS=1 makes agy load the boss's rules (agy-hub), AGY_OFFICE names the office for agy-ask.
 */
function openAgyBossTerminal(officeId: string, acc: string, cwd?: string): PtyInfo {
  const agentId = `agy:${acc}`;
  const open = ptys!.ofAgent(agentId);
  if (open) return open;
  const folder = team.officeOf(officeId)?.folder;
  const desk = join(config.agy.room, 'boss');
  const where = cwd ?? (folder && existsSync(folder) ? folder : existsSync(desk) ? desk : config.agy.room);
  return ptys!.openProgram({ agentId, account: agentId, file: agyBin, args: [acc], cwd: where, env: { AGY_BOSS: '1', AGY_OFFICE: officeId } });
}
if (ptys) {
  for (const o of team.offices) {
    if (o.boss?.kind !== 'agy') continue;
    try {
      openAgyBossTerminal(o.id, o.boss.acc!);
    } catch (err) {
      log.warn(tr("Couldn't open the Antigravity boss's terminal: {0}", [errMsg(err)]));
    }
  }
}

// Synchronous sources (Claude Code) finish booting here, before the hub starts broadcasting.
void agents.start();
accounts.start();
board.start();
hub.start();
worldUplink?.start();
// Hung workers: a faint ghost on the seat; nothing is stopped.
const ghosts = new GhostWatch({
  office,
  candidates: () => [...(agy?.ghostCandidates() ?? []), ...(workers?.ghostCandidates() ?? [])],
  news: () => undefined,
});
ghosts.start();
const ticker = setInterval(() => {
  try {
    office.tick();
  } catch (err) {
    log.warnOnce(`tick:${errMsg(err)}`, tr('Office clock failed: {0}', [errMsg(err)]));
  }
}, 250);

const api = createApiHandler({
  editPlan: (target, mtime, edit) => {
    if ('room' in target) return board.editPlan(target.room, mtime, edit);
    const folder = team.offices.find((o) => o.id === target.office)?.folder;
    return folder ? board.editFolderPlan(folder, mtime, edit) : { ok: false, status: 404, error: tr('office not found: {0}', [target.office]) };
  },
  team: {
    appoint: (office, id, pending) => team.appoint(office, id, pending),
    setWorker: (office, acc, on) => team.setWorker(office, acc, on),
    appointAgy: agy ? appointAgyBoss : undefined,
    createOffice: (name, folder) => team.createOffice(name, folder),
    renameOffice: (office, name) => team.renameOffice(office, name),
    setFolder: (office, folder) => team.setFolder(office, folder),
    deleteOffice: (office) => team.deleteOffice(office),
  },
  workers: workers
    ? {
        ask: (input) => workers.ask(input),
        waitJob: (id, s) => workers.waitJob(id, s),
        cancel: (p) => workers.cancel(p),
      }
    : undefined,
  agy: agy ? { assign: (id, job) => agy.assign(id, job), stop: (id) => agy.stopJobs(id), setDefaults: (id, d) => agy.setDefaults(id, d) } : undefined,
  renameRoom: (id, name) => {
    const path = office.roomPath(id);
    if (!path) return undefined;
    roomAliases.set(path, name);
    office.refreshRoomNames();
    return office.roomName(id);
  },
  office,
  hub,
  accounts,
  sources: () => agents.sources(),
  version: config.version,
  inDocker: config.inDocker,
  terminal: config.terminal,
  terminals,
  sessions: history,
  pty: ptys ? createPtyRoutes(ptys) : undefined,
  accountsApi: ptys
    ? createAccountsRoutes({
        ptys,
        home: config.home,
        agyRoot: agyProfilesRoot(process.env, config.home),
        claudeBin: claudeBin ?? 'claude',
        agyBin: join(config.home, '.local', 'bin', 'agy-as'),
        claudeAccounts: () => accounts.entries().map((a) => ({ id: a.id, dir: a.dir, isDefault: isDefaultDir(a.dir, config.home) })),
        addClaudeDir: (dir) => accounts.addDir(dir),
        refresh: () => accounts.refresh(),
      })
    : undefined,
  spawn,
  attachments,
  spawnFolders: async () => {
    const snap = hub.current();
    const last = new Map<string, number>();
    for (const a of snap.agents) last.set(a.roomId, Math.max(last.get(a.roomId) ?? 0, a.lastEventAt ?? 0));
    const rooms = snap.rooms.map((r) => ({ path: r.path, lastAt: last.get(r.id) ?? 0 }));
    return recentFolders(history ? await history.list().catch(() => []) : [], rooms);
  },
  remote: config.remote ? { is: isRemoteRequest, allows: (f) => config.remote!.allow.has(f) } : undefined,
  world: world ? createWorldRoutes(world, worldViewer, worldSocial) : undefined,
});

const server = http.createServer();
let closeVite: (() => Promise<void>) | undefined;

function parseUrl(req: http.IncomingMessage): URL {
  try {
    return new URL(req.url ?? '/', 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

/** Handles non-/api requests: Vite (dev) or dist/client static files (production). */
let fallback: (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => void;
if (config.dev) {
  // Dynamic import: production bundle never loads Vite.
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: join(config.rootDir, 'vite.config.ts'),
    server: { middlewareMode: true, ws: { server } },
    appType: 'spa',
  });
  closeVite = () => vite.close();
  fallback = (req, res) => vite.middlewares(req, res);
} else {
  const serveStatic = createStaticHandler(join(config.rootDir, 'dist', 'client'));
  fallback = (req, res, url) => serveStatic(req, res, url.pathname);
}

// Host/Origin/Content-Type: blocks DNS rebinding and CSRF before any route (including Vite).
const guard = createRequestGuard({ allowedHosts: config.allowedHosts });

server.on('request', (req, res) => {
  const url = parseUrl(req);
  try {
    if (guard(req, res)) return;
    if (!api(req, res, url)) fallback(req, res, url);
  } catch (err) {
    log.warn(tr('Error responding to {0} {1}: {2}', [req.method, url.pathname, errMsg(err)]));
    if (!res.headersSent) sendJson(res, 500, { error: tr('internal error') });
    else res.destroy();
  }
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') log.error(tr('Port {0} is already in use (set HABBLAUD_PORT to use another one).', [config.port]));
  else log.error(tr('HTTP server error: {0}', [errMsg(err)]));
  process.exit(1);
});

/**
 * Remote port (mobile on local network): the same app, but every request goes through login (http/remote.ts) before
 * the API. The main port remains local-only; they are distinguished by the incoming connection port.
 */
let remoteListener: RemoteListener | undefined;
if (config.remote) {
  const remote = config.remote;
  const gate = createRemoteGate({
    config: remote,
    sessions: new RemoteSessions(loadSecret(join(config.dataDir, 'remote-secret')), remote, Date.now, join(config.dataDir, 'remote-revoked.json')),
    secure: !!remote.tls,
    caFile: remote.tls?.caFile,
  });
  remoteListener = startRemoteListener(
    remote,
    (req, res) => {
      const url = parseUrl(req);
      try {
        if (guard(req, res)) return;
        if (gate(req, res, url)) return;
        if (!api(req, res, url)) fallback(req, res, url);
      } catch (err) {
        log.warn(tr('Error responding (remote) to {0} {1}: {2}', [req.method, url.pathname, errMsg(err)]));
        if (!res.headersSent) sendJson(res, 500, { error: tr('internal error') });
        else res.destroy();
      }
    },
    log,
    config.allowedHosts,
  );
  remoteListener.server.once('listening', () => {
    const allow = [...remote.allow].join(', ') || tr('view only');
    const where = config.inDocker ? tr('published via HABBLAUD_REMOTE_BIND') : remote.host;
    const scheme = remote.tls ? 'HTTPS' : tr('HTTP WITHOUT encryption (HABBLAUD_REMOTE_INSECURE_HTTP)');
    log.info(tr('   Remote access: on at port {0} ({1}), {2}, with login; allows: {3}.', [remote.port, where, scheme, allow]));
    if (remote.allow.has('spawn') && !spawn) log.warn(tr('   Remote access: "spawn" allowed, but New agent is off (turn it on with HABBLAUD_PTY=1).'));
  });
} else if (config.remoteWarning) {
  log.warn(`   ${config.remoteWarning}.`);
}

server.listen(config.port, config.host, () => {
  const host = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  log.info(tr('🏢 Habblaud {0}{1}{2} at http://{3}:{4}', [config.version, config.dev ? ' (dev)' : '', config.inDocker ? ' (docker)' : '', host, config.port]));
  const list = accounts.entries();
  if (!list.length) log.warn(tr('No Claude Code folder found (set HABBLAUD_CLAUDE_DIRS).'));
  for (const a of list) {
    const src = agents.sources().find((s) => s.label === a.id);
    const usage = accounts.usageView(a.id).status;
    log.info(tr('   Account {0} ({1}): {2} open session(s) · usage: {3} · {4}', [a.detected.short, a.id, src?.sessions ?? 0, usage, a.dir]));
  }
  if (config.terminal) log.info(tr('   Terminal: on (local access only).'));
  else log.info(tr('   Terminal: off ({0}).', [terminalOffReason(process.env, config.host, config.inDocker)]));
  log.info(ptys ? tr('   Interactive terminal: on ({0}).', [claudeBin]) : tr('   Interactive terminal: {0}.', [ptyOff ?? tr('off')]));
  log.info(
    !spawn
      ? tr('   New agent: off ({0}).', [!ptyOptIn ? tr('turn it on with HABBLAUD_PTY=1') : tr('same lock as the terminal')])
      : config.inDocker
        ? tr('   New agent: on, via the host helper.')
        : spawnBin
          ? tr('   New agent: on ({0} --bg; a folder not yet trusted opens in the Claude app).', [spawnBin])
          : tr('   New agent: on, only via the Claude app (claude not found in PATH).'),
  );
  if (config.world.warning) log.warn(`   ${config.world.warning}.`);
  log.info(
    !world
      ? tr('   Habblaud World: hidden (HABBLAUD_WORLD=0).')
      : !config.world.url
        ? tr('   Habblaud World: off (HABBLAUD_WORLD_URL rejected).')
        : tr('   Habblaud World: {0}, account on this computer: {1}{2}.', [
            config.world.defaultUrl ? tr('{0} (default)', [config.world.url]) : config.world.url,
            world.state(),
            config.terminal ? '' : tr(' (read-only: the terminal lock is off)'),
          ]),
  );
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(tr('Shutting down ({0})…', [signal]));
  clearInterval(ticker);
  agents.stop();
  accounts.stop();
  board.stop();
  ghosts.stop();
  hub.stop();
  terminals?.stop();
  ptys?.stopAll();
  worldViewer?.stop();
  worldUplink?.stop();
  world?.stop();
  names.flush();
  void closeVite?.();
  remoteListener?.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
