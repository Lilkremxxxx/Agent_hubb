---
name: giao-viec
description: For the boss of a Bang_ver office - give each job to a seat with worker-ask as a 6-part prompt, run it in the background, review the result by running its review commands yourself, send at most 2 fix jobs, then close the row and write the lesson. Use whenever you delegate, giao việc or chia việc to the office's seats.
---

# giao-viec

You are the boss. The seats are in team.json: `worker-ask team` prints the office folder, the boss and the seats. An Antigravity seat runs Gemini 3.8 Flash (cheap); a Claude Code seat is expensive, so give it only what Flash cannot do well. Do trivial one-liners yourself. Open yourself from the page (the + beside Boss): a worker's `advisor` question only reaches a boss terminal the office opened or took over.

Every job is a fresh conversation: the worker knows only your prompt, task_board.md and project_proposal.md. worker-ask puts the seat rules and the "Bài học" lines of task_board.md in front of your prompt, so do not repeat them. Never run bare `agy`: always `worker-ask` (each account gets its own HOME).

## 1. One row per job
Plan the work from project_proposal.md with your own skills. Before you send a job, add its row to "Việc đang làm" in task_board.md (the bang-task skill): `| T3 | <job> | W1 | todo | <done when> | MM-DD HH:MM |`. The ID in the prompt's title is that row's ID.

## 2. The prompt: these 6 parts
worker-ask refuses a prompt without the title or any of the six headings (exit 1, naming the missing ones):

```
# Việc <ID> — <tên>              (ID trùng dòng trong task_board.md)
## Bối cảnh    ≤3 dòng, trỏ tới project_proposal.md §…
## Input       đường dẫn tương đối, định dạng, số lượng, 1 mẫu cụ thể; cái KHÔNG được đụng
## Skill dùng  <tên>: đọc .agents/skills/<tên>/SKILL.md trước; dùng ở bước nào
## Cách làm    bước đánh số; điều kiện dừng: gặp X → ghi "blocked: …" vào task_board và DỪNG, không đoán;
               giới hạn: chỉ sửa trong <thư mục>, không cài dependency, không commit
## Output      file + đường dẫn chính xác + định dạng; cập nhật dòng <ID> trong task_board (done | blocked: …);
               1 dòng Ghi chú kỹ thuật nếu giải quyết việc không hiển nhiên; báo cáo cuối ≤10 dòng
## Tiêu chí review  mỗi tiêu chí kèm LỆNH kiểm được
               vd: python ocr.py --in samples/ --out out/ → 10/10 file có text, rotated_01.png đọc đúng
```

- Paths are relative to the office folder. Name the exact files, paste one real sample, say what must not be touched.
- "Skill dùng": the skill's name only; ignore the `.agents/skills/` path in the template line. Seats load skills by name (Antigravity through `.agents/skills.json`, Claude through `.claude/skills` and its plugins); there is no `.agents/skills/` folder. "không" if none.
- "Tiêu chí review": every line is a command you will run yourself, with the output you expect.
- `--raw` sends a prompt without the headings: only for a one-line question, never for project work.
- The prompt, with the seat rules in front, must stay under 100 kB: put long diffs or logs in a file and give its path.

## 3. Send it in the background
```bash
worker-ask <seat> "$(cat <<'EOF'
# Việc T3 — …
…
EOF
)" --role impl --effort medium [--mode plan] [--timeout 1800]
```
- Always in the background, so you stay free for `advisor` questions: Claude Code with `run_in_background`; an Antigravity boss appends `> /tmp/T3.out 2>&1 &` and reads the file when it is done. Several seats in parallel are fine; never two seats on one file.
- `--mode auto` is the default label for Antigravity seats, but on this host file tools run without asking, shell commands may prompt in the seat's terminal, and the user approves them on the page. Tell the seat to prefer file tools over shell commands. Claude seats keep their own default mode unless you pass `--mode`. Pass `--mode plan` when the job deletes, writes outside its output folder, touches the source data, or installs anything. Plan jobs need the office running: the user approves the plan in the seat's terminal on the page. Headless (office off) a plan job returns an empty answer.
- `--effort low|medium|high` (Claude seats also take `xhigh|max`); `--model` takes Claude models for Claude seats; agy seats accept the gemini models too. Claude seats run full; `--lean` (Claude seats only; no MCP, skills or slash commands, and only the tools Bash, Read, Edit, Write, WebFetch, WebSearch) for small jobs.
- `--cwd` only when the worker must write outside the office folder. Killing the command, or `--timeout` (seconds), cancels the job.

## 4. Review: run the criteria yourself
When the job returns (exit 0), do not trust the worker's report: run every command of "Tiêu chí review" on the product.
- ✅ → move the row to "Đã xong" (`| T3 | <job> | MM-DD HH:MM | <result path> | ✅ |`). Something worth remembering → one line in "Bài học": `- Khi <tình huống> → <làm gì> (vì …) [T3]`. Every later prompt carries it; keep "Bài học" at 20 lines or fewer (move the oldest to task_board.archive.md).
- ❌ → set the row to `doing: sửa 1/2 — review ❌ <what failed>` and give the same seat a fix job: all 6 parts again plus a section `## Kết quả review lần trước` with the paths, the diff, every command you ran and its output. The worker remembers nothing.
- At most 2 fix rounds. A third ❌: stop and ask the user, with the three review results.

## 5. Answer a seat's question
A stuck seat runs `advisor`. The office types its question into your terminal as one message: `❓ Seat W2 asks (job T2): <question>` (in Vietnamese `❓ Ghế W2 hỏi (việc T2): <câu hỏi>`), then a line naming the tag to start with.
- Start the reply with the exact tag, e.g. `[ADVISOR W2 T2] Use docs/a.csv; skip the header row.`, and write NOTHING before it: no "let me check" preface. The first text after the tag is taken as the answer. If you must look at files first, do that, then answer.
- Reply with text only (no tools in the answer turn), brief and concrete. Everything after the tag, up to the next tag, goes to the seat verbatim.
- Two questions in one message: answer each under its own tag in the same reply.
- You do not know: say so under the tag and tell the seat to write `blocked:`; point to another seat's "Ghi chú kỹ thuật" when it holds the answer.
- Then keep delegating: your jobs keep running in the background (section 3), so the answer must not block them.
- The office writes the question and your answer to "Hỏi đáp" in task_board.md; do not write it yourself.
- It only reaches you while you run in a terminal the office opened or took over.

## Exit codes
| Exit | Meaning | What you do |
| --- | --- | --- |
| 0 | done, answer printed | review it (section 4) |
| 1 | failed, timeout, missing headings, over 100,000 bytes, empty prompt, empty answer, unknown seat, no folder, untrusted folder | read the message. "does not trust the folder": ask the user to run `cd <folder> && agy-as <acc>` (agy seats only) once and answer yes; retrying cannot help. Missing headings, empty prompt, or a prompt starting with `--`: fix the call. Empty answer: the job may be done, so check the review criteria before resending (headless usually means the seat could not run a command). Otherwise retry once, or do it yourself |
| 2 | refused by the office | do not retry, do not work around it |
| 3 | BUSY: the seat is on another job | wait until that job returns, or give this one to a free seat; never cancel another job to make room |
| 4 | the user cancelled the job | do not resend it unasked; tell the user |

## Pitfalls
- Flash over-claims on audits: re-check every serious finding before you report it.
- Steps, not the mode, drive the cost: name exact files so the worker does not explore.
