// Antigravity CLI (`agy`) accounts: an isolated profile per account in ~/.agy_profiles/accN (the HOME that
// `agy-as accN` uses), with agy state in <profile>/.gemini/antigravity-cli. Each one is an account; the ones registered
// in the team (server/team.ts) are the workers in the office.
//
// Worker name: the account's e-mail username ("alice@gmail.com" -> "alice"; up to the first dot), else the account
// ("acc2"). A seat's own name comes from team.json.
// E-mail: from the most recent "OAuth: ..." line in agy's cli.log (for name and label only; no credentials).
import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ACCOUNT_COLORS, type DetectedAccount } from '../../accounts/detect';

/** Profile root: HABBLAUD_AGY_PROFILES or ~/.agy_profiles. */
export function agyProfilesRoot(env: NodeJS.ProcessEnv, home: string): string {
  return env.HABBLAUD_AGY_PROFILES?.trim() || join(home, '.agy_profiles');
}

export interface AgyProfile {
  /** Account name ("acc2"): the profile directory and what follows `agy-as`. */
  acc: string;
  /** Profile directory (the HOME for this account's agy). */
  home: string;
  /** agy state for the account (<profile>/.gemini/antigravity-cli). */
  stateDir: string;
  email?: string;
}

/** Account e-mail from the last "server_oauth ... OAuth: ..." line in cli.log (reads only end of file). */
export function emailFromCliLog(text: string): string | undefined {
  let found: string | undefined;
  for (const line of text.split('\n')) {
    if (!line.includes('server_oauth') || !line.includes('OAuth:')) continue;
    const m = /[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/.exec(line);
    if (m) found = m[0];
  }
  return found;
}

function readTail(path: string, max = 256 * 1024): string {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return '';
  }
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, max);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/**
 * Account e-mail from the agy logs. `cli.log` links to the newest run's log, which may not have the OAuth line yet (a
 * run that just started), so older runs in log/ are tried too, newest first (the line sits near the start of each).
 */
export function emailFromLogs(stateDir: string, maxFiles = 20): string | undefined {
  const first = emailFromCliLog(readTail(join(stateDir, 'cli.log')));
  if (first) return first;
  let logs: string[];
  try {
    logs = readdirSync(join(stateDir, 'log')).filter((n) => /^cli-.*\.log$/.test(n));
  } catch {
    return undefined;
  }
  for (const name of logs.sort().reverse().slice(0, maxFiles)) {
    const email = emailFromCliLog(readHead(join(stateDir, 'log', name)));
    if (email) return email;
  }
  return undefined;
}

function readHead(path: string, max = 256 * 1024): string {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return '';
  }
  try {
    const buf = Buffer.alloc(Math.min(fstatSync(fd).size, max));
    readSync(fd, buf, 0, buf.length, 0);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Profiles with agy state, in natural order (acc1, acc2, ..., acc10). */
export function discoverAgyProfiles(root: string): AgyProfile[] {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  return names
    .filter((n) => !n.startsWith('_') && !n.startsWith('.') && isDir(join(root, n, '.gemini', 'antigravity-cli')))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((acc) => {
      const home = join(root, acc);
      const stateDir = join(home, '.gemini', 'antigravity-cli');
      const p: AgyProfile = { acc, home, stateDir };
      const email = emailFromLogs(stateDir);
      if (email) p.email = email;
      return p;
    });
}

/** Worker name: the e-mail user (up to the first dot), else the account. */
export function workerName(p: Pick<AgyProfile, 'acc' | 'email'>): string {
  return p.email?.split('@')[0].split('.')[0] || p.acc;
}

/** Name shown for the character and the account card: "alice (Agy)". */
export function workerLabel(p: Pick<AgyProfile, 'acc' | 'email'>): string {
  return `${workerName(p)} (Agy)`;
}

/**
 * Account metadata for AccountsService. Letter: the account number ("acc2" -> "2"), else the first letter; color:
 * from the account palette, after existing ones (Claude Code), wrapping around if needed.
 */
export function agyDetected(p: AgyProfile, index: number, takenColors: readonly string[]): DetectedAccount {
  const free = ACCOUNT_COLORS.filter((c) => !takenColors.includes(c));
  const palette = free.length ? free : ACCOUNT_COLORS;
  const d: DetectedAccount = {
    id: `agy:${p.acc}`,
    configDir: p.stateDir,
    short: (/\d+$/.exec(p.acc)?.[0] ?? p.acc[0] ?? 'A').toUpperCase(),
    name: workerLabel(p),
    color: palette[index % palette.length],
  };
  if (p.email) d.email = p.email;
  return d;
}
