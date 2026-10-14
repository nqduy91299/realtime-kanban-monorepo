# Bài 9: Undo/redo khi nhiều người cùng sửa

> Branch `learn/09-undo`. Lời giải: tag `solution` (đừng mở trước khi làm xong).

## Vì sao bài này quan trọng

Undo trong app một người dùng thì đơn giản: lưu trạng thái cũ rồi khôi phục. Khi **nhiều người cùng sửa** thì không làm vậy được. Khôi phục "trạng thái cũ" sẽ xoá mất những gì người khác làm sau bạn.

Cách của project: **undo cũng chỉ là một thay đổi như mọi thay đổi khác.**

- **Undo gửi intent ngược lại** (move về chỗ cũ, restore card vừa xoá…). Nó đi qua đúng các luật như mọi intent, nên có thể bị từ chối, ví dụ khi cột cũ giờ đã đầy (U3).
- **Mỗi undo mang theo `expect`**: "chỉ làm nếu card vẫn đang ở đúng chỗ _mình_ để lại". Nếu người khác đã di chuyển nó, luật **R9** trả về `STALE`, và undo **không ghi đè** lên việc của họ (U4). Vậy là bạn đã dùng tới R9 viết từ bài 1!
- **Chỉ undo việc của chính mình** (U2). Lịch sử chỉ ghi những thay đổi có nguồn là `"user"`.

## Đọc trước

1. `docs/TRUTH_TABLE.md`: các dòng **U1–U9**, **R9** và **C6**.
2. `packages/client/src/undo.ts`:
   - chú thích phía trên `invertIntent`;
   - lớp `BoardUndo`: constructor (ghi lại thay đổi của user; bỏ entry bị server từ chối), `undo()`, `redo()`.
3. `packages/shared/src/mutators.ts`: `restoreCard`, `restoreColumn`, và cách `expect` được kiểm tra (`matches`).
4. Test: `packages/client/test/undo.test.ts`, có một **property test**: với mọi thay đổi ngẫu nhiên, _thay đổi → undo_ phải về đúng bảng ban đầu, _→ redo_ phải về đúng bảng sau thay đổi. Thêm `apps/server/test/undo.test.ts` cho 2 người dùng thật.

## Việc của bạn

| Hàm                                   | Làm gì                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `invertIntent(before, intent)`        | với mỗi loại intent: trả về `{ undo, redo }`, mỗi cái kèm `expect`. Trả `null` nếu thay đổi đó không làm gì |
| `BoardUndo.step(from, to, direction)` | thực hiện một bước undo/redo và chuyển entry giữa hai stack                                                 |

## Chạy

```bash
pnpm --filter @kanban/client exec vitest --watch undo      # invertIntent + property test
pnpm --filter @kanban/server exec vitest run undo          # BoardUndo với 2 người dùng
```

Xong thì xoá 2 dòng `eslint-disable` ở đầu `undo.ts` và chạy `pnpm lint`. Thử thật:

1. Mở 2 tab với `pnpm dev`.
2. Tab A kéo một card, tab B kéo tiếp card đó.
3. Ở tab A bấm ⌘Z: bạn sẽ thấy thông báo "Couldn't undo: someone changed … after you".

## Gợi ý

<details><summary>Gợi ý 1: undo của "tạo card" là gì? Còn redo?</summary>

Undo là `deleteCard` (xoá mềm). Còn redo thì **không** phải `createCard` lại: card vẫn còn đó, chỉ bị đánh dấu `deleted`. Redo là `restoreCard`. Làm tương tự với cột (`restoreColumn`).
</details>

<details><summary>Gợi ý 2: expect của undo là gì?</summary>

Là trạng thái mà **thay đổi của bạn để lại**. Ví dụ bạn chuyển card từ (todo, "a0") sang (doing, "a5"): undo = move về (todo, "a0") **nếu** card vẫn ở (doing, "a5"). Redo thì ngược lại: chỉ làm nếu card vẫn ở (todo, "a0").
</details>

<details><summary>Gợi ý 3: khi nào trả về null?</summary>

Khi thay đổi đó không làm gì cả: xoá một card đã bị xoá, restore một card đang sống, đặt WIP limit bằng đúng giá trị cũ, di chuyển về đúng chỗ cũ. Property test kiểm tra rằng `null` chỉ xuất hiện khi bảng thật sự không đổi.
</details>

<details><summary>Gợi ý 4: test "an undo the server rejects is dropped from history" đỏ</summary>

Sau khi `mutate` thành công, entry chuyển sang stack bên kia **với id của intent mới**. Nếu server từ chối intent đó, handler `onRejected` trong constructor sẽ tìm theo id này để bỏ entry đi.
</details>

## Thử phá code

Bỏ `expect` khỏi undo của `moveCard`. Chạy test U4 ở server: nó đỏ. Nghĩa là undo của bạn **âm thầm kéo card ra khỏi chỗ người khác vừa đặt**. Đây là bug kinh điển của undo trong app cộng tác.

## Tự kiểm tra

1. Vì sao undo không đơn giản là "khôi phục snapshot của bảng trước đó"?
2. Bạn kéo card A rồi B rồi C, người khác sửa card B. Bạn bấm undo 3 lần thì chuyện gì xảy ra với từng bước?
3. Vì sao undo của bảng và undo khi gõ chữ trong ô tiêu đề là **hai lịch sử riêng**? (Xem `CollaborativeInput.tsx` và U5.)

## Xong rồi thì

```bash
pnpm lint && pnpm format && pnpm --filter @kanban/client test && pnpm --filter @kanban/server test
git add -A && git commit -m "Lesson 9: undo"
git push -u origin learn/09-undo
git diff solution -- packages/client/src/undo.ts
```

Đây là bài cuối của phần code. Bài 10 (testing + deploy) mình sẽ làm cùng bạn, không có branch bài tập. Nhắn mình kèm câu trả lời để mình review.
