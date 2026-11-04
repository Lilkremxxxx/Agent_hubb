// The team and the workers' terminals, from the page: POST /api/team (server/team.ts) and /api/workers/* (server/workers).
// A worker is a seat of ~/.habblaud/team.json; each seat has a terminal to watch. The boss gives jobs through agy-ask / claude-ask; here you give them too and cancel them.
// Errors become Error with the server's message (a BUSY answer's `message`, else `error`).
import type { AgentInfo, PtyInfo, TeamInfo, WorkerId, WorkerJob, WorkerKind, WorkerSession } from '../../../shared/types';
import { tr } from '../../../shared/i18n';

/** A refusal from the server, with its HTTP status (e.g. 409 = changed meanwhile). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error(tr("Habblaud didn't respond"));
  }
  const j = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new ApiError(j.message ?? j.error ?? tr('error {0}', [res.status]), res.status);
  return j;
}

/** Appoints a Claude Code session as the boss (null = no boss). `pendingAccount` = a session just opened, not in the office yet. */
export function appointBoss(agentId: string | null, pendingAccount?: string): Promise<unknown> {
  return post('/api/team', { boss: agentId, ...(pendingAccount ? { pendingAccount } : {}) });
}

/** Opens the boss terminal (by the boss kind in team.json, in the office folder); the server answers with its terminal. */
export async function openBoss(): Promise<PtyInfo | undefined> {
  return (await post<{ pty?: PtyInfo }>('/api/team', { openBoss: true })).pty;
}

export interface AskRequest {
  worker: WorkerId;
  prompt: string;
  role?: string;
  mode?: string;
  effort?: string;
}

/** Gives a worker a job through its terminal (a fresh conversation); BUSY (a job runs) throws. */
export async function askWorker(req: AskRequest): Promise<WorkerJob> {
  return (await post<{ job: WorkerJob }>('/api/workers/ask', req)).job;
}

/** Cancels one job, every job of a worker, or all of them; returns how many. */
export async function cancelJobs(target: { job: string } | { worker: WorkerId } | { all: true }): Promise<number> {
  return (await post<{ cancelled?: number }>('/api/workers/cancel', target)).cancelled ?? 0;
}

// ---------------------------------------------------------------- pure helpers (workers-api.test.ts)

export function workerKind(worker: WorkerId): WorkerKind {
  return worker.startsWith('claude:') ? 'claude' : 'agy';
}

/** The terminal session of a seat's character. */
export function sessionOfAgent(team: Pick<TeamInfo, 'sessions'> | undefined, agentId: string): WorkerSession | undefined {
  return team?.sessions?.find((s) => s.agentId === agentId);
}

export function sessionOf(team: Pick<TeamInfo, 'sessions'> | undefined, worker: WorkerId): WorkerSession | undefined {
  return team?.sessions?.find((s) => s.worker === worker);
}

/** The seat behind a character: its terminal session (a seat has one character). */
export function workerOfAgent(team: Pick<TeamInfo, 'workers' | 'sessions'> | undefined, a: Pick<AgentInfo, 'id' | 'provider'>): WorkerId | undefined {
  return sessionOfAgent(team, a.id)?.worker;
}

/** A job still running or waiting (it can be cancelled). */
export function jobOpen(status: string): boolean {
  return status === 'queued' || status === 'working';
}
