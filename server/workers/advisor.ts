// The advisor: a seat stuck on a job runs `advisor "<question>"`; the server pastes the question into the boss's
// terminal (bracketed paste), reads the boss's reply from the boss's transcript (the line starting with the tag
// [ADVISOR <seat> <ref>]) and hands it verbatim to the CLI. Source: spec §13 and the advisor spike.
import { truncate } from '../../shared/activity';
import { tr } from '../../shared/i18n';

export const QUESTION_MAX = 1500;
const CELL_MAX = 300;

// Control characters (ESC, C1 such as 0x9b CSI) must never reach the boss's terminal or end the paste early.
// Plain slice, not truncate(): the question keeps its line breaks.
export function sanitizeQuestion(s: string): string {
  const t = s.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
  return t.trim().slice(0, QUESTION_MAX);
}

export const advisorTag = (seat: string, ref: string): string => `[ADVISOR ${seat} ${ref}]`;

// No trailing Enter: the caller sends it separately, once the boss is not waiting on a dialog.
export function advisorPaste(seat: string, ref: string, question: string): string {
  return (
    '\x1b[200~' +
    tr('❓ Seat {0} asks (job {1}): {2}\n→ Reply briefly, starting exactly with the tag {3}; that reply is passed verbatim to {0}.', [seat, ref, question, advisorTag(seat, ref)]) +
    '\x1b[201~'
  );
}

// Only assistant text blocks count (not the pasted frame, queue entries or thinking); the tag must start a line.
export function findAnswer(lines: readonly string[], tag: string): string | undefined {
  const at = new RegExp('^[ \\t]*' + tag.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&'), 'm');
  for (const l of lines) {
    let o: { type?: string; message?: { content?: unknown } };
    try { o = JSON.parse(l); } catch { continue; }
    if (o?.type !== 'assistant' || !Array.isArray(o.message?.content)) continue;
    for (const b of o.message.content as { type?: string; text?: unknown }[]) {
      if (b?.type !== 'text' || typeof b.text !== 'string') continue;
      const m = at.exec(b.text);
      if (!m) continue;
      return b.text.slice(m.index + m[0].length).split(/\n\s*\[ADVISOR /)[0].trim();
    }
  }
  return undefined;
}

const cell = (s: string) => truncate(s, CELL_MAX).replace(/\|/g, '\\|');

export function qaRow(at: number, who: string, question: string, answer: string): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `| ${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} | ${who} | ${cell(question)} | ${cell(answer)} |`;
}

// Inserts `row` after the last table line of the "## Hỏi đáp" section; undefined when there is no such table.
export function withQaRow(board: string, row: string): string | undefined {
  const lines = board.split('\n');
  const start = lines.findIndex((l) => l.normalize('NFC').startsWith('## Hỏi đáp'));
  if (start < 0) return undefined;
  let last = -1;
  for (let i = start + 1; i < lines.length && !lines[i].startsWith('## '); i++) if (lines[i].startsWith('|')) last = i;
  if (last < 0) return undefined;
  lines.splice(last + 1, 0, row);
  return lines.join('\n');
}
