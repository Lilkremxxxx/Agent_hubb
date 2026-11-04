// Server configuration from environment variables (documented in server/README.md).
import { existsSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverClaudeDirs } from './accounts/detect';
import { isLoopbackBind, parseAllowedHosts } from './http/guard';
export { isLoopbackBind };
import { parseRemoteConfig, type RemoteConfig } from './http/remote';
import { tr } from '../shared/i18n';

export interface ServerConfig {
  port: number;
  host: string;
  /** `--dev`: Vite in middleware mode (HMR) on the same server. */
  dev: boolean;
  home: string;
  /** Observed Claude Code config dirs (one per account). */
  claudeDirs: string[];
  /** Where Habblaud stores its own state (persisted names). */
  dataDir: string;
  /** Extra names accepted in Host/Origin header (HABBLAUD_ALLOWED_HOSTS); localhost and IPs always valid. */
  allowedHosts: Set<string>;
  /**
   * Terminal (GET /api/agents/:id/terminal) enabled: only with local bind, i.e., Habblaud accessible only
   * from the computer itself (see terminalOffReason). Locks everything that displays or acts on sessions.
   */
  terminal: boolean;
  /** Project root (where package.json lives); serves dist/client from here. */
  rootDir: string;
  version: string;
  /**
   * Antigravity CLI workers (sources/agy/): profiles in ~/.agy_profiles; HABBLAUD_AGY=0 disables it. `usageMs` = interval for
   * each account's `/usage` (HABBLAUD_AGY_USAGE_MIN, in minutes; 0 disables it).
   */
  agy: { enabled: boolean; usageMs: number };
  /** Second port, with login, for mobile on local network (http/remote.ts); missing = disabled. */
  remote?: RemoteConfig;
  /** Why remote access was disabled when variables are incomplete. */
  remoteWarning?: string;
}

export function isTruthy(v: string | undefined): boolean {
  return !!v && /^(1|true|yes|sim|on)$/i.test(v.trim());
}

/** Walks up from `from` until finding the project package.json. */
export function findRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const name = (JSON.parse(readFileSync(pkg, 'utf8')) as { name?: unknown }).name;
        if (name === 'habblaud') return dir;
      } catch {
        // unreadable package.json: keep walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(from, '..');
}

/** Version from package.json. */
function readPackage(rootDir: string): { version: string } {
  try {
    const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as { version?: unknown };
    return { version: typeof pkg.version === 'string' ? pkg.version : '0.0.0' };
  } catch {
    return { version: '0.0.0' };
  }
}

/**
 * Why the terminal stays disabled (undefined = enabled). Transcripts contain full conversation, so it
 * only turns on when Habblaud is not exposed beyond the computer itself: HABBLAUD_HOST must be loopback.
 * HABBLAUD_TERMINAL with any value other than "enabled" (0, false, off...) disables it; there is no
 * way to enable it with an exposed port.
 */
export function terminalOffReason(env: NodeJS.ProcessEnv, host: string): string | undefined {
  const flag = env.HABBLAUD_TERMINAL?.trim();
  if (flag && !isTruthy(flag)) return `HABBLAUD_TERMINAL=${flag}`;
  return isLoopbackBind(host) ? undefined : tr('the port is exposed on the network: HABBLAUD_HOST={0}', [host]);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): ServerConfig {
  const home = env.HOME || homedir();
  const port = Number.parseInt(env.HABBLAUD_PORT ?? '', 10);
  const rootDir = findRoot(dirname(fileURLToPath(import.meta.url)));
  const host = env.HABBLAUD_HOST?.trim() || '127.0.0.1';
  const pkg = readPackage(rootDir);
  const remote = parseRemoteConfig(env);
  return {
    port: Number.isFinite(port) && port > 0 && port < 65536 ? port : 4747,
    host,
    dev: argv.includes('--dev'),
    home,
    claudeDirs: discoverClaudeDirs(env, home),
    dataDir: resolve(env.HABBLAUD_DATA_DIR?.trim() || join(home, '.habblaud')),
    allowedHosts: parseAllowedHosts(env.HABBLAUD_ALLOWED_HOSTS),
    terminal: terminalOffReason(env, host) === undefined,
    rootDir,
    version: pkg.version,
    agy: parseAgyConfig(env),
    remote: remote.config,
    remoteWarning: remote.warning,
  };
}

function parseAgyConfig(env: NodeJS.ProcessEnv): ServerConfig['agy'] {
  const min = Number(env.HABBLAUD_AGY_USAGE_MIN?.trim() || 15);
  return {
    enabled: !env.HABBLAUD_AGY?.trim() || isTruthy(env.HABBLAUD_AGY),
    usageMs: Number.isFinite(min) && min > 0 ? min * 60_000 : 0,
  };
}
