---
name: advisor
description: For a worker seat - what to do when your job is unclear, contradictory or missing input; how to ask the boss with the advisor command.
---

# advisor

Use it when the prompt is vague, contradicts itself or the files, or an input it names is missing.

1. Read the "Ghi chú kỹ thuật" of task_board.md first: another seat may have solved it.
2. Ask ONE concrete question, with what you already tried: `advisor "<question> — tried: <what>"`. It waits for the boss's answer (up to 10 minutes) and prints it.
3. The command fails, is missing, or times out → write `blocked: <question>` in your row of task_board.md and STOP. Do not guess.
