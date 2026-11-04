// The office from the snapshot: the list, the one shown, its boss and focus (dimming).
import { describe, expect, it } from 'vitest';
import type { AgentInfo, OfficeInfo, OfficeSnapshot, RoomInfo, TeamInfo } from '../../../shared/types';
import { officeBoss, officeFocus, pickOffice, sameFocus, teamOffices } from './offices';

const office = (id: string, extra: Partial<OfficeInfo> = {}): OfficeInfo => ({ id, name: id.toUpperCase(), folder: `/p/${id}`, workers: [], ...extra });
const room = (id: string, path: string, extra: Partial<RoomInfo> = {}) => ({ id, name: id, path, ...extra }) as RoomInfo;
const agent = (id: string, roomId: string, extra: Partial<AgentInfo> = {}) => ({ id, roomId, name: id, ...extra }) as AgentInfo;
type Snap = Pick<OfficeSnapshot, 'agents' | 'rooms' | 'team'>;
const team = (offices: OfficeInfo[] | undefined, extra: Partial<TeamInfo> = {}): TeamInfo => ({ workers: [], agy: [], ...(offices ? { offices } : {}), ...extra });

describe('offices', () => {
  it('an older server: the single team becomes office "main" without a folder', () => {
    expect(teamOffices(team(undefined, { workers: ['acc2'], bossAccount: '.claude', bossKind: 'claude' }))).toEqual([
      { id: 'main', name: 'Office', folder: '', workers: ['acc2'], bossAccount: '.claude', bossKind: 'claude' },
    ]);
    expect(teamOffices(undefined)).toEqual([]);
  });

  it('the saved office, else the first', () => {
    const list = [office('a'), office('b')];
    expect(pickOffice(list, 'b')?.id).toBe('b');
    expect(pickOffice(list, 'gone')?.id).toBe('a');
    expect(pickOffice([], 'a')).toBeUndefined();
  });

  it('boss: bossAgentId or pendingBoss; any crowned agent only with one office', () => {
    const agents = [agent('b1', 'r1', { boss: true }), agent('b2', 'r2', { boss: true })];
    const two = team([office('a', { bossAgentId: 'b2' }), office('b')]);
    expect(officeBoss({ agents, team: two }, two.offices![0])?.id).toBe('b2');
    expect(officeBoss({ agents, team: two }, two.offices![1])).toBeUndefined();
    const one = team([office('a', { pendingBoss: 'b1' })]);
    expect(officeBoss({ agents, team: one }, one.offices![0])?.id).toBe('b1');
    const old = team(undefined);
    expect(officeBoss({ agents: [agents[0]], team: old }, teamOffices(old)[0])?.id).toBe('b1');
  });

  it('focus: the building of the office (rooms by room.office, characters by agent.office; absent = the first); none with one office', () => {
    const rooms = [room('ra', '/p/a'), room('rw', '/agy'), room('rb', '/p/b', { office: 'b' }), room('rw@b', '/agy', { office: 'b' })];
    const agents = [
      agent('boss-a', 'ra', { boss: true }),
      agent('side-a', 'ra'),
      agent('sub', 'ra', { parentId: 'boss-a' }),
      agent('agy:acc2', 'rw'),
      agent('boss-b', 'rb', { boss: true, office: 'b' }),
      agent('sub-b', 'rb', { parentId: 'boss-b' }),
      agent('agy:acc2@b', 'rw@b', { office: 'b' }),
    ];
    const offices = [office('a', { bossAgentId: 'boss-a', workers: ['acc2'] }), office('b', { bossAgentId: 'boss-b', workers: ['acc2'] })];
    const snap: Snap = { rooms, agents, team: team(offices) };
    const f = officeFocus(snap, offices[0])!;
    expect([...f.roomIds].sort()).toEqual(['ra', 'rw']);
    expect([...f.agentIds].sort()).toEqual(['agy:acc2', 'boss-a', 'side-a', 'sub']);
    const g = officeFocus(snap, offices[1])!;
    expect([...g.roomIds].sort()).toEqual(['rb', 'rw@b']);
    expect([...g.agentIds].sort()).toEqual(['agy:acc2@b', 'boss-b', 'sub-b']);
    expect(officeFocus({ ...snap, team: team([offices[0]]) }, offices[0])).toBeNull();
    expect(sameFocus(f, officeFocus(snap, offices[0]))).toBe(true);
    expect(f.office).toBe('a');
    expect(g.office).toBe('b');
    expect(sameFocus(f, g)).toBe(false);
    expect(sameFocus(f, { ...f, office: 'b' })).toBe(false);
  });

});
