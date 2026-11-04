# Task board — <tên dự án>
_Office: <folder> · Boss: <kind/account> · Ghế: W1 agy/acc1, W2 agy/acc1, C1 claude/default_
_Cập nhật lần cuối: YYYY-MM-DD HH:MM (ai)_

## Bối cảnh
≤3 dòng. Chi tiết ở project_proposal.md.

## Việc đang làm
| ID | Việc | Ai | Trạng thái | Xong khi | Cập nhật |
|---|---|---|---|---|---|
| T1 | OCR 50 văn bản đầu (docs/001–050) | W1 | doing: 12/50 | out/001–050.txt có text, review ✅ | 11-03 15:20 |

## Ghi chú kỹ thuật
| Ngày | Ai | Vấn đề | Cách xử lý | Ở đâu |
|---|---|---|---|---|
| 11-03 | W1 | ảnh xoay 90° OCR ra rỗng | thử 4 góc xoay, chọn góc nhiều từ có nghĩa nhất | ocr.py:40 |

## Bài học (chỉ boss ghi; ≤20 dòng; dòng cũ chuyển sang task_board.archive.md)
- Khi OCR ra rỗng hoặc toàn ký tự lạ → thử xoay 90/180/270 trước khi đổi engine (vì 10/100 văn bản scan ngang) [T1]

## Hỏi đáp (advisor ghi tự động)
| Lúc | Ai | Hỏi | Trả lời |
|---|---|---|---|

## Đã xong
| ID | Việc | Xong lúc | Kết quả / đường dẫn | Review |
|---|---|---|---|---|

## Luật cho agent
1. Đọc file này trước khi làm. Chỉ sửa dòng việc của mình và thêm dòng vào Ghi chú kỹ thuật. Boss tạo dòng việc, ghi Review và Bài học, chuyển việc sang Đã xong.
2. Trạng thái một dòng: `todo` | `doing: <đến đâu>` | `blocked: <cần gì>` | `done`.
3. Giải quyết việc không hiển nhiên → một dòng Ghi chú kỹ thuật, có file:line.
4. Kẹt → đọc Ghi chú kỹ thuật của người khác trước; vẫn kẹt → `/advisor`; advisor không trả lời → ghi `blocked:` và DỪNG, không đoán.
5. Đường dẫn tương đối từ thư mục office. Đã xong quá 20 dòng → chuyển sang task_board.archive.md.
