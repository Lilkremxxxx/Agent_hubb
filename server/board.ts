// What the Board's Tasks tab reads per room, every POLL_MS, no tokens: the "next steps" of the room's
// HANDOFF*.md (RoomInfo.plan, re-read only when the file changes).
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HandoffPlan } from '../shared/types';
import type { Office } from './model/office';
import { editHandoff, findHandoff, HandoffReader, type PlanEdit } from './sources/handoff';
import { tr } from '../shared/i18n';

export type PlanEditResult = { ok: true; plan?: HandoffPlan } | { ok: false; status: number; error: string };

export const BOARD_POLL_MS = 30_000;

export interface BoardServiceOptions {
  office: Office;
  pollMs?: number;
  now?: () => number;
  /** The offices' folders: their HANDOFF lists are read too, even with no room there (folderPlan). */
  folders?: () => readonly string[];
}

export class BoardService {
  private readonly handoff = new HandoffReader();
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  /** The HANDOFF list of each office folder (OfficeInfo.plan). */
  private readonly folderPlans = new Map<string, HandoffPlan>();

  constructor(private readonly opts: BoardServiceOptions) {
    this.now = opts.now ?? Date.now;
  }

  start(): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.opts.pollMs ?? BOARD_POLL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The "next steps" of an office folder's HANDOFF file, as of the last poll or edit. */
  folderPlan(folder: string): HandoffPlan | undefined {
    return this.folderPlans.get(folder);
  }

  /**
   * Edits the room's to-do list in its HANDOFF*.md (the Board: tick, add, remove, or start one in a new HANDOFF.md).
   * `mtime` is the version the page showed: if the file changed since (the boss edited it), nothing is written and the
   * fresh list comes back with 409.
   */
  editPlan(roomId: string, mtime: number | undefined, edit: PlanEdit): PlanEditResult {
    const dir = this.opts.office.roomPath(roomId);
    if (!dir) return { ok: false, status: 404, error: tr('room not found') };
    return this.editDir(dir, mtime, edit, (plan) => this.opts.office.setPlan(roomId, plan));
  }

  /** The same, on an office's folder (nobody works there yet, so it has no room). */
  editFolderPlan(folder: string, mtime: number | undefined, edit: PlanEdit): PlanEditResult {
    return this.editDir(folder, mtime, edit, (plan) => this.setFolderPlan(folder, plan));
  }

  private setFolderPlan(folder: string, plan: HandoffPlan | undefined): void {
    if (plan) this.folderPlans.set(folder, plan);
    else this.folderPlans.delete(folder);
  }

  private editDir(dir: string, mtime: number | undefined, edit: PlanEdit, save: (plan: HandoffPlan | undefined) => void): PlanEditResult {
    const found = findHandoff(dir);
    if (!found && edit.op !== 'create') return { ok: false, status: 404, error: tr('no HANDOFF file in {0}', [dir]) };
    if (found && mtime !== undefined && Math.abs(found.mtime - mtime) > 1) {
      save(this.handoff.read(dir));
      return { ok: false, status: 409, error: tr('the file changed meanwhile: the list was reloaded, try again') };
    }
    const path = found?.path ?? join(dir, 'HANDOFF.md');
    let md = '';
    try {
      md = found ? readFileSync(path, 'utf8') : '';
    } catch (err) {
      return { ok: false, status: 500, error: String(err) };
    }
    const next = editHandoff(md, edit);
    if (next === undefined) return { ok: false, status: 400, error: tr('that item is not in the list anymore') };
    try {
      const tmp = `${path}.habblaud-tmp`;
      writeFileSync(tmp, next);
      renameSync(tmp, path);
    } catch (err) {
      return { ok: false, status: 500, error: tr("couldn't write {0}: {1}", [path, String(err)]) };
    }
    const plan = this.handoff.read(dir);
    save(plan);
    return plan ? { ok: true, plan } : { ok: true };
  }

  async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const rooms = this.opts.office.roomList();
      for (const r of rooms) this.opts.office.setPlan(r.id, this.handoff.read(r.path));
      const folders = new Set(this.opts.folders?.() ?? []);
      for (const f of this.folderPlans.keys()) if (!folders.has(f)) this.folderPlans.delete(f);
      for (const f of folders) if (f) this.setFolderPlan(f, this.handoff.read(f));
    } finally {
      this.busy = false;
    }
  }
}
