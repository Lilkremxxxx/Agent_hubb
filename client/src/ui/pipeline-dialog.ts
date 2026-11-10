// "New session" / "＋ boss": a dialog before the session opens. It picks the boss's account and, for each of the four
// pipeline roles, who does it (a subagent of the boss, or a seat of team.json); the answer becomes the session's first
// prompt (shared/pipeline.ts). The choice is remembered in the browser.
import { AGY_EFFORTS, BOSS_MODEL, CLAUDE_MODELS, cleanRoster, EFFORTS, has, MODEL_LABEL, MODELS, pipelinePrompt, ROLES, SEAT_MODEL, type Assignee, type Role, type Roster, type SeatRef } from '../../../shared/pipeline';
import type { UiContext } from './context';
import { h, iconButton } from './dom';
import { ICONS } from './icons';
import { tr } from '../../../shared/i18n';

const KEY = 'habblaud:pipeline-roster';
/** The boss's model and the last folder typed for ＋ (same browser-only memory). */
const BOSS_KEY = 'habblaud:pipeline-boss';

export interface PipelineAsk {
  /** Claude Code accounts the boss may run on. */
  accounts: { id: string; label: string }[];
  /** Preselected account; undefined = the server's default. */
  account?: string;
  /** The account is fixed (＋ boss: the team's boss account): shown, not chosen. */
  lock: boolean;
  seats: SeatRef[];
  /** The page's .ui-root: the dialog takes its fonts and colours from there. */
  root: HTMLElement;
  /** Ask for the project folder too (＋ in the Boss card), prefilled with this; undefined = the folder is known. */
  folder?: string;
}
export interface PipelineChoice {
  account?: string;
  prompt: string;
  /** The boss's model (`claude --model`). */
  model: string;
  /** Only when asked (PipelineAsk.folder). */
  folder?: string;
}

function load(seats: SeatRef[]): Roster {
  try {
    return cleanRoster(JSON.parse(localStorage.getItem(KEY) ?? 'null'), seats);
  } catch {
    return cleanRoster(null, seats);
  }
}

function loadBoss(): { model?: unknown; folder?: unknown } {
  try {
    return JSON.parse(localStorage.getItem(BOSS_KEY) ?? 'null') ?? {};
  } catch {
    return {};
  }
}

function save(r: Roster, boss: { model: string; folder?: string }): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
    localStorage.setItem(BOSS_KEY, JSON.stringify({ ...loadBoss(), ...boss }));
  } catch {
    // no localStorage: the choice is not remembered
  }
}

const ROLE_LABEL: Record<Role, () => string> = {
  planner: () => tr('Planner'),
  coder: () => tr('Coder'),
  tester: () => tr('Tester'),
  reviewer: () => tr('Reviewer'),
};

function select(id: string, label: string, options: { value: string; text: string }[], value: string, onChange: (v: string) => void): HTMLSelectElement {
  const s = h('select', { class: 'ui-msg__input ui-pipeline__select', attrs: { id, 'aria-label': label, title: label } });
  for (const o of options) s.append(h('option', { text: o.text, attrs: { value: o.value } }));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

/** Opens the dialog; null = cancelled. */
export function askPipeline(ask: PipelineAsk): Promise<PipelineChoice | null> {
  const roster = load(ask.seats);
  let account = ask.account;
  const boss = loadBoss();
  let model = has(CLAUDE_MODELS, boss.model) ? boss.model : BOSS_MODEL;
  const folderIn =
    ask.folder === undefined
      ? undefined
      : h('input', { class: 'ui-msg__input ui-pipeline__select', attrs: { id: 'ui-pipeline-folder', type: 'text', spellcheck: 'false', placeholder: '/home/…/project', value: ask.folder || (typeof boss.folder === 'string' ? boss.folder : '') } });
  return new Promise((resolve) => {
    let result: PipelineChoice | null = null;
    const rows = h('div', { class: 'ui-pipeline__rows' });
    const renderRows = () => {
      rows.replaceChildren(
        ...ROLES.map((role) => {
          const a = roster[role];
          const who = a.type === 'sub' ? 'sub' : `seat:${a.seat}`;
          const set = (n: Assignee) => {
            roster[role] = n;
            renderRows();
          };
          const efforts = a.type === 'seat' && a.kind === 'agy' ? AGY_EFFORTS : EFFORTS;
          const row = h('div', { class: 'ui-pipeline__row' }, h('label', { class: 'ui-pipeline__role', text: ROLE_LABEL[role](), attrs: { for: `ui-pipeline-${role}` } }));
          row.append(
            select(
              `ui-pipeline-${role}`,
              tr('{0}: who does it', [ROLE_LABEL[role]()]),
              [{ value: 'sub', text: tr('Subagent of the boss') }, ...ask.seats.map((s) => ({ value: `seat:${s.name}`, text: `${s.name} (${s.kind === 'agy' ? 'Antigravity' : 'Claude Code'})` }))],
              who,
              (v) => {
                const seat = ask.seats.find((s) => `seat:${s.name}` === v);
                if (!seat) return set({ type: 'sub', model: has(MODELS, a.model) ? a.model : 'sonnet', effort: a.effort });
                const effort = seat.kind === 'agy' && !AGY_EFFORTS.includes(a.effort as never) ? 'high' : a.effort;
                set(seat.kind === 'agy' ? { type: 'seat', seat: seat.name, kind: 'agy', effort } : { type: 'seat', seat: seat.name, kind: 'claude', model: has(CLAUDE_MODELS, a.model) ? a.model : SEAT_MODEL, effort });
              },
            ),
          );
          if (!(a.type === 'seat' && a.kind === 'agy'))
            row.append(
              select(`ui-pipeline-${role}-model`, tr('{0}: model', [ROLE_LABEL[role]()]), (a.type === 'sub' ? MODELS : CLAUDE_MODELS).map((m) => ({ value: m, text: MODEL_LABEL[m] ?? m })), a.model ?? 'sonnet', (v) => (a.model = v)),
            );
          else row.append(h('span', { class: 'ui-muted ui-pipeline__fixed', text: 'gemini-3.8-flash' }));
          row.append(select(`ui-pipeline-${role}-effort`, tr('{0}: effort', [ROLE_LABEL[role]()]), efforts.map((e) => ({ value: e, text: e })), a.effort, (v) => (a.effort = v)));
          return row;
        }),
      );
    };
    renderRows();
    const acc = select('ui-pipeline-account', tr('Boss account'), [...(ask.account === undefined ? [{ value: '', text: tr('Default account') }] : []), ...ask.accounts.map((a) => ({ value: a.id, text: a.label }))], account ?? '', (v) => (account = v || undefined));
    acc.disabled = ask.lock;
    const bossModel = select('ui-pipeline-boss-model', tr('Boss model'), CLAUDE_MODELS.map((m) => ({ value: m, text: MODEL_LABEL[m] ?? m })), model, (v) => (model = v));
    const err = h('p', { class: 'ui-muted', attrs: { role: 'alert', hidden: '' } });
    const done = () => dlg.close();
    const dlg = h(
      'dialog',
      { class: 'ui-dialog ui-pipeline', attrs: { 'aria-labelledby': 'ui-pipeline-title' } },
      h('div', { class: 'ui-dialog__head' }, h('h2', { attrs: { id: 'ui-pipeline-title' }, text: tr('New session: the team') }), iconButton(ICONS.close, tr('Close (Esc)'), done, 'ui-icon-btn--sm')),
      h(
        'div',
        { class: 'ui-pipeline__body' },
        h('p', { text: tr('The boss runs the planner, coder, tester and reviewer roles. Choose who does each one: a subagent of the boss, or a seat of the office.') }),
        ...(folderIn ? [h('div', { class: 'ui-pipeline__row' }, h('label', { class: 'ui-pipeline__role', text: tr('Folder'), attrs: { for: 'ui-pipeline-folder' } }), folderIn)] : []),
        h('div', { class: 'ui-pipeline__row' }, h('label', { class: 'ui-pipeline__role', text: tr('Boss'), attrs: { for: 'ui-pipeline-account' } }), acc, bossModel),
        rows,
        err,
        h(
          'div',
          { class: 'ui-pipeline__actions' },
          h('button', { class: 'ui-btn', type: 'button', text: tr('Cancel'), on: { click: done } }),
          h('button', {
            class: 'ui-btn ui-btn--primary',
            type: 'button',
            text: tr('Open'),
            on: {
              click: () => {
                const folder = folderIn?.value.trim();
                if (folderIn && !folder?.startsWith('/')) {
                  err.textContent = tr('Type the project folder (absolute path).');
                  err.hidden = false;
                  return folderIn.focus();
                }
                save(roster, { model, ...(folder ? { folder } : {}) });
                result = { account, prompt: pipelinePrompt(roster), model, ...(folder ? { folder } : {}) };
                dlg.close();
              },
            },
          }),
        ),
      ),
    ) as HTMLDialogElement;
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    ask.root.append(dlg);
    dlg.showModal();
  });
}

/** The dialog filled from the office: its Claude Code accounts and its seats. */
export function askPipelineHere(ctx: UiContext, account: string | undefined, lock: boolean, folder?: string): Promise<PipelineChoice | null> {
  const accounts = (ctx.store.snapshot?.accounts ?? []).filter((a) => (a.provider ?? 'claude') === 'claude').map((a) => ({ id: a.id, label: a.name }));
  return askPipeline({ accounts, account, lock, seats: ctx.selectedOffice()?.seats ?? [], root: ctx.root, folder });
}
