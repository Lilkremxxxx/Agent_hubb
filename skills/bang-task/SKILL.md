---
name: bang-task
description: Rules for reading and writing the office's task_board.md (task rows, statuses, technical notes, lessons). Use at the start of every job in a Bang_ver office and whenever you update your task row.
---

# bang-task

`task_board.md` in the office folder is the team's long-term memory and the channel between seats.
`project_proposal.md` holds the goal, scope and acceptance criteria.

## At the start of every job
1. Read task_board.md before anything else: "Bối cảnh", your rows in "Việc đang làm", "Ghi chú kỹ thuật", "Bài học".
2. A row of yours still `doing:` or `blocked:` from before: finish it first, or say in your report why not.
3. Read only the part of project_proposal.md your job points to.

## Who writes what
- A worker (`BANG_SLOT` is set): edit only the rows whose "Ai" is your seat; add rows to "Ghi chú kỹ thuật". Never create task rows, never write "Bài học", the review column or "Đã xong".
- The boss: creates task rows, writes the review (✅/❌) and "Bài học", moves rows to "Đã xong".
- "Hỏi đáp" is written by the advisor command, not by hand.

## A row's status
Exactly one of `todo` | `doing: <how far>` | `blocked: <what you need>` | `done`. Set "Cập nhật" to `MM-DD HH:MM` and update the "_Cập nhật lần cuối_" line with the time and your name.

## Technical notes
Solved something that was not obvious → one row: date, seat, problem, fix, `file:line`.

## Stuck
Read the other seats' technical notes first; still stuck → `advisor "<question>"`; no answer → `blocked: <question>` and STOP. Never guess.

## Housekeeping
Paths are relative to the office folder. Edit the tables in place, keep them valid Markdown, never delete another seat's row. Two seats may write in the same minute: re-read the file right before you write and change only your own line. More than 20 rows in "Đã xong" or "Bài học" (boss) → move the oldest to `task_board.archive.md`.
