// npm run remote:setup — enables phone access with login and HTTPS, in a single step.
//
// Prompts for (or takes as options) username, password (hidden, twice), address name (<name>.local) and,
// optionally, a custom address (e.g. myclaude.home); and then:
//   1. creates the local CA and server certificate (server/remote/tls.ts) in ~/.habblaud/remote-tls;
//   2. writes ONLY the scrypt hash of the password (never the password) to <data dir>/hub.env (default
//      ~/.habblaud/hub.env; never the repo .env), with name and port;
//   3. keeps the <name>.local announcement running as a service (npm run remote:mdns; LaunchAgent/systemd);
//   4. prints the addresses, CA fingerprint and phone setup instructions.
// Afterwards: npm run office. To disable: npm run remote:setup -- --off.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { addToList, readEnvValue, updateEnv } from '../server/remote/envfile';
import { GOOGLE_EMAIL_RE, GOOGLE_ID_RE, GOOGLE_SECRET_RE, googleRedirectUri } from '../server/remote/google';
import { hashPassword } from '../server/remote/password';
import { tr } from '../shared/i18n';
import { caFingerprint, ensureServerCert, isValidDomain, isValidName, primaryIp, remoteTargets, remoteTlsBase, tlsPaths } from '../server/remote/tls';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOME = process.env.HOME || homedir();

/** Data dir (HABBLAUD_DATA_DIR, default ~/.habblaud). Tests point it at a temp dir. */
export function dataDirOf(env: NodeJS.ProcessEnv): string {
  return env.HABBLAUD_DATA_DIR?.trim() || join(env.HOME || homedir(), '.habblaud');
}
export const hubEnvPath = (env: NodeJS.ProcessEnv): string => join(dataDirOf(env), 'hub.env');
export const passkeysPath = (env: NodeJS.ProcessEnv): string => join(dataDirOf(env), 'remote', 'passkeys.json');
export const MIN_PASSWORD = 10;
const SERVICE_LABEL = 'com.habblaud.remote-mdns';
function GOOGLE_KEYS(): string[] {
  return ['HABBLAUD_REMOTE_GOOGLE_CLIENT_ID', 'HABBLAUD_REMOTE_GOOGLE_CLIENT_SECRET', 'HABBLAUD_REMOTE_GOOGLE_EMAILS'];
}
const REMOTE_KEYS = [
  'HABBLAUD_REMOTE_USER',
  'HABBLAUD_REMOTE_PASSWORD',
  'HABBLAUD_REMOTE_PASSWORD_HASH',
  'HABBLAUD_REMOTE_BIND',
  'HABBLAUD_REMOTE_PORT',
  'HABBLAUD_REMOTE_HTTP_PORT',
  'HABBLAUD_REMOTE_NAME',
  'HABBLAUD_REMOTE_DOMAIN',
  'HABBLAUD_REMOTE_ALLOW',
  'HABBLAUD_REMOTE_HOST',
  'HABBLAUD_REMOTE_PASSWORD_LOGIN',
  ...GOOGLE_KEYS(),
];

// hub.env is read by sh (scripts/hub-env.sh) and systemd: what goes into it is validated at the trust boundary, and every
// written value is single-quoted as a second layer.
const USER_RE = /^[A-Za-z0-9._@-]{1,64}$/;
const HOST_RE = /^[A-Za-z0-9.-]{1,253}$/;

export function checkUser(user: string): string {
  if (!USER_RE.test(user)) throw new Error(tr('invalid username (1-64 of letters, numbers, . _ @ -)'));
  return user;
}

function checkName(name: string): string {
  if (!isValidName(name)) throw new Error(tr('invalid name: "{0}" (letters, numbers and hyphens)', [name]));
  return name;
}

function checkDomain(domain: string): string {
  if (!isValidDomain(domain)) throw new Error(tr('invalid address: "{0}"', [domain]));
  return domain;
}

export function checkAllow(allow: string): string {
  const parts = allow.split(',').map((x) => x.trim());
  if (!allow.trim() || !parts.every((x) => x === 'terminal' || x === 'none')) throw new Error(tr('invalid --allow "{0}" (only terminal, none)', [allow]));
  return allow;
}

/** Existing allowed-hosts entries plus new ones; anything that is not a plain host name is refused. */
function hostList(current: string, ...names: string[]): string {
  const list = addToList(readEnvValue(current, 'HABBLAUD_ALLOWED_HOSTS'), ...names);
  for (const h of list.split(',')) if (h && !HOST_RE.test(h)) throw new Error(tr('invalid host in HABBLAUD_ALLOWED_HOSTS: "{0}"', [h]));
  return list;
}

export interface SetupArgs {
  user?: string;
  name?: string;
  domain?: string;
  port?: number;
  allow?: string;
  behindProxy: boolean;
  resetPasskeys: boolean;
  googleClientId?: string;
  googleEmails?: string[];
  googleSecretStdin: boolean;
  googleOff: boolean;
  passwordStdin: boolean;
  service: boolean;
  off: boolean;
  help: boolean;
}

const USAGE = tr(`Usage: npm run remote:setup [-- options]

Turns on phone access (https://<name>.local) with username, password and HTTPS. Settings go to hub.env in the data dir (never the repo .env).
With --behind-proxy the hub domain is accepted only on the remote port, never on 4747.

  --user <name>        login username (default: your system username)
  --name <name>        address <name>.local (default: habblaud)
  --domain <address>   own address, e.g. myclaude.home (needs an entry in the router's DNS)
  --port <n>           port on the computer (default: 443 if free, otherwise 4748)
  --allow <list>       what the phone can do: terminal, none (default: none; with --behind-proxy: terminal, which lets a password holder read transcripts over the Internet; use --allow none for view only)
  --behind-proxy       Cloudflare Tunnel hub: plain HTTP on loopback, needs --domain, no certificate, no mDNS (default port 4748)
  --reset-passkeys     deletes the registered passkeys (stop the service first; the command tells you the steps)
  --password-stdin     reads the password from standard input (automation) instead of asking
  --no-service         doesn't install the <name>.local announcement service (run npm run remote:mdns yourself)
  --google-client-id <id>   Sign in with Google: OAuth client id (see docs/deploy.md, "Google sign-in")
  --google-email <addr>     allowed Google account (repeat the option or use a comma list; replaces the list)
                            the client secret is read from the GOOGLE_CLIENT_SECRET variable, --google-secret-stdin, or a hidden prompt; never from an option
  --google off              removes the three Google keys
  --off                turns off phone access (removes the lines from hub.env and the service; keeps the CA)`);

export function parseArgs(argv: string[]): SetupArgs {
  const out: SetupArgs = { passwordStdin: false, googleSecretStdin: false, googleOff: false, service: true, off: false, help: false, behindProxy: false, resetPasskeys: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // Any option that looks like it carries a secret is refused without echoing it (the secret never travels in argv).
    if (/secret/i.test(a) && a !== '--google-secret-stdin') throw new Error(tr('the Google client secret is never an option: use GOOGLE_CLIENT_SECRET, --google-secret-stdin or the prompt'));
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(tr('missing value for {0}', [a]));
      return v;
    };
    if (a === '--user') out.user = checkUser(val());
    else if (a === '--name') out.name = checkName(val().toLowerCase());
    else if (a === '--domain') out.domain = checkDomain(val().toLowerCase());
    else if (a === '--port') out.port = Number(val());
    else if (a === '--allow') out.allow = checkAllow(val());
    else if (a === '--google-client-id') out.googleClientId = checkGoogle('client id', val(), GOOGLE_ID_RE);
    else if (a === '--google-email') out.googleEmails = [...(out.googleEmails ?? []), ...val().split(',').map((e) => checkGoogle('email', e.trim().toLowerCase(), GOOGLE_EMAIL_RE))];
    else if (a === '--google-secret-stdin') out.googleSecretStdin = true;
    else if (a === '--google') {
      if (val() !== 'off') throw new Error(tr('invalid --google (only "off")'));
      out.googleOff = true;
    }
    else if (a === '--behind-proxy') out.behindProxy = true;
    else if (a === '--reset-passkeys') out.resetPasskeys = true;
    else if (a === '--password-stdin') out.passwordStdin = true;
    else if (a === '--no-service') out.service = false;
    else if (a === '--off') out.off = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(tr('unknown option: {0}', [a]));
  }
  if (out.googleOff && (out.googleClientId || out.googleEmails || out.googleSecretStdin)) throw new Error(tr('--google off cannot be combined with other Google options'));
  if (out.googleSecretStdin && out.passwordStdin) throw new Error(tr('--google-secret-stdin and --password-stdin both read standard input: use GOOGLE_CLIENT_SECRET for one of them'));
  if (out.port !== undefined && !(Number.isInteger(out.port) && out.port > 0 && out.port < 65536)) throw new Error(tr('invalid port'));
  return out;
}

function checkGoogle(what: string, v: string, re: RegExp): string {
  if (!re.test(v)) throw new Error(tr('invalid Google {0}', [what])); // never echoes the value: it may be the secret
  return v;
}

/** The .env with the three Google keys changed (omitted pieces keep their current value) or removed. Needs the hub domain. */
export function googleEnv(current: string, g: { off?: boolean; clientId?: string; emails?: string[]; secret?: string }): string {
  if (g.off) return updateEnv(current, Object.fromEntries(GOOGLE_KEYS().map((k) => [k, null])), { quote: true });
  const domain = readEnvValue(current, 'HABBLAUD_REMOTE_DOMAIN');
  if (!domain) throw new Error(tr('Google sign-in needs the hub domain: run with --behind-proxy --domain <address> first'));
  const [idKey, secretKey, emailsKey] = GOOGLE_KEYS();
  const clientId = checkGoogle('client id', g.clientId ?? readEnvValue(current, idKey) ?? '', GOOGLE_ID_RE);
  const secret = checkGoogle('client secret', g.secret ?? readEnvValue(current, secretKey) ?? '', GOOGLE_SECRET_RE);
  const emails = [...new Set(g.emails ?? (readEnvValue(current, emailsKey) ?? '').split(',').filter(Boolean))];
  if (!emails.length) throw new Error(tr('Google sign-in needs at least one --google-email'));
  for (const e of emails) checkGoogle('email', e, GOOGLE_EMAIL_RE);
  return updateEnv(current, { [idKey]: clientId, [secretKey]: secret, [emailsKey]: emails.join(',') }, { quote: true });
}

/** Secret from GOOGLE_CLIENT_SECRET, stdin, or (new client id / nothing stored yet) a hidden prompt; undefined keeps the stored one. */
async function googleSecret(args: SetupArgs, current: string): Promise<string | undefined> {
  const fromEnv = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (args.googleSecretStdin) return (await readStdinLine()).trim();
  if (args.googleClientId || !readEnvValue(current, GOOGLE_KEYS()[1])) return (await askHidden(tr('Google client secret (hidden while you type)'), tr('no terminal to ask for the Google client secret: use --google-secret-stdin or GOOGLE_CLIENT_SECRET'))).trim() || undefined;
  return undefined;
}

const wantsGoogle = (a: SetupArgs): boolean => !!(a.googleClientId || a.googleEmails || a.googleSecretStdin);

function googleDone(current: string): string {
  const domain = readEnvValue(current, 'HABBLAUD_REMOTE_DOMAIN') ?? '';
  return tr('  Google sign-in: on for {0}. Redirect URI to register in Google Cloud Console: {1}', [readEnvValue(current, 'HABBLAUD_REMOTE_GOOGLE_EMAILS') ?? '', googleRedirectUri(domain)]);
}

/** Why the password is not accepted (undefined = valid). */
export function passwordProblem(password: string, user: string): string | undefined {
  if (password.length < MIN_PASSWORD) return tr('use at least {0} characters', [MIN_PASSWORD]);
  if (password.trim() !== password) return tr('no spaces at the start or end');
  if (password.toLowerCase() === user.toLowerCase()) return tr("the password can't be the username");
  return undefined;
}

/** The .env with remote access enabled (the rest of the file stays the same). */
export function remoteEnv(
  current: string,
  s: { user: string; hash: string; name: string; domain?: string; port: number; httpPort?: number; allow?: string },
): string {
  checkUser(s.user);
  checkName(s.name);
  if (s.domain) checkDomain(s.domain);
  if (s.allow) checkAllow(s.allow);
  const hosts = hostList(current, `${s.name}.local`, ...(s.domain ? [s.domain] : []));
  return updateEnv(current, {
    HABBLAUD_REMOTE_USER: s.user,
    HABBLAUD_REMOTE_PASSWORD: null,
    HABBLAUD_REMOTE_PASSWORD_HASH: s.hash,
    HABBLAUD_REMOTE_BIND: null, // old Docker-era key
    HABBLAUD_REMOTE_HOST: null,
    HABBLAUD_REMOTE_PORT: String(s.port),
    HABBLAUD_REMOTE_HTTP_PORT: s.httpPort ? String(s.httpPort) : null,
    HABBLAUD_REMOTE_NAME: s.name,
    HABBLAUD_REMOTE_DOMAIN: null, // LAN mode: a stale proxy domain would switch the server to proxy mode
    HABBLAUD_REMOTE_ALLOW: s.allow ?? readEnvValue(current, 'HABBLAUD_REMOTE_ALLOW') ?? null,
    HABBLAUD_ALLOWED_HOSTS: hosts,
  }, { quote: true });
}

/** hub.env for the Cloudflare hub: loopback HTTP, own domain, no LAN keys. Default allow is terminal: a password holder can read transcripts over the Internet. */
export function proxyEnv(current: string, s: { user: string; hash: string; domain: string; port: number; allow?: string }): string {
  checkUser(s.user);
  checkDomain(s.domain);
  if (s.allow) checkAllow(s.allow);
  return updateEnv(current, {
    HABBLAUD_REMOTE_USER: s.user,
    HABBLAUD_REMOTE_PASSWORD: null,
    HABBLAUD_REMOTE_PASSWORD_HASH: s.hash,
    HABBLAUD_REMOTE_HOST: '127.0.0.1',
    HABBLAUD_REMOTE_PORT: String(s.port),
    HABBLAUD_REMOTE_DOMAIN: s.domain,
    // The hub domain belongs to the remote port only (the server adds it there); drop a copy left by an older setup.
    HABBLAUD_ALLOWED_HOSTS: hostList(current).split(',').filter((h) => h && h !== s.domain).join(',') || null,
    HABBLAUD_REMOTE_ALLOW: s.allow ?? readEnvValue(current, 'HABBLAUD_REMOTE_ALLOW') ?? 'terminal',
    HABBLAUD_REMOTE_BIND: null,
    HABBLAUD_REMOTE_NAME: null,
    HABBLAUD_REMOTE_HTTP_PORT: null,
  }, { quote: true });
}

/** Deletes passkeys.json. PasskeyStore reads the file only at start, so the service must be stopped first and started after. */
export function resetPasskeys(env: NodeJS.ProcessEnv): string {
  rmSync(passkeysPath(env), { force: true });
  return tr('[remote-setup] Passkeys removed. With bang-hub.service: systemctl --user stop bang-hub BEFORE this command and systemctl --user start bang-hub after (npm run office -- stop/start only when the unit is not enabled); a running server keeps its passkeys in memory and may rewrite the file.');
}

export function urlFor(host: string, port: number): string {
  return port === 443 ? `https://${host}` : `https://${host}:${port}`;
}

function portFree(port: number): Promise<boolean> {
  return new Promise((ok) => {
    const srv = net.createServer();
    srv.once('error', () => ok(false));
    srv.listen(port, '0.0.0.0', () => srv.close(() => ok(true)));
  });
}

function ask(question: string, fallback?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((ok) =>
    rl.question(fallback ? `${question} [${fallback}]: ` : `${question}: `, (a) => {
      rl.close();
      ok(a.trim() || fallback || '');
    }),
  );
}

/** Prompts without echoing input (real terminal only). */
function askHidden(question: string, noTty = tr('no terminal to ask for the password: use --password-stdin')): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) throw new Error(noTty);
  return new Promise((ok) => {
    process.stdout.write(`${question}: `);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          ok(buf);
          return;
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);
        else if (ch >= ' ') buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

function readStdinLine(): Promise<string> {
  return new Promise((ok) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c: string) => (data += c));
    process.stdin.on('end', () => ok(data.split(/\r?\n/)[0] ?? ''));
  });
}

export function writeHubEnv(env: NodeJS.ProcessEnv, content: string): void {
  const file = hubEnvPath(env);
  const dir = dirname(file);
  const existed = existsSync(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!existed) chmodSync(dir, 0o700);
  else if (statSync(dir).mode & 0o002) console.error(tr('warning: {0} is writable by everyone; fix its permissions', [dir]));
  const tmp = `${file}.tmp`;
  rmSync(tmp, { force: true }); // a stale file or symlink must not be followed
  writeFileSync(tmp, content, { mode: 0o600, flag: 'wx' });
  renameSync(tmp, file);
}

function writeEnv(content: string): void {
  writeHubEnv(process.env, content);
}

function tsxCommand(): string[] {
  return [process.execPath, join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(ROOT, 'scripts', 'remote-mdns.ts')];
}

function plistPath(): string {
  return join(HOME, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
}

function unitPath(): string {
  return join(HOME, '.config', 'systemd', 'user', 'habblaud-remote-mdns.service');
}

function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Installs (or reinstalls) the <name>.local announcement as a service. Returns a status line. */
function installService(): string {
  const cmd = tsxCommand();
  const logDir = join(HOME, '.habblaud', 'logs');
  mkdirSync(logDir, { recursive: true });
  const pathEnv = [dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  if (process.platform === 'darwin') {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${SERVICE_LABEL}</string>
  <key>WorkingDirectory</key><string>${xml(ROOT)}</string>
  <key>ProgramArguments</key>
  <array>${cmd.map((c) => `<string>${xml(c)}</string>`).join('')}</array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(pathEnv)}</string><key>HOME</key><string>${xml(HOME)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(join(logDir, 'remote-mdns.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(join(logDir, 'remote-mdns.log'))}</string>
</dict>
</plist>
`;
    mkdirSync(dirname(plistPath()), { recursive: true });
    writeFileSync(plistPath(), plist);
    const domain = `gui/${process.getuid?.() ?? userInfo().uid}`;
    spawnSync('launchctl', ['bootout', `${domain}/${SERVICE_LABEL}`], { stdio: 'ignore' });
    const r = spawnSync('launchctl', ['bootstrap', domain, plistPath()], { encoding: 'utf8' });
    return r.status === 0 ? tr('service {0} enabled (log: ~/.habblaud/logs/remote-mdns.log)', [SERVICE_LABEL]) : tr("couldn't enable the service: {0}", [String(r.stderr).trim()]);
  }
  if (process.platform === 'linux') {
    const unit = `[Unit]
Description=${tr('Habblaud: announces the .local address for phone access')}
After=network-online.target

[Service]
WorkingDirectory=${ROOT}
Environment=PATH=${pathEnv}
ExecStart=${cmd.map((c) => (/\s/.test(c) ? `"${c}"` : c)).join(' ')}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;
    mkdirSync(dirname(unitPath()), { recursive: true });
    writeFileSync(unitPath(), unit);
    spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
    const r = spawnSync('systemctl', ['--user', 'enable', '--now', 'habblaud-remote-mdns.service'], { encoding: 'utf8' });
    return r.status === 0
      ? tr('habblaud-remote-mdns service enabled (to keep it on while logged out: loginctl enable-linger)')
      : tr("couldn't enable the service: {0}", [String(r.stderr).trim()]);
  }
  return tr('{0}: no automatic service; keep npm run remote:mdns running or use the IP', [process.platform]);
}

function removeService(): void {
  if (process.platform === 'darwin' && existsSync(plistPath())) {
    spawnSync('launchctl', ['bootout', `gui/${process.getuid?.() ?? userInfo().uid}/${SERVICE_LABEL}`], { stdio: 'ignore' });
    rmSync(plistPath(), { force: true });
  }
  if (process.platform === 'linux' && existsSync(unitPath())) {
    spawnSync('systemctl', ['--user', 'disable', '--now', 'habblaud-remote-mdns.service'], { stdio: 'ignore' });
    rmSync(unitPath(), { force: true });
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return void console.log(USAGE);
  if (args.resetPasskeys) return void console.log(resetPasskeys(process.env));
  const hub = hubEnvPath(process.env);
  const current = existsSync(hub) ? readFileSync(hub, 'utf8') : '';

  // A lone GOOGLE_CLIENT_SECRET (rotation) is Google-only too: it must never fall into the normal setup, which asks for a new password and ends every session.
  if (args.googleOff || (!args.behindProxy && (wantsGoogle(args) || !!process.env.GOOGLE_CLIENT_SECRET?.trim()))) {
    // Google only: no password prompt, so the password hash (and every session) stays as it is.
    if (!existsSync(hub)) throw new Error(tr('no hub.env yet: run --behind-proxy first'));
    const next = googleEnv(current, args.googleOff ? { off: true } : { clientId: args.googleClientId, emails: args.googleEmails, secret: await googleSecret(args, current) });
    writeEnv(next);
    console.log(args.googleOff ? tr('[remote-setup] Google sign-in removed. Now: systemctl --user restart bang-hub') : `${tr('[remote-setup] Done.')}\n${googleDone(next)}\n${tr('  Now: systemctl --user restart bang-hub')}`);
    return;
  }

  if (args.off) {
    if (existsSync(hub)) writeEnv(updateEnv(current, Object.fromEntries(REMOTE_KEYS.map((k) => [k, null])), { quote: true }));
    removeService();
    console.log(tr('[remote-setup] Phone access turned off (the CA stays in ~/.habblaud/remote-tls). Now: restart the office (systemctl --user restart bang-hub; npm run office -- restart only when the unit is not enabled)'));
    return;
  }

  const user = args.user ?? (args.passwordStdin ? undefined : await ask(tr('Login username'), readEnvValue(current, 'HABBLAUD_REMOTE_USER') ?? userInfo().username));
  if (!user) throw new Error(tr('invalid username (1-64 of letters, numbers, . _ @ -)'));
  checkUser(user);

  let password: string;
  if (args.passwordStdin) {
    password = await readStdinLine();
    const problem = passwordProblem(password, user);
    if (problem) throw new Error(tr('password rejected: {0}', [problem]));
  } else {
    for (;;) {
      password = await askHidden(tr('Password ({0}+ characters; hidden while you type)', [MIN_PASSWORD]));
      const problem = passwordProblem(password, user);
      if (problem) {
        console.log(`  ${problem}.`);
        continue;
      }
      if ((await askHidden(tr('Repeat the password'))) !== password) {
        console.log(tr("  they don't match; try again."));
        continue;
      }
      break;
    }
  }

  if (args.behindProxy) {
    const dom = (args.domain ?? (args.passwordStdin ? '' : await ask(tr('Public domain (e.g. hub.example.com)')))).trim().toLowerCase();
    if (!dom || !isValidDomain(dom)) throw new Error(tr('--behind-proxy needs a valid --domain'));
    console.log(tr('[remote-setup] Generating the password hash…'));
    const proxyHash = await hashPassword(password);
    let next = proxyEnv(current, { user, hash: proxyHash, domain: dom, port: args.port ?? 4748, allow: args.allow });
    if (wantsGoogle(args)) next = googleEnv(next, { clientId: args.googleClientId, emails: args.googleEmails, secret: await googleSecret(args, next) });
    writeEnv(next);
    const allow = readEnvValue(readFileSync(hub, 'utf8'), 'HABBLAUD_REMOTE_ALLOW');
    console.log(
      [
        '',
        tr('[remote-setup] Done. Settings are in {0} (mode 600); the repo .env is untouched.', [hub]),
        tr('  user "{0}", password stored only as a hash (scrypt), loopback port {1}, domain {2}', [user, args.port ?? 4748, dom]),
        ...(allow?.split(',').includes('terminal') ? [tr('  Warning: allow=terminal lets anyone with the password read session transcripts over the Internet. For view-only office use: --allow none.')] : []),
        ...(wantsGoogle(args) ? [googleDone(next)] : []),
        tr('  Next: docs/deploy.md (go-live runbook).'),
      ].join('\n'),
    );
    return;
  }

  const name = args.name ?? (args.passwordStdin ? 'habblaud' : await ask(tr('Address name (becomes <name>.local)'), readEnvValue(current, 'HABBLAUD_REMOTE_NAME') ?? 'habblaud')).toLowerCase();
  if (!isValidName(name)) throw new Error(tr('invalid name: "{0}" (letters, numbers and hyphens)', [name]));
  const domainAnswer =
    args.domain ??
    (args.passwordStdin ? '' : await ask(tr('Own address, optional (e.g. myclaude.home; Enter skips)'), readEnvValue(current, 'HABBLAUD_REMOTE_DOMAIN') ?? ''));
  const domain = domainAnswer.trim().toLowerCase() || undefined;
  if (domain && !isValidDomain(domain)) throw new Error(tr('invalid address: "{0}"', [domain]));

  const existingPort = Number(readEnvValue(current, 'HABBLAUD_REMOTE_PORT'));
  const port = args.port ?? (Number.isInteger(existingPort) && existingPort > 0 ? existingPort : (await portFree(443)) ? 443 : 4748);

  // On 443, port 80 (if free) just redirects to https://: typing "myclaude.local" without https:// also works.
  const existingHttp = Number(readEnvValue(current, 'HABBLAUD_REMOTE_HTTP_PORT'));
  const httpPort = port !== 443 ? undefined : existingHttp === 80 || (await portFree(80)) ? 80 : undefined;

  console.log(tr('[remote-setup] Generating the password hash…'));
  const hash = await hashPassword(password);
  const paths = tlsPaths(remoteTlsBase(HOME));
  const hadCa = caFingerprint(paths);
  const cert = ensureServerCert(paths, remoteTargets({ name, domain }), { force: true, newCa: true });
  if (/\bspawn\b/i.test(args.allow ?? '')) console.error('warning: "spawn" is no longer a remote feature and is ignored (only "terminal" or "none").');
  writeEnv(remoteEnv(current, { user, hash, name, domain, port, httpPort, allow: args.allow }));
  const service = args.service ? installService() : tr('service not installed (--no-service): run npm run remote:mdns');

  const fp = caFingerprint(paths);
  // Wi-Fi/cable IP (default route), not a VPN IP which also enters the certificate.
  const ip = primaryIp() ?? cert.targets.ips.find((i) => i !== '127.0.0.1');
  const caNote = !cert.createdCa ? '' : hadCa ? tr(' New local CA (the address changed or the previous one had no name constraints): install the certificate on the phone again.') : tr(' Local CA created.');
  const urls = [
    `${urlFor(`${name}.local`, port)}${ip ? tr('   (or {0})', [urlFor(ip, port)]) : ''}`,
    ...(domain ? [tr('{0}   (after creating it in the router: {1} -> {2})', [urlFor(domain, port), domain, ip ?? tr("this computer's IP")])] : []),
  ];
  console.log(
    [
      '',
      tr('[remote-setup] Done.{0}', [caNote]),
      tr('  .env:        user "{0}", password stored only as a hash (scrypt), port {1}', [user, port]),
      tr('  Certificate: {0}', [cert.targets.dns.concat(cert.targets.ips).join(', ')]),
      tr('  Announcing:  {0}', [service]),
      '',
      tr('  Now run:     npm run office'),
      '',
      tr('  On the phone (same Wi-Fi):'),
      ...urls.map((u) => `    ${u}`),
      tr('  First time: accept the warning, tap "Install the Habblaud certificate" and trust it'),
      tr('    iPhone:  Settings > Profile Downloaded > Install; then Settings > General > About > Certificate Trust Settings'),
      tr('    Android: Settings > Security > Encryption & credentials > Install a certificate > CA certificate'),
      tr('  CA fingerprint (check it on the phone before trusting it):'),
      `    ${fp ?? tr('(unavailable)')}`,
    ].join('\n'),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err: unknown) => {
    console.error(tr('[remote-setup] Error: {0}', [(err as Error).message]));
    process.exitCode = 1;
  });
}
