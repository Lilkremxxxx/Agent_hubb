import { describe, expect, it } from 'vitest';
import type { AskQuestion } from '../../../shared/types';
import { askKeys } from './askkeys';

const D = '\x1b[B';
const opt = (index: number) => ({ index, label: `o${index}` });
const q = (index: number, multiSelect = false): AskQuestion => ({ index, question: `q${index}`, multiSelect, total: 3, options: [opt(0), opt(1), opt(2)] });

describe('askKeys', () => {
  it('single question, single choice: Down to the option and Enter, no review step', () => {
    expect(askKeys([q(0)], [{ opts: [1] }])).toEqual([D + '\r']);
  });

  it('two single questions: Enter per question, one more Enter on the review screen', () => {
    expect(askKeys([q(0), q(1)], [{ opts: [0] }, { opts: [2] }])).toEqual(['\r', D + D + '\r', '\r']);
  });

  it('multi: walks down toggling with Space, then Down to the Next/Submit row', () => {
    // Cursor ends on option 2, Other row is 3, Submit row is 4.
    expect(askKeys([q(0, true)], [{ opts: [2, 0] }])).toEqual([' ' + D + D + ' ' + D + D + '\r', '\r']);
  });

  it('multi with nothing picked and no Other text is unanswered (null, like single)', () => {
    expect(askKeys([q(0, true)], [{ opts: [] }])).toBeNull();
  });

  it('Other text goes on the row after the original options (single and multi)', () => {
    expect(askKeys([q(0)], [{ opts: [], other: 'big red' }])).toEqual([D + D + D + 'big red\r']);
    expect(askKeys([q(0, true)], [{ opts: [1], other: 'x' }])).toEqual([D + ' ' + D + D + 'x' + D + '\r', '\r']);
  });

  it('strips control characters from Other text so it cannot carry keystrokes', () => {
    const [keys] = askKeys([q(0)], [{ opts: [], other: 'a\x1b[Bb\r\nc\x7f\u009b' }])!;
    expect(keys).toBe(D + D + D + 'a[Bb c\r');
  });

  it('is null when the question list has gaps or a single question has no answer', () => {
    expect(askKeys([q(1)], [{ opts: [0] }])).toBeNull();
    expect(askKeys([q(0), q(2)], [{ opts: [0] }, { opts: [0] }])).toBeNull();
    expect(askKeys([q(0)], [{ opts: [] }])).toBeNull();
  });
});
