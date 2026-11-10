// API calls for the interactive terminal (server/http/pty.ts). Errors become Error with server message.
import type { AgentInfo, PtyInfo } from '../../../shared/types';
import { access } from '../net/access';
import { providerOf } from './provider';
import { tr } from '../../../shared/i18n';

/**
 * Can this agent be stopped or taken over from the office? Only the main agent of a Claude Code session:
 * other tools have no session tracking or `--resume` here.
 */
export function ptyControllable(a: Pick<AgentInfo, 'id' | 'kind' | 'provider'> | null | undefined): boolean {
  return !!a && a.kind === 'main' && providerOf(a) === 'claude';
}

export async function postPty<T = unknown>(url: string, body: unknown): Promise<T | undefined> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  } catch {
    throw new Error(tr("Habblaud didn't respond"));
  }
  if (res.status === 204) return undefined;
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw Object.assign(new Error(j.error ?? tr('error {0}', [res.status])), { status: res.status });
  return j as T;
}

const SIZE = { cols: 120, rows: 32 };

/** New Claude Code session in the specified directory (and account), optionally with a first prompt. */
export function createPty(cwd: string, account?: string, prompt?: string, model?: string): Promise<PtyInfo | undefined> {
  return postPty<PtyInfo>('/api/pty', { cwd, account, prompt, model, ...SIZE });
}

export type StepUpTarget = { ptyId: string } | { agentId: string };
type Ceremony = (options: unknown) => Promise<unknown>;
const defaultStart: Ceremony = async (o) => (await import('@simplewebauthn/browser')).startAuthentication(o as never);

/**
 * Remote only: passkey check before typing into a terminal (or taking an agent over). Returns a single-use grant
 * (60 s) for that target. Needs a user gesture in the iframe, so call it from a click.
 */
export async function stepUp(target: StepUpTarget, start: Ceremony = defaultStart): Promise<string> {
  const options = await postPty('/api/remote/stepup/options', {});
  let response: unknown;
  try {
    response = await start(options);
  } catch (e) {
    const n = (e as { name?: string }).name;
    throw new Error(n === 'NotAllowedError' || n === 'AbortError' ? tr('Passkey check cancelled.') : tr("Didn't work: {0}", [(e as Error).message]));
  }
  const r = await postPty<{ grant: string }>('/api/remote/stepup/verify', { response, ...target });
  return r!.grant;
}

/** Ends session in another terminal and continues the same conversation here. Remote: passkey check first; the answer carries a grant to attach the new terminal. */
export async function takeoverAgent(agentId: string, start?: Ceremony): Promise<(PtyInfo & { grant?: string | null }) | undefined> {
  const grant = access().remote ? await stepUp({ agentId }, start) : undefined;
  return postPty<PtyInfo & { grant?: string | null }>(`/api/agents/${encodeURIComponent(agentId)}/takeover`, grant ? { ...SIZE, grant } : SIZE);
}

/** Stops agent (here or in another terminal). */
export async function stopAgent(agentId: string): Promise<void> {
  await postPty(`/api/agents/${encodeURIComponent(agentId)}/stop`, {});
}

export async function closePty(id: string): Promise<void> {
  await postPty(`/api/pty/${encodeURIComponent(id)}/close`, {});
}
