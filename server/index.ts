// Habblaud server: watches open Claude Code sessions (all accounts),
// maintains the office model, and broadcasts via SSE. No runtime dependencies.
//   npm run dev    -> tsx server/index.ts --dev (Vite in middleware mode, HMR on the same server)
//   npm start      -> node dist/server/index.js (serves dist/client)
import http from 'node:http';
import { basename, join, resolve } from 'node:path';
import type { PtyInfo } from '../shared/types';
import { isDefaultDir } from './accounts/detect';
import { AccountsService } from './accounts/service';
import { isTruthy, loadConfig, terminalOffReason } from './config';
import { createApiHandler, sendJson } from './http/app';
import { createRequestGuard } from './http/guard';
import { PasskeyService, PasskeyStore } from './remote/passkeys';
import { GoogleAuth, maskEmail } from './remote/google';
import { PtyAccess } from './remote/ptygrant';
import { createRemoteGate, FailureWindow, isRemoteRequest, isSecureRemote, listsHubDomain, loadSecret, parseSsoEnv, remoteAllowedHosts, remoteAllows, RemoteSessions, sessionOf, startRemoteListener, type RemoteListener } from './http/remote';
import { Hub } from './http/sse';
import { createStaticHandler, parseFrameAncestor } from './http/static';
import { TerminalStreams } from './http/terminal';
import { errMsg, log } from './log';
import { NameStore } from './model/names';
import { Office } from './model/office';
import { RoomAliases } from './model/room-aliases';
import { createAccountsRoutes } from './http/accounts';
import { createPtyRoutes } from './http/pty';
import { checkPrompt, claudeBinFrom, isExecutableFile, loadPty, PtyError, PtyManager, type ScreenFactory, type SpawnPty } from './pty/manager';
import { loadHeadlessScreen } from './pty/screen';
import { openMainAgent, SessionHistory } from './sources/history';
import { HistorySet, SourceSet } from './sources/source';
import { ClaudeWatcher } from './sources/watcher';
import { AgySource, type AgySeat } from './sources/agy/source';
import { agyBossId, claudeConfigDir, staleAgyBosses, TeamService } from './team';
import { Advisor, resolveBoss } from './workers/advisor';
import { claudeTranscriptPath } from './workers/turns';
import { GhostWatch } from './workers/ghosts';
import { WorkerService, type WorkerTarget } from './workers/service';
import { agyProfilesRoot } from './sources/agy/profiles';
import { createBuildReader } from './build';
import { tr } from '../shared/i18n';
import { createCliRunner, createOpener, SpawnService } from './spawn/spawn';
import { runnableClaudeBin } from './claude-bin';
import { AttachmentStore } from './spawn/attachments';
import { recentFolders } from './spawn/folders';

const config = loadConfig();
const startedAt = Date.now();

const names = new NameStore(join(config.dataDir, 'names.json'));
names.load();
// Room names chosen by the user (right-click > Rename).
const roomAliases = new RoomAliases(join(config.dataDir, 'rooms.json'));
roomAliases.load();

// Office, accounts, and agent sources reference each other (change notifications / sources): late binding.
const late: { office?: Office; agents?: SourceSet; ptys?: PtyManager; ptyOff?: string; workers?: WorkerService; passkeys?: PasskeyService } = {};
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
});
// Claude workers' sessions run in the office's terminals and are shown by server/workers, not as sessions.
const claude = new ClaudeWatcher({ accounts, office, home: config.home, ignore: (_acc, pid) => !!late.workers?.ownsPid(pid) });
const agents = new SourceSet([claude]);
// Antigravity CLI workers (sources/agy/): every profile in ~/.agy_profiles is an account, the ones registered in the
// team have characters in the office folder; HABBLAUD_AGY=0 turns it off. Linux only (reads /proc).
const agyRoot = agyProfilesRoot(process.env, config.home);
const agy = config.agy.enabled && process.platform === 'linux'
  ? new AgySource({
      accounts,
      office,
      root: agyRoot,
      home: config.home,
      usageMs: config.agy.usageMs,
      askBin: join(config.rootDir, 'tools', 'agy', 'bin', 'worker-ask'),
      selfUrl: `http://127.0.0.1:${config.port}`,
      folder: () => team.folder,
    })
  : undefined;
if (agy) agents.add(agy);
// The seats (server/team.ts): one office, one folder, the seats and the boss, in <dataDir>/team.json (~/.habblaud),
// imported once from ~/.agy_profiles/team.json (never written). worker-ask reads the same file.
const team = new TeamService({
  office,
  file: join(config.dataDir, 'team.json'),
  oldFile: join(agyRoot, 'team.json'),
  home: config.home,
  profiles: () => agy?.profiles() ?? [],
  onChange: () => {
    syncAgy();
    late.workers?.sync();
    for (const id of staleAgyBosses(late.ptys?.list() ?? [], team.boss)) late.ptys?.closeAgent(id);
  },
  extra: () => (late.workers ? { sessions: late.workers.sessionList(), jobs: late.workers.jobs() } : {}),
});
syncAgy();

/**
 * The Antigravity characters: one per agy seat (the first seat of an account keeps "agy:<acc>"), plus the Antigravity
 * boss "agy-boss:<acc>", all in the team's folder (empty until set: AgySource stands them in home).
 */
function syncAgy(): void {
  if (!agy) return;
  const room = team.folder;
  const seats: AgySeat[] = team.seats().filter((s) => s.kind === 'agy').map((s) => ({ acc: s.account, agentId: s.agentId, name: s.name, room }));
  if (team.boss.kind === 'agy') {
    const acc = team.boss.account;
    const p = agy.profileOf(acc);
    if (p) seats.push({ acc, agentId: agyBossId(acc), name: p.name, room, boss: true });
  }
  agy.setTeam(seats);
}
team.start();
late.office = office;
late.agents = agents;
const hub = new Hub(office);
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
const spawnBin = runnableClaudeBin(process.env);
const spawn = spawnOn
  ? new SpawnService({ opener: createOpener(), cli: spawnBin ? createCliRunner(spawnBin) : undefined, attachments })
  : undefined;
// Interactive terminal (open/take over sessions and stop agents): opt-in with HABBLAUD_PTY=1, local bind only,
// with node-pty and claude executable in PATH.
const claudeBinSetting = process.env.HABBLAUD_CLAUDE_BIN?.trim();
const claudeBin = claudeBinFrom();
let spawnPty: SpawnPty | null = null;
let ptyScreen: ScreenFactory | undefined;
let ptyOff: string | undefined;
if (!ptyOptIn) ptyOff = ptyFlag ? tr('off via HABBLAUD_PTY={0}', [ptyFlag]) : tr('off (turn it on with HABBLAUD_PTY=1)');
else if (!config.terminal) ptyOff = tr('same lock as the terminal ({0})', [terminalOffReason(process.env, config.host)]);
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
      accounts: () => accounts.entries().map((a) => ({ id: a.id, dir: a.dir, isDefault: isDefaultDir(a.dir, config.home) })),
      agent: (id) => {
        const a = office.get(id);
        return a && { id: a.id, kind: a.kind, account: a.account, sessionId: a.sessionId, cwd: office.roomPath(a.roomId) };
      },
      onChange: () => office.markDirty(),
      reopen: (id) => {
        return team.folder && team.boss.kind === 'agy' && id === agyBossId(team.boss.account) ? openBossAgyTerminal(team.boss.account) : undefined;
      },
      createScreen: ptyScreen,
    })
  : undefined;
late.ptys = ptys;
late.ptyOff = ptyOff;

// Worker terminals (server/workers): jobs typed into each seat's terminal, answered from its conversation
// file; you can watch them. Needs the interactive terminal.
// The repo's own agy-as (the ~/.local/bin link may point to another checkout that writes a plugin into the profile).
const agyBin = join(config.rootDir, 'tools', 'agy', 'bin', 'agy-as');
const workers = ptys
  ? new WorkerService({
      office,
      ptys,
      // One target per seat (Task 5 gives seats their own locks); a Claude seat does not need a signed-in account yet.
      targets: () =>
        team.seats().flatMap((s): WorkerTarget[] => {
          if (s.kind === 'claude') {
            const configDir = claudeConfigDir(s.account, config.home);
            const account = accounts.addDir(configDir) ?? basename(configDir);
            return [{ id: s.name, kind: 'claude', agentId: s.agentId, account, name: s.name, configDir, isDefault: s.account === 'default' }];
          }
          const p = agy?.profileOf(s.account);
          return p ? [{ id: s.name, kind: 'agy', agentId: s.agentId, account: p.account, name: s.name, acc: s.account, stateDir: p.stateDir }] : [];
        }),
      agyBin,
      selfUrl: `http://127.0.0.1:${config.port}`,
      claudeBin: claudeBin ?? 'claude',
      folder: () => team.folder,
      noFolderMsg: () => noFolderMsg(),
      logFile: join(agyRoot, 'agy-ask.log.jsonl'),
      onChange: () => team.publish(),
      board: (item) => agy?.upsertJob(item),
    })
  : undefined;
late.workers = workers;
const advisor =
  ptys && workers
    ? new Advisor({
        boss: () => {
          const id = team.bossAgentId();
          const a = id ? office.get(id) : undefined;
          const dir = a && accounts.find(a.account)?.dir;
          // shortcut: a boss that /clears mid-question keeps the old transcript, the question times out
          const transcript = id && (agents.transcriptPathOf(id) ?? (a && dir ? claudeTranscriptPath(dir, office.roomPath(a.roomId) ?? team.folder, a.sessionId) : undefined));
          return resolveBoss({ agy: team.boss.kind === 'agy', id, agent: a, pty: !!id && !!ptys.ofAgent(id), transcript: transcript || undefined });
        },
        typeTo: (id, d) => ptys.typeTo(id, d),
        seat: (s) => workers.seatRef(s),
        note: (s, q) => workers.noteQuestion(s, q),
        activity: (id, act) => office.addActivity(id, act, true),
        folder: () => team.folder,
      })
    : undefined;
if (workers) {
  agy?.setExternal((agentId) => workers.statusOf(agentId));
  workers.start();
}

const noFolderMsg = () => tr('the office has no folder yet: set "folder" in {0}', [join(config.dataDir, 'team.json')]);

/** The Antigravity boss's terminal (the open one, or a new idle agy: no prompt, no quota), in the team's folder; AGY_BOSS=1 marks the boss. */
function openBossAgyTerminal(acc: string): PtyInfo {
  if (!team.folder) throw new PtyError(400, noFolderMsg());
  const agentId = agyBossId(acc);
  const open = ptys!.ofAgent(agentId);
  if (open) return open;
  return ptys!.openProgram({ agentId, account: agentId, file: agyBin, args: [acc], cwd: team.folder, env: { AGY_BOSS: '1' } });
}
/** "Mở boss": the boss's terminal by boss.kind, in the office folder (an empty folder is a 400 before anything opens). */
async function openBoss(prompt?: unknown): Promise<{ ok: true; pty: PtyInfo; reused?: true } | { ok: false; status: number; error: string }> {
  const fail = (status: number, error: string) => ({ ok: false as const, status, error });
  if (!ptys) return fail(503, tr('the interactive terminal is off (HABBLAUD_PTY=1)'));
  if (!team.folder) return fail(400, noFolderMsg());
  try {
    checkPrompt(prompt);
    const { kind, account: acc } = team.boss;
    const open = ptys.ofAgent(team.bossAgentId() ?? '');
    if (open) return { ok: true, pty: open, reused: true };
    if (kind === 'agy') {
      if (!agy?.profileOf(acc)) return fail(404, tr('Antigravity account not found: {0}', [acc]));
      return { ok: true, pty: openBossAgyTerminal(acc) };
    }
    const dir = claudeConfigDir(acc, config.home);
    const account = accounts.entries().find((e) => resolve(e.dir) === dir)?.id ?? accounts.addDir(dir);
    if (!account) return fail(404, tr('Claude Code account folder not found: {0}', [dir]));
    const pty = ptys.create({ cwd: team.folder, account, prompt });
    team.appoint(pty.agentId, { account: pty.account });
    return { ok: true, pty };
  } catch (err) {
    return fail(err instanceof PtyError ? err.status : 500, errMsg(err));
  }
}
if (ptys && team.boss.kind === 'agy') {
  try {
    openBossAgyTerminal(team.boss.account);
  } catch (err) {
    log.warn(tr("Couldn't open the Antigravity boss's terminal: {0}", [errMsg(err)]));
  }
}

// Synchronous sources (Claude Code) finish booting here, before the hub starts broadcasting.
void agents.start();
accounts.start();
hub.start();
// Hung workers: a faint ghost on the seat; nothing is stopped.
const ghosts = new GhostWatch({
  office,
  candidates: () => [...(agy?.ghostCandidates() ?? []), ...(workers?.ghostCandidates() ?? [])],
});
ghosts.start();
const ticker = setInterval(() => {
  try {
    office.tick();
  } catch (err) {
    log.warnOnce(`tick:${errMsg(err)}`, tr('Office clock failed: {0}', [errMsg(err)]));
  }
}, 250);

/** Passkey step-up grants and the open remote terminal streams (gate issues and ends them, pty routes check them). */
const ptyAccess = new PtyAccess();
const api = createApiHandler({
  team: { appoint: (id, pending) => team.appoint(id, pending), openBoss: ptys ? openBoss : undefined },
  workers: workers
    ? {
        ask: (input) => workers.ask(input),
        waitJob: (id, s) => workers.waitJob(id, s),
        cancel: (p) => workers.cancel(p),
      }
    : undefined,
  advisor,
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
  terminal: config.terminal,
  terminals,
  sessions: history,
  pty: ptys ? createPtyRoutes(ptys, { access: ptyAccess, sessionOf, isRemote: isRemoteRequest }) : undefined,
  accountsApi: ptys
    ? createAccountsRoutes({
        ptys,
        home: config.home,
        agyRoot: agyProfilesRoot(process.env, config.home),
        claudeBin: claudeBin ?? 'claude',
        agyBin,
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
  remote: config.remote ? { is: isRemoteRequest, allows: remoteAllows(config.remote.allow, () => late.passkeys?.count() ?? 0) } : undefined,
});

const frameAncestor = parseFrameAncestor(process.env.HABBLAUD_FRAME_ANCESTORS);
if (process.env.HABBLAUD_FRAME_ANCESTORS && !frameAncestor) log.warn(tr('HABBLAUD_FRAME_ANCESTORS ignored: expected one https:// origin'));

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
  const serveStatic = createStaticHandler(join(config.rootDir, 'dist', 'client'), frameAncestor);
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
  const passkeys = remote.domain
    ? new PasskeyService({ domain: remote.domain, user: remote.user, store: new PasskeyStore(join(config.dataDir, 'remote', 'passkeys.json'), log), topOrigin: frameAncestor })
    : undefined;
  late.passkeys = passkeys;
  const { sso, warning: ssoWarning } = parseSsoEnv(process.env);
  if (ssoWarning) log.warn(ssoWarning);
  const secret = loadSecret(join(config.dataDir, 'remote-secret'));
  const gate = createRemoteGate({
    config: remote,
    google: remote.google ? new GoogleAuth(remote.google, secret) : undefined,
    sessions: new RemoteSessions(secret, remote, Date.now, join(config.dataDir, 'remote-revoked.json')),
    secure: isSecureRemote(remote),
    domain: remote.domain,
    passkeys,
    ownerEmail: remote.ownerEmail,
    ptyAccess,
    passwordLogin: remote.passwordLogin,
    frameAncestor,
    sso,
    failures: new FailureWindow(),
    log,
    caFile: remote.tls?.caFile,
  });
  if (listsHubDomain(config.allowedHosts, remote.domain)) log.warn(tr('HABBLAUD_ALLOWED_HOSTS still lists the hub domain: the local port would answer it. Run remote:setup --behind-proxy again.'));
  const remoteHosts = remoteAllowedHosts(config.allowedHosts, remote.domain);
  const remoteGuard = createRequestGuard({ allowedHosts: remoteHosts });
  remoteListener = startRemoteListener(
    remote,
    (req, res) => {
      const url = parseUrl(req);
      try {
        if (remoteGuard(req, res)) return;
        if (gate(req, res, url)) return;
        if (!api(req, res, url)) fallback(req, res, url);
      } catch (err) {
        log.warn(tr('Error responding (remote) to {0} {1}: {2}', [req.method, url.pathname, errMsg(err)]));
        if (!res.headersSent) sendJson(res, 500, { error: tr('internal error') });
        else res.destroy();
      }
    },
    log,
    remoteHosts,
  );
  if (config.remoteWarning) log.warn(`   ${config.remoteWarning}.`);
  remoteListener.server.once('listening', () => {
    const allow = [...remote.allow].join(', ') || tr('view only');
    const scheme = remote.domain ? tr('HTTP behind a proxy for {0}', [remote.domain]) : remote.tls ? 'HTTPS' : tr('HTTP WITHOUT encryption (HABBLAUD_REMOTE_INSECURE_HTTP)');
    if (/\bspawn\b/i.test(process.env.HABBLAUD_REMOTE_ALLOW ?? '')) log.warn(tr('   Remote access: "spawn" is no longer a remote feature and is ignored (only "terminal").'));
    if (!remote.ownerEmail && (passkeys?.count() ?? 0) > 0) log.warn(tr('   Remote access: passkeys exist but HABBLAUD_REMOTE_OWNER_EMAIL is not set: nobody can register or delete passkeys.'));
    if (passkeys?.broken()) log.warn(tr('   Remote access: passkeys.json is unreadable: remote passkey changes and typing in terminals are refused until it is fixed.'));
    else if (remote.ownerEmail && passkeys && passkeys.count() === 0) log.warn(tr('   Remote access: an owner is set but no passkey is registered: typing in terminals stays off until the owner adds one at /remote/security.'));
    if (remote.ownerEmail) log.info(tr('   Remote access: owner {0}; may view terminals, and type in them after a passkey check ({1} passkey(s)).', [maskEmail(remote.ownerEmail), passkeys?.count() ?? 0]));
    if (remote.google) log.info(tr('   Remote access: Sign in with Google on ({0} address(es) allowed).', [remote.google.emails.size]));
    if (passkeys) log.info(tr('   Remote access: {0} passkey(s); password sign-in {1}.', [passkeys.count(), passkeys.count() > 0 && !remote.passwordLogin ? tr('off') : tr('on')]));
    log.info(tr('   Remote access: on at port {0} ({1}), {2}, with login; allows: {3}.', [remote.port, remote.host, scheme, allow]));
  });
} else if (config.remoteWarning) {
  log.warn(`   ${config.remoteWarning}.`);
}

server.listen(config.port, config.host, () => {
  const host = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  log.info(tr('🏢 Habblaud {0}{1} at http://{2}:{3}', [config.version, config.dev ? ' (dev)' : '', host, config.port]));
  const list = accounts.entries();
  if (!list.length) log.warn(tr('No Claude Code folder found (set HABBLAUD_CLAUDE_DIRS).'));
  for (const a of list) {
    const src = agents.sources().find((s) => s.label === a.id);
    const usage = accounts.usageView(a.id).status;
    log.info(tr('   Account {0} ({1}): {2} open session(s) · usage: {3} · {4}', [a.detected.short, a.id, src?.sessions ?? 0, usage, a.dir]));
  }
  if (config.terminal) log.info(tr('   Terminal: on (local access only).'));
  else log.info(tr('   Terminal: off ({0}).', [terminalOffReason(process.env, config.host)]));
  log.info(ptys ? tr('   Interactive terminal: on ({0}).', [claudeBin]) : tr('   Interactive terminal: {0}.', [ptyOff ?? tr('off')]));
  log.info(
    !spawn
      ? tr('   New agent: off ({0}).', [!ptyOptIn ? tr('turn it on with HABBLAUD_PTY=1') : tr('same lock as the terminal')])
      : spawnBin
        ? tr('   New agent: on ({0} --bg; a folder not yet trusted opens in the Claude app).', [spawnBin])
        : tr('   New agent: on, only via the Claude app (claude not found in PATH).'),
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
  ghosts.stop();
  hub.stop();
  terminals?.stop();
  ptys?.stopAll();
  names.flush();
  void closeVite?.();
  remoteListener?.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
