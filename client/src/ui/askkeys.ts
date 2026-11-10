// Keystrokes that answer a Claude Code AskUserQuestion dialog typed into its terminal.
// shortcut: keystrokes match Claude Code 2.1.322 AskUserQuestion UI, re-check on Claude Code updates.
// Layout (verified in tmux): one tab per question, cursor starts on option 1 of each tab; Down moves; the row after the
// original options is "Other" (typing there fills it); multi-select toggles with Space and has a Next/Submit row after
// Other; single-select advances on Enter. A review screen follows unless the only question is single-select.
import type { AskQuestion } from '../../../shared/types';

const DOWN = '\x1b[B';

export interface AskPick {
  /** Chosen `AskQuestion.options[].index` values. */
  opts: number[];
  /** Text for the "Other" row. */
  other?: string;
}

// Same cleaning as the advisor paste: nothing typed may be read as a key or end the text early.
const clean = (s: string) =>
  s
    .replace(/[\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim();

/** One string per write. null when the position of a question is unknown (gaps) or a question has no answer. */
export function askKeys(qs: AskQuestion[], picks: AskPick[]): string[] | null {
  if (qs.length === 0 || qs.some((q, i) => q.index !== i)) return null;
  const out: string[] = [];
  for (const [i, q] of qs.entries()) {
    const pick = picks[i] ?? { opts: [] };
    const other = clean(pick.other ?? '');
    let at = 0;
    const move = (to: number) => {
      const s = DOWN.repeat(to - at);
      at = to;
      return s;
    };
    if (!q.multiSelect) {
      if (other) out.push(move(q.total) + other + '\r');
      else if (pick.opts.length) out.push(move(pick.opts[0]!) + '\r');
      else return null;
      continue;
    }
    if (!pick.opts.length && !other) return null;
    let s = '';
    for (const k of [...pick.opts].sort((a, b) => a - b)) s += move(k) + ' ';
    if (other) s += move(q.total) + other;
    out.push(s + move(q.total + 1) + '\r');
  }
  // Review screen ("Submit answers" is preselected).
  if (qs.length > 1 || qs[0]!.multiSelect) out.push('\r');
  return out;
}
