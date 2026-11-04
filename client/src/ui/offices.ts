// The office, from the snapshot (pure: tested in offices.test.ts). The server sends exactly one; the world still draws
// one building per office (client/src/world/*), so the focus helpers stay.
import type { AgentInfo, OfficeInfo, OfficeSnapshot, RoomInfo, TeamInfo } from '../../../shared/types';

/** What ctx.officeFocus() returns: the rooms and characters of the selected office (the rest is dimmed). */
export interface OfficeFocus {
  roomIds: ReadonlySet<string>;
  agentIds: ReadonlySet<string>;
  /** The office shown: the world dims every other building whole (roomIds/agentIds are then only a fallback). */
  office?: string;
}

type TeamPart = Pick<TeamInfo, 'offices' | 'workers' | 'bossAccount' | 'bossKind' | 'pendingBoss' | 'waitingBoss'>;

/**
 * Every office, in creation order. A server from before offices sends the old single team: it becomes one office
 * (id "main", no folder), like the server's own conversion of a v2 team file.
 */
export function teamOffices(team: TeamPart | undefined): OfficeInfo[] {
  if (!team) return [];
  if (team.offices) return team.offices;
  return [
    {
      id: 'main',
      name: 'Office',
      folder: '',
      workers: team.workers,
      ...(team.bossAccount ? { bossAccount: team.bossAccount } : {}),
      ...(team.bossKind ? { bossKind: team.bossKind } : {}),
      ...(team.pendingBoss ? { pendingBoss: team.pendingBoss } : {}),
      ...(team.waitingBoss ? { waitingBoss: team.waitingBoss } : {}),
    },
  ];
}

/** The office with this id, else the first one (a deleted or unknown id falls back). */
export function pickOffice(offices: readonly OfficeInfo[], id: string | null | undefined): OfficeInfo | undefined {
  return offices.find((o) => o.id === id) ?? offices[0];
}

/**
 * The office's boss character: its bossAgentId, else the one opened from it ("＋ Boss", not crowned yet). With a
 * single office (or an older server) any crowned agent is its boss.
 */
export function officeBoss(snap: Pick<OfficeSnapshot, 'agents' | 'team'> | null | undefined, office: OfficeInfo | undefined): AgentInfo | undefined {
  if (!snap || !office) return undefined;
  const id = office.bossAgentId ?? office.pendingBoss;
  const byId = id ? snap.agents.find((a) => a.id === id) : undefined;
  if (byId) return byId;
  return teamOffices(snap.team).length <= 1 ? snap.agents.find((a) => a.boss) : undefined;
}

/** The office whose building holds this room (absent = the first office's). */
export function roomOfficeId(room: Pick<RoomInfo, 'office'>, offices: readonly OfficeInfo[]): string | undefined {
  return room.office ?? offices[0]?.id;
}

/**
 * The office whose building draws this character: its own `office`, else its main agent's (a subagent), else the
 * first office's.
 */
export function agentOfficeId(snap: Pick<OfficeSnapshot, 'agents'> | null | undefined, a: Pick<AgentInfo, 'office' | 'parentId'>, offices: readonly OfficeInfo[]): string | undefined {
  const parent = !a.office && a.parentId ? snap?.agents.find((p) => p.id === a.parentId) : undefined;
  return a.office ?? parent?.office ?? offices[0]?.id;
}

/**
 * Rooms and characters of the office's building, for the dimming of the pixel office; null = nothing to dim (one
 * office or none). Each office is a building of its own: rooms by `room.office`, characters by `agent.office`
 * (absent = the first office's building).
 */
export function officeFocus(snap: Pick<OfficeSnapshot, 'agents' | 'rooms' | 'team'> | null | undefined, office: OfficeInfo | undefined): OfficeFocus | null {
  const offices = teamOffices(snap?.team);
  if (!snap || !office || offices.length <= 1) return null;
  const roomIds = new Set(snap.rooms.filter((r) => roomOfficeId(r, offices) === office.id).map((r) => r.id));
  const agentIds = new Set(snap.agents.filter((a) => agentOfficeId(snap, a, offices) === office.id).map((a) => a.id));
  return { roomIds, agentIds, office: office.id };
}

/** Same rooms and characters (the world redraws only when the focus really changed). */
export function sameFocus(a: OfficeFocus | null, b: OfficeFocus | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.office !== b.office || a.roomIds.size !== b.roomIds.size || a.agentIds.size !== b.agentIds.size) return false;
  for (const id of a.roomIds) if (!b.roomIds.has(id)) return false;
  for (const id of a.agentIds) if (!b.agentIds.has(id)) return false;
  return true;
}

