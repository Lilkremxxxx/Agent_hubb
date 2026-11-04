import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Activity, AgentStatus } from '../../shared/types';
import { VI } from '../../shared/locales/vi';
import { Advisor, QUESTION_MAX, advisorPaste, findAnswer, qaRow, sanitizeQuestion, withQaRow, type AdvisorAsk, type AdvisorBoss } from './advisor';

const T0 = 1_800_000_000_000;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

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

describe('Task 1 review follow-ups', () => {
  it('a bare tag (before a tool call) is not an answer: a later block with text is', () => {
    const lines = [say('[ADVISOR W2 T2]'), say('[ADVISOR W2 T2]  \n[ADVISOR W3 T5] x'), say('[ADVISOR W2 T2] Use a.csv.')];
    expect(findAnswer(lines, '[ADVISOR W2 T2]')).toBe('Use a.csv.');
    expect(findAnswer(lines.slice(0, 2), '[ADVISOR W2 T2]')).toBeUndefined();
  });

  it('a literal backslash-pipe stays inside its cell', () => {
    expect(qaRow(T0, 'W2', 'a\\|b', 'c').split(' | ')[2]).toBe('a\\\\\\|b');
  });

  it('a cut question ends with … within the cap and never with a lone high surrogate', () => {
    const q = sanitizeQuestion('x'.repeat(2000));
    expect([q.length, q.endsWith('…')]).toEqual([QUESTION_MAX, true]);
    const e = sanitizeQuestion('x'.repeat(QUESTION_MAX - 2) + '😀😀');
    expect(e.endsWith('x…')).toBe(true);
    expect(e.length).toBeLessThanOrEqual(QUESTION_MAX);
  });
});

const BOARD = '# Task board\n\n## Hỏi đáp (advisor ghi tự động)\n| Lúc | Ai | Hỏi | Trả lời |\n|---|---|---|---|\n\n## Đã xong\n| ID |\n|---|\n';
function setup(o: { board?: string | null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'habblaud-advisor-'));
  dirs.push(dir);
  const transcript = join(dir, 'boss.jsonl');
  writeFileSync(transcript, `${say('[ADVISOR W2 T2] an old answer')}\n`);
  if (o.board !== null) writeFileSync(join(dir, 'task_board.md'), o.board ?? BOARD);
  let now = T0;
  const boss: { v: AdvisorBoss | string } = { v: { agentId: '.claude:9', status: 'idle', transcript } };
  const typed: string[] = [], notes: string[] = [], acts: Array<[string, Activity]> = [];
  const seats: Record<string, { agentId: string; ref: string }> = { W2: { agentId: 'agy:acc1@W2', ref: 'T2' }, W3: { agentId: 'agy:acc1@W3', ref: 'T5' } };
  const advisor = new Advisor({
    boss: () => boss.v, typeTo: (_id, d) => (typed.push(d), true), seat: (s) => seats[s], note: (s, q) => void notes.push(`${s}:${q}`),
    activity: (id, a) => void acts.push([id, a]), folder: () => dir, now: () => now, timing: { pollMs: 0 },
  });
  const id = (r: AdvisorAsk) => (r.ok ? r.question.id : '');
  return {
    advisor, boss, typed, notes, acts, dir, transcript, id,
    reply: (text: string) => appendFileSync(transcript, `${say(text)}\n`),
    at: (ms: number) => ((now += ms), advisor.tick()),
    status: (s: AgentStatus) => void ((boss.v as AdvisorBoss).status = s),
    q: async (r: AdvisorAsk) => (await advisor.wait(id(r), 0))!,
  };
}

it('an idle boss gets the paste, then the Enter on the next tick; the tagged reply after it is the answer, on the feed and in Hỏi đáp', async () => {
  const t = setup();
  const r = t.advisor.ask({ slot: 'W2', question: 'a.csv or b.csv?', office: t.dir });
  expect(r).toMatchObject({ ok: true, question: { status: 'asking', ref: 'T2' } });
  expect(t.typed).toEqual([advisorPaste('W2', 'T2', 'a.csv or b.csv?')]);
  t.at(500);
  expect(t.typed.at(-1)).toBe('\r');
  t.status('working'); t.at(500);
  t.reply('[ADVISOR W2 T2] Use a.csv.'); t.at(500);
  expect(await t.q(r)).toMatchObject({ status: 'answered', answer: 'Use a.csv.' }); // not "an old answer": seekEnd before typing
  expect(t.notes).toEqual(['W2:a.csv or b.csv?']);
  expect(t.acts.map(([id, a]) => [id, a.icon, a.detail])).toEqual([['agy:acc1@W2', '❓', 'a.csv or b.csv?'], ['agy:acc1@W2', '💬', 'Use a.csv.']]);
  const after = readFileSync(join(t.dir, 'task_board.md'), 'utf8');
  expect(after.replace(/^\| \d\d-\d\d \d\d:\d\d \| W2 \(T2\) \| a\.csv or b\.csv\? \| Use a\.csv\. \|\n/m, '')).toBe(BOARD);
});

it('refused at once, nothing typed or recorded: not a seat, empty question, another office, the boss at a prompt, no boss', () => {
  const t = setup();
  expect(t.advisor.ask({ slot: 'X9', question: 'q' })).toMatchObject({ ok: false, status: 400 });
  expect(t.advisor.ask({ slot: 'W2', question: ' \x1b\x07 ' })).toMatchObject({ ok: false, status: 400 });
  expect(t.advisor.ask({ slot: 'W2', question: 'q', office: '/elsewhere' })).toMatchObject({ ok: false, status: 400 });
  t.boss.v = { ...(t.boss.v as AdvisorBoss), status: 'waiting', waitingFor: 'approve a permission' };
  expect(t.advisor.ask({ slot: 'W2', question: 'q' })).toMatchObject({ ok: false, status: 409, code: 'boss-waiting', error: expect.stringContaining('approve a permission') });
  t.boss.v = 'no boss terminal: open the boss from the page (the + beside Boss)';
  expect(t.advisor.ask({ slot: 'W2', question: 'q' })).toMatchObject({ ok: false, status: 409, code: 'no-boss', error: t.boss.v });
  expect([t.typed, t.notes, t.acts]).toEqual([[], [], []]);
});

it('the Enter waits while the boss is at a prompt', () => {
  const t = setup();
  t.advisor.ask({ slot: 'W2', question: 'q' });
  t.status('waiting'); t.at(500); t.at(500);
  expect(t.typed).toHaveLength(1);
  t.status('shell'); t.at(500);
  expect(t.typed.at(-1)).toBe('\r');
});

it('a question swallowed by a tool turn is typed once more after the boss goes idle; no tag after that is untagged', async () => {
  const t = setup();
  const r = t.advisor.ask({ slot: 'W2', question: 'q' });
  t.at(500); t.at(3_000);
  expect(t.typed).toHaveLength(2); // still idle before its turn: no retype
  t.status('working'); t.at(500);
  t.status('idle'); t.at(500); t.at(4_000);
  expect(t.typed).toHaveLength(2); // idle 4 s
  t.at(1_500);
  expect(t.typed.slice(2)).toEqual([advisorPaste('W2', 'T2', 'q')]);
  t.at(500);
  expect(t.typed.at(-1)).toBe('\r');
  t.at(59_000);
  expect((await t.q(r)).status).toBe('asking');
  t.at(1_500);
  expect(await t.q(r)).toMatchObject({ status: 'untagged', error: expect.stringContaining('[ADVISOR W2 T2]') });
  expect(t.typed).toHaveLength(4);
  expect(t.acts.at(-1)?.[1]).toMatchObject({ icon: '⚠️', error: true });
});

it('two seats in one boss message get their own text; the same seat and job again is #2; boss gone is no-boss; 10 minutes is timeout', async () => {
  const t = setup();
  const a = t.advisor.ask({ slot: 'W2', question: 'q1' });
  const b = t.advisor.ask({ slot: 'W3', question: 'q2' });
  t.at(500);
  t.reply('[ADVISOR W2 T2] A\n\n[ADVISOR W3 T5] B'); t.at(500);
  expect([(await t.q(a)).answer, (await t.q(b)).answer]).toEqual(['A', 'B']);
  const c = t.advisor.ask({ slot: 'W2', question: 'q3' });
  expect(c).toMatchObject({ ok: true, question: { ref: 'T2#2' } });
  t.boss.v = 'gone'; t.at(500);
  expect(await t.q(c)).toMatchObject({ status: 'no-boss' });
  t.boss.v = { agentId: '.claude:9', status: 'working', transcript: t.transcript };
  const d = t.advisor.ask({ slot: 'W3', question: 'q4' });
  t.at(500); t.at(10 * 60_000);
  expect(await t.q(d)).toMatchObject({ status: 'timeout' });
});

it('no board file: the answer still comes back and no board is created', async () => {
  const t = setup({ board: null });
  const r = t.advisor.ask({ slot: 'W2', question: 'q' });
  t.at(500); t.reply('[ADVISOR W2 T2] ok'); t.at(500);
  expect(await t.q(r)).toMatchObject({ status: 'answered', answer: 'ok' });
  expect(existsSync(join(t.dir, 'task_board.md'))).toBe(false);
});
