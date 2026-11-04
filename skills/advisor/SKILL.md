---
name: advisor
description: For a worker seat of a Bang_ver office - when your job is unclear, contradicts itself or the files, or misses an input, ask the boss with the advisor command and wait for the answer; what to do when it fails.
---

# advisor

Use it when the prompt is vague, contradicts itself or the files, or an input it names is missing. Not for what you can check yourself.

1. Read "Ghi chú kỹ thuật" in task_board.md first: another seat may have solved it.
2. Ask ONE concrete question with what you already tried, in the foreground, and wait:
   `advisor "<question> — tried: <what>"`
   The office types it into the boss's terminal and prints the boss's answer: at most 9 minutes (the question is typed when the boss is not mid-turn; a queue forms only while the boss is busy or another seat's question still awaits its Enter). Claude Code: give that Bash call `timeout: 600000`. Antigravity: the shell permission dialog may appear in your terminal on the page; the user must approve it, so wait for that.
3. Exit 0: the output is the boss's answer, verbatim. Follow it and go on with the job.
4. Any other exit: write `blocked: <question>` in your row of task_board.md and STOP. Do not guess, do not ask again.

| Exit | Meaning |
| --- | --- |
| 0 | the boss's answer is printed |
| 1 | not inside a seat's job (`BANG_SLOT` unset), empty question, refused, or the office was lost while waiting |
| 2 | no boss terminal: the boss was not opened from the page, it is an Antigravity boss, or the office is not running |
| 3 | the boss is waiting for the user at a prompt |
| 4 | no answer in 9 minutes (a late answer is not delivered to you) |
| 5 | the boss replied without the `[ADVISOR ...]` tag |

While the boss terminal is still starting the command retries by itself for up to 30 seconds (that case is not an exit code of its own; it ends as exit 2 if the boss never comes up).

The office writes your question and the answer to "Hỏi đáp" in task_board.md; never write that section yourself.
