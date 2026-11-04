import { describe, expect, it } from 'vitest';
import { VI } from '../../shared/locales/vi';
import { QUESTION_MAX, advisorPaste, findAnswer, qaRow, sanitizeQuestion, withQaRow } from './advisor';

const line = (o: object) => JSON.stringify(o);
const say = (text: string) => line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });

describe('advisor pure helpers', () => {
  it('a question loses control characters and the paste end, keeps its lines, and is capped', () => {
    expect(sanitizeQuestion('a\x1b[201~b\r\nc\td\x9b1m\x07')).toBe('a[201~b\nc d1m');
    expect(sanitizeQuestion('  \x1b x \x00 ')).toBe('x');
    expect(sanitizeQuestion('é'.repeat(2000)).length).toBeLessThanOrEqual(QUESTION_MAX);
  });

  it('the paste is one bracketed block naming the seat, the job and the exact tag, in every language', () => {
    const p = advisorPaste('W2', 'T2', 'which file?\nline two');
    expect(p.startsWith('\x1b[200~❓ Seat W2 asks (job T2): which file?\nline two\n→ Reply briefly')).toBe(true);
    expect(p.endsWith('.\x1b[201~')).toBe(true);
    expect(p).toContain('starting exactly with the tag [ADVISOR W2 T2]; that reply is passed verbatim to W2.');
    expect(p.slice(6, -6)).not.toContain('\x1b');
    const vi = Object.entries(VI).find(([k]) => k.startsWith('❓ Seat {0} asks'));
    expect(vi?.[1]).toContain('{3}');
  });

  it('only assistant text after the exact tag at a line start; the next tag ends it; frames, thinking and other tags do not count', () => {
    const frame = '❓ Seat W2 asks (job T2): q\n→ … [ADVISOR W2 T2] …';
    const lines = [
      line({ type: 'user', message: { role: 'user', content: frame } }),
      line({ type: 'queue-operation', operation: 'enqueue', content: frame }),
      line({ type: 'attachment', attachment: { type: 'queued_command', prompt: frame } }),
      'not json',
      say('see [ADVISOR W2 T2] inline'),
      say('[ADVISOR W2 T2#2] the later one'),
      line({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '[ADVISOR W2 T2] no' }, { type: 'text', text: 'Sure.\n\n  [ADVISOR W2 T2] Use a.csv.\nIt has the header.\n\n[ADVISOR W3 T5] Skip it.\n\nSkipped: x' }] } }),
    ];
    expect(findAnswer(lines, '[ADVISOR W2 T2]')).toBe('Use a.csv.\nIt has the header.');
    expect(findAnswer(lines, '[ADVISOR W3 T5]')).toBe('Skip it.\n\nSkipped: x');
    expect(findAnswer(lines, '[ADVISOR W2 T2#2]')).toBe('the later one');
    expect(findAnswer(lines.slice(0, 5), '[ADVISOR W2 T2]')).toBeUndefined();
  });

  it('the row goes after the last line of the Hỏi đáp table and nothing else changes', () => {
    const head = '# Task board\n\n## Hỏi đáp (advisor ghi tự động)\n| Lúc | Ai | Hỏi | Trả lời |\n|---|---|---|---|\n';
    const tail = '\n## Đã xong\n| ID |\n|---|\n| T1 |\n';
    expect(withQaRow(head + tail, '| r1 |')).toBe(`${head}| r1 |\n${tail}`);
    expect(withQaRow(`${head}| r1 |\n${tail}`, '| r2 |')).toBe(`${head}| r1 |\n| r2 |\n${tail}`);
    expect(withQaRow(head, '| r1 |')).toBe(`${head}| r1 |\n`);
    expect(withQaRow('# Task board\n## Đã xong\n| a |\n', '| r |')).toBeUndefined();
    expect(withQaRow('## Hỏi đáp\nno table yet\n## Đã xong\n| a |\n', '| r |')).toBeUndefined();
  });

  it('a row is one table line: lines joined, pipes escaped, cells capped', () => {
    const r = qaRow(new Date(2026, 10, 4, 15, 7).getTime(), 'W2 (T2)', 'a|b\nc', 'x'.repeat(400));
    expect(r.startsWith('| 11-04 15:07 | W2 (T2) | a\\|b c | xxx')).toBe(true);
    expect(r.includes('\n')).toBe(false);
    expect(r.length).toBeLessThan(360);
  });
});
