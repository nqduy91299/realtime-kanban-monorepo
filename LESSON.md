# Bài 1: Luật chơi là các hàm thuần (pure functions)

> Branch `learn/01-rules`. Lời giải nằm ở tag `solution`, nhưng **đừng mở nó trước khi làm xong**.

## Vì sao bài này quan trọng

Trong app cộng tác, câu hỏi _"thay đổi này có hợp lệ không?"_ được hỏi ở **hai nơi**:

- **Trình duyệt** hỏi để hiện kết quả ngay lập tức (optimistic update).
- **Server** hỏi để quyết định thật.

Nếu hai nơi dùng hai đoạn code khác nhau, sớm muộn chúng sẽ lệch nhau: người dùng thấy card nhảy về chỗ cũ mà không hiểu vì sao. Vì vậy cả hai dùng **chung một bộ hàm**, nằm trong `packages/shared/src/mutators.ts`. Mỗi hàm là một _pure function_: nhận vào trạng thái board và tham số, trả ra `{ ok: true, changes }` hoặc `{ ok: false, code }`. Hàm không sửa gì, không gọi mạng.

## Đọc trước (theo thứ tự)

1. `packages/shared/src/types.ts`: board gồm 2 map, `columns` và `cards`. Để ý `deleted: boolean`: không có gì bị xoá thật.
2. `packages/shared/src/intents.ts`: 9 loại thay đổi, kiểm tra input bằng zod.
3. `docs/TRUTH_TABLE.md` **§4 (R1–R9)** và **§3 (C4, C9, C10, C12)**: đây là "đề bài" viết bằng lời.
4. `packages/shared/src/mutators.ts`: đọc các phần **đã có sẵn** để bắt chước:
   - các helper `reject`, `ok`, `card`, `column`, `matches` (R9), `liveCardCount`
   - các mutator mẫu `deleteCard`, `restoreCard`, `moveColumn`
   - `runIntent()` ở cuối file

## Việc của bạn

Viết thân 4 hàm đang `throw new Error("TODO lesson 1: …")`:

| Hàm            | Luật cần đảm bảo                                                  |
| -------------- | ----------------------------------------------------------------- |
| `checkTarget`  | R2 (cột phải còn sống), R3 (giới hạn WIP), R7 (cột không tồn tại) |
| `moveCard`     | R2, R3, R6, R7, R9                                                |
| `deleteColumn` | R4, R7, R9                                                        |
| `setWipLimit`  | R5, R7, R9, và "cột đã xoá thì không đổi được"                    |

## Chạy

```bash
pnpm --filter @kanban/shared test          # chạy một lần
cd packages/shared && pnpm test:watch      # tự chạy lại mỗi khi bạn lưu file (khuyên dùng)
```

Bắt đầu: **38 test đỏ, 25 xanh**. Xong khi: **63/63 xanh**.

⚠️ Trên branch này, test của `apps/server` và `packages/client` cũng sẽ đỏ, vì mọi thứ đều dựa vào luật chơi. Chỉ cần chạy test của `packages/shared`.

## Gợi ý (chỉ mở khi bí)

<details><summary>Gợi ý 1: test đòi một mã lỗi cụ thể khi nhiều luật cùng sai</summary>

Thứ tự kiểm tra quyết định mã lỗi trả về. Xem `deleteCard` có sẵn: nó kiểm tra _tồn tại → expect (STALE) → trạng thái_. Hãy tự hỏi: nếu card đã bị xoá **và** `expect` không khớp, người gọi (chức năng undo ở bài 9) nên nhận `STALE` hay `CARD_DELETED`?
</details>

<details><summary>Gợi ý 2: test "reordering inside a full column is allowed" vẫn đỏ</summary>

Cột "Doing" giới hạn 1 và đang có đúng card đó. Card đổi vị trí _trong cùng cột_ thì có làm cột vượt giới hạn không? Xem tham số thứ ba của `liveCardCount`.
</details>

<details><summary>Gợi ý 3: deleteColumn trên cột đã xoá</summary>

Hai người cùng bấm "Delete column" một lúc. Người thứ hai nên nhận lỗi, hay "thành công nhưng không đổi gì"? Xem `deleteCard` xử lý trường hợp xoá hai lần thế nào.
</details>

<details><summary>Gợi ý 4: setWipLimit và số card đang có</summary>

Đặt giới hạn **bằng** số card hiện có thì được (R5). Chỉ **nhỏ hơn** mới bị từ chối. Card đã xoá có tính không?
</details>

## Thử phá code (sau khi đã xanh)

Đổi `>=` thành `>` trong phần kiểm tra WIP của `checkTarget`. Những test nào đỏ? Vì sao chỉ một ký tự lại đổi nghĩa của "giới hạn 3"?

## Tự kiểm tra

Trả lời 3 câu dưới đây khi nhắn cho mình:

1. `runIntent` kiểm tra `role` **trước** khi kiểm tra input. Vì sao lại theo thứ tự đó? (Gợi ý: một viewer có thể dò ra được điều gì nếu làm ngược lại?)
2. Mutator trả về `changes` thay vì sửa board trực tiếp. Nêu một lợi ích cho **client** và một lợi ích cho **server**.
3. Vì sao `checkTarget` nhận `cardId`? Nêu một tình huống sẽ sai nếu bỏ tham số đó.

## Xong rồi thì

Đầu file `mutators.ts` có một dòng `eslint-disable`, vì các hàm còn là khung thì chưa dùng tham số. Khi test đã xanh, **xoá dòng đó** và chạy:

```bash
pnpm lint                  # ESLint phải sạch
pnpm format                # Prettier format lại code của bạn
```

```bash
git add -A && git commit -m "Lesson 1: implement the board rules"
git push -u origin learn/01-rules
git diff solution -- packages/shared/src/mutators.ts   # so với lời giải
```

Nhắn mình kèm câu trả lời 3 câu hỏi. Mình sẽ review code (có chỗ bạn làm khác mà vẫn đúng không? có edge case nào test chưa bắt?) rồi tạo `learn/02-ordering`.
