# Bài 8: Kéo thả bằng bàn phím (accessible drag and drop)

> Branch `learn/08-dnd`. Lời giải: tag `solution` (đừng mở trước khi làm xong).

## Vì sao bài này quan trọng

Hầu hết thư viện kéo thả chỉ nghĩ tới chuột. Người dùng bàn phím và trình đọc màn hình bị bỏ rơi. Project này có kéo thả bằng phím, với lời đọc cho trình đọc màn hình:

- **Space:** nhấc card lên.
- **↑ ↓:** di chuyển trong cột.
- **← →:** sang cột bên cạnh.
- **Space:** thả xuống. **Esc:** huỷ.

Mấu chốt kiến trúc: toàn bộ logic là một **state machine thuần** (`drag.ts`), không có React, không có mạng. Bàn phím _và_ chuột (dnd-kit) cùng điều khiển một state machine (K11). Trong lúc kéo, màn hình hiển thị `previewBoard()`, và **chỉ khi thả** mới sinh ra **đúng một** intent (K5), dù bạn bấm mũi tên bao nhiêu lần. Vì vậy cả chuỗi kéo thả cũng chỉ là **một bước undo** (U7).

## Đọc trước

1. `docs/TRUTH_TABLE.md`: các dòng **K1–K12** (và U7).
2. `packages/client/src/drag.ts`:
   - kiểu `Slot`, `CardDrag`, `ColumnDrag`;
   - `slotOf`, `startCardDrag`, `startColumnDrag`, `retarget`, `othersIn`, `isHome` (có sẵn);
   - `announce` ở cuối file: những câu trình đọc màn hình sẽ đọc.
3. `packages/shared/src/order.ts`: `cardOrderAt`, `columnOrderAt` (đã học ở bài 2).
4. `apps/web/src/DragProvider.tsx`: phím được nối vào state machine thế nào (không cần sửa).
5. `packages/client/test/drag.test.ts`.

## Việc của bạn

| Hàm                                | Làm gì                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `moveDrag(board, drag, direction)` | một lần bấm mũi tên. Card: ↑↓ trong cột, ←→ sang cột kế bên (giữ hàng nếu được, không thì kẹp lại). Cột: chỉ ←→ |
| `previewBoard(board, drag)`        | bảng _như thể_ đã thả ngay bây giờ. Chỉ tính ở máy mình, không gửi đi đâu                                       |
| `dropCard(board, drag)`            | tham số của **một** intent `moveCard`, hoặc `null` nếu thả đúng chỗ cũ                                          |
| `dropColumn(board, drag)`          | tương tự, cho cột                                                                                               |

## Chạy

```bash
pnpm --filter @kanban/client exec vitest --watch drag
```

Xong khi `drag.test.ts` xanh. Sau đó xoá 2 dòng `eslint-disable` ở đầu file và chạy `pnpm lint`. Thử thật với `pnpm dev`:

1. Tab tới nút ⠿ của một card, Space, mũi tên, Space.
2. Bật VoiceOver (Cmd+F5) để nghe những câu `announce`.
3. Chạy E2E bằng `pnpm e2e` (bộ test bàn phím trong Chrome thật).

## Gợi ý

<details><summary>Gợi ý 1: "index" là vị trí trong danh sách nào?</summary>

`Slot.index` là vị trí **giữa các card khác** của cột, tức _không tính_ card đang kéo. Nhờ vậy khi kéo trong cùng cột, index lớn nhất là `othersIn(...)`. `cardOrderAt` dùng đúng quy ước này (tham số cuối là id của card đang kéo).
</details>

<details><summary>Gợi ý 2: ← → khi cột bên cạnh ít card hơn</summary>

Giữ hàng hiện tại nếu cột mới đủ dài, không thì kẹp về cuối cột. Ở cột ngoài cùng, bấm tiếp thì không làm gì: trả lại _đúng_ drag cũ, để `announce.moved` nói được "Can't move further".
</details>

<details><summary>Gợi ý 3: test "the intent's order puts the card exactly where the preview showed it" đỏ</summary>

`previewBoard` và `dropCard` phải tính order **giống hệt nhau**. Cách chắc nhất là cả hai cùng dùng `cardOrderAt(board, columnId, index, cardId)`.
</details>

<details><summary>Gợi ý 4: previewBoard khi chưa đi đâu cả</summary>

Không kéo (`null`) hoặc đang ở đúng chỗ cũ: trả lại chính `board` (đúng object đó). React sẽ không phải vẽ lại gì.
</details>

## Thử phá code

Cho `dropCard` luôn trả về một intent, kể cả khi thả đúng chỗ cũ. Test nào đỏ? Vì sao gửi một intent "không đổi gì" vẫn có hại? (Gợi ý: undo, và cả server.)

## Tự kiểm tra

1. Vì sao cứ mỗi lần bấm mũi tên lại gửi một intent là một thiết kế tệ? Nêu ít nhất 2 lý do.
2. Vì sao project tắt keyboard sensor có sẵn của dnd-kit và tự viết state machine?
3. Đang kéo bằng phím thì người khác xoá card đó. Chuyện gì xảy ra (K9), và đoạn code nào lo việc này?

## Xong rồi thì

```bash
pnpm lint && pnpm format && pnpm --filter @kanban/client test
git add -A && git commit -m "Lesson 8: drag and drop"
git push -u origin learn/08-dnd
git diff solution -- packages/client/src/drag.ts
```

Nhắn mình kèm câu trả lời để mình review.
