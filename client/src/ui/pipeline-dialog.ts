// "New session" / "＋ boss": a dialog before the session opens. It picks the boss's account and, for each of the four
// pipeline roles, who does it (a subagent of the boss, or a seat of team.json); the answer becomes the session's first
// prompt (shared/pipeline.ts). The choice is remembered in the browser.
import { AGY_EFFORTS, cleanRoster, EFFORTS, MODELS, pipelinePrompt, ROLES, type Assignee, type Role, type Roster, type SeatRef } from '../../../shared/pipeline';
import type { UiContext } from './context';
import { h, iconButton } from './dom';
import { ICONS } from './icons';
import { tr } from '../../../shared/i18n';

const KEY = 'habblaud:pipeline-roster';

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
}
export interface PipelineChoice {
  account?: string;
  prompt: string;
}

function load(seats: SeatRef[]): Roster {
  try {
    return cleanRoster(JSON.parse(localStorage.getItem(KEY) ?? 'null'), seats);
  } catch {
    return cleanRoster(null, seats);
  }
}

function save(r: Roster): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
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
                if (!seat) return set({ type: 'sub', model: a.model ?? 'sonnet', effort: a.effort });
                const effort = seat.kind === 'agy' && !AGY_EFFORTS.includes(a.effort as never) ? 'high' : a.effort;
                set(seat.kind === 'agy' ? { type: 'seat', seat: seat.name, kind: 'agy', effort } : { type: 'seat', seat: seat.name, kind: 'claude', model: a.model ?? 'sonnet', effort });
              },
            ),
          );
          if (!(a.type === 'seat' && a.kind === 'agy'))
            row.append(select(`ui-pipeline-${role}-model`, tr('{0}: model', [ROLE_LABEL[role]()]), MODELS.map((m) => ({ value: m, text: m })), a.model ?? 'sonnet', (v) => (a.model = v)));
          else row.append(h('span', { class: 'ui-muted ui-pipeline__fixed', text: 'gemini-3.8-flash' }));
          row.append(select(`ui-pipeline-${role}-effort`, tr('{0}: effort', [ROLE_LABEL[role]()]), efforts.map((e) => ({ value: e, text: e })), a.effort, (v) => (a.effort = v)));
          return row;
        }),
      );
    };
    renderRows();
    const acc = select('ui-pipeline-account', tr('Boss account'), [...(ask.account === undefined ? [{ value: '', text: tr('Default account') }] : []), ...ask.accounts.map((a) => ({ value: a.id, text: a.label }))], account ?? '', (v) => (account = v || undefined));
    acc.disabled = ask.lock;
    const done = () => dlg.close();
    const dlg = h(
      'dialog',
      { class: 'ui-dialog ui-pipeline', attrs: { 'aria-labelledby': 'ui-pipeline-title' } },
      h('div', { class: 'ui-dialog__head' }, h('h2', { attrs: { id: 'ui-pipeline-title' }, text: tr('New session: the team') }), iconButton(ICONS.close, tr('Close (Esc)'), done, 'ui-icon-btn--sm')),
      h(
        'div',
        { class: 'ui-pipeline__body' },
        h('p', { text: tr('The boss runs the planner, coder, tester and reviewer roles. Choose who does each one: a subagent of the boss, or a seat of the office.') }),
        h('div', { class: 'ui-pipeline__row' }, h('label', { class: 'ui-pipeline__role', text: tr('Boss'), attrs: { for: 'ui-pipeline-account' } }), acc),
        rows,
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
                save(roster);
                result = { account, prompt: pipelinePrompt(roster) };
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
export function askPipelineHere(ctx: UiContext, account: string | undefined, lock: boolean): Promise<PipelineChoice | null> {
  const accounts = (ctx.store.snapshot?.accounts ?? []).filter((a) => (a.provider ?? 'claude') === 'claude').map((a) => ({ id: a.id, label: a.name }));
  return askPipeline({ accounts, account, lock, seats: ctx.selectedOffice()?.seats ?? [], root: ctx.root });
}
