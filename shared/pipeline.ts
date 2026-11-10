// The pipeline roster: who does each of the four fixed roles of /bang-skill:pipeline, and the first prompt that
// tells the new boss session so. Pure: used by the dialog (client) and its tests.
export const ROLES = ['planner', 'coder', 'tester', 'reviewer'] as const;
export type Role = (typeof ROLES)[number];
/** Subagent models: what the Agent tool takes, each the newest version of its family. */
export const MODELS = ['opus', 'sonnet', 'haiku'] as const;
/** Full ids for the boss (`claude --model`) and Claude seats (`worker-ask --model`): an older version can be picked here. */
export const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-sonnet-4-6', 'claude-haiku-5-5'] as const;
export const BOSS_MODEL = 'claude-opus-5-5';
export const SEAT_MODEL = 'claude-sonnet-5-5';
// shortcut: the version names are kept by hand, update them (and CLAUDE_MODELS) when a new model ships.
export const MODEL_LABEL: Record<string, string> = {
  opus: 'Opus 5.5',
  sonnet: 'Sonnet 5.5',
  haiku: 'Haiku 5.5',
  'claude-opus-5-5': 'Opus 5.5',
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-haiku-5-5': 'Haiku 5.5',
};
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const AGY_EFFORTS = ['low', 'medium', 'high'] as const;

export type Assignee =
  /** A subagent of the boss itself. */
  | { type: 'sub'; model: string; effort: string }
  /** A seat of team.json; an agy seat has no model (always Gemini 3.8 Flash). */
  | { type: 'seat'; seat: string; kind: 'agy' | 'claude'; model?: string; effort: string };
export type Roster = Record<Role, Assignee>;
export interface SeatRef {
  name: string;
  kind: 'agy' | 'claude';
}

const sub = (model: string, effort = 'high'): Assignee => ({ type: 'sub', model, effort });
/** As in skills/pipeline/SKILL.md. */
export const DEFAULT_ROSTER: Roster = { planner: sub('opus'), coder: sub('sonnet'), tester: sub('sonnet'), reviewer: sub('opus') };

export const has = (list: readonly string[], v: unknown): v is string => typeof v === 'string' && list.includes(v);

/** A saved roster (localStorage, untrusted) made valid against the current seats; anything wrong falls back to the default for that role. */
export function cleanRoster(raw: unknown, seats: readonly SeatRef[]): Roster {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = Object.fromEntries(ROLES.map((r) => [r, { ...DEFAULT_ROSTER[r] }])) as Roster;
  for (const role of ROLES) {
    const a = src[role] as Record<string, unknown> | null | undefined;
    if (!a || typeof a !== 'object') continue;
    if (a.type === 'sub' && has(MODELS, a.model) && has(EFFORTS, a.effort)) out[role] = { type: 'sub', model: a.model, effort: a.effort };
    const seat = a.type === 'seat' ? seats.find((s) => s.name === a.seat) : undefined;
    if (!seat || !has(EFFORTS, a.effort)) continue;
    if (seat.kind === 'agy') out[role] = { type: 'seat', seat: seat.name, kind: 'agy', effort: has(AGY_EFFORTS, a.effort) ? a.effort : 'high' };
    else out[role] = { type: 'seat', seat: seat.name, kind: 'claude', model: has(CLAUDE_MODELS, a.model) ? a.model : SEAT_MODEL, effort: a.effort };
  }
  return out;
}

/** The first prompt of the boss session (sent to the agent, so not translated). */
export function pipelinePrompt(r: Roster): string {
  const lines = ROLES.map((role) => {
    const a = r[role];
    if (a.type === 'sub') return `${role}: Agent(subagent_type:"bang-skill:${role}", model:"${a.model}", effort:"${a.effort}")`;
    return `${role}: worker-ask ${a.seat} "<job in the 6 parts of the giao-viec skill>" --role ${role} --effort ${a.effort}${a.model ? ` --model ${a.model}` : ''}`;
  });
  return ['/bang-skill:pipeline', ...lines, 'This table wins over the model written in SKILL.md.'].join('\n');
}
