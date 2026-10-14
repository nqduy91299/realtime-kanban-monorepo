# Bài 5: Optimistic update và rollback

> Branch `learn/05-optimistic`. Lời giải: tag `solution` (đừng mở trước khi làm xong).

## Vì sao bài này quan trọng

Đây là câu hỏi phỏng vấn kinh điển: _"UI cập nhật ngay lập tức, nhưng nếu server từ chối thì sao?"_ Câu trả lời của project gói gọn trong một dòng (D3):

```
view = confirmed state + replay(pending intents)
```

- **Client không bao giờ tự sửa `confirmed`.** Chỉ server mới ghi vào đó.
- **Thay đổi đang chờ nằm trong `outbox`** và được "chạy lại" trên `confirmed` mỗi khi cần vẽ lại màn hình.
- **Server chấp nhận (ack):** bỏ intent khỏi outbox. Kết quả của nó đã nằm sẵn trong `confirmed`, nên không có gì nhảy trên màn hình.
- **Server từ chối (nack):** bỏ intent khỏi outbox và tính lại view, card tự về chỗ cũ. **Rollback không cần code riêng.**

Phía server phải làm đúng **4 bước theo đúng thứ tự**, và thứ tự đó là nội dung chính của bài.

## Đọc trước

1. `docs/TRUTH_TABLE.md`: **D3, D4**, các dòng **O1–O8, R8** và **C10**.
2. `packages/client/src/BoardClient.ts`: `mutate()` (có sẵn: đưa intent vào outbox, rồi gọi `recomputeView` và `sendIntent`), `sendIntent()` (gửi lại khi quá giờ, O7) và `receive()` (case `ack`/`nack` gọi `settle`).
3. `apps/server/src/server.ts`: chú thích phía trên `handleIntent` mô tả 4 bước. Đọc thêm `reply()`.
4. `apps/server/src/store.ts`: `intentResult`, `recordIntent`, `transaction`.
5. `apps/server/test/intents.test.ts`: mỗi `describe` là một dòng trong truth table.

## Việc của bạn

| File                                 | Hàm               | Làm gì                                                                            |
| ------------------------------------ | ----------------- | --------------------------------------------------------------------------------- |
| `packages/client/src/BoardClient.ts` | `recomputeView()` | `confirmed` + chạy lại outbox; điền `pending`                                     |
| `packages/client/src/BoardClient.ts` | `settle()`        | xử lý ack/nack: bỏ khỏi outbox (bộ nhớ + IndexedDB), tính lại view, báo rejection |
| `apps/server/src/server.ts`          | `handleIntent()`  | 4 bước: dedupe → chạy mutator → ghi + lưu trong 1 transaction → trả lời           |

Bản khung hiện tại cố ý "chạy được nhưng không optimistic". Chạy `pnpm dev`, kéo một card, và để ý card chỉ di chuyển _sau khi_ server trả lời. Khi bạn làm xong, card sẽ di chuyển ngay lập tức.

## Chạy

```bash
pnpm --filter @kanban/server exec vitest run intents
```

⏳ Test nào đợi một câu trả lời không bao giờ tới sẽ báo đỏ sau vài giây, chuyện bình thường. Khi file này xanh, chạy `pnpm --filter @kanban/server test`. Các file `undo` và `offline` cũng dựa trên bài này, nên chúng cũng phải xanh.

Xong thì xoá 2 dòng `eslint-disable` ở đầu `BoardClient.ts` và `server.ts`, rồi chạy `pnpm lint`.

## Gợi ý

<details><summary>Gợi ý 1: một intent đang chờ bị server từ chối trong lúc chạy lại</summary>

Khi chạy lại outbox, một intent có thể _không còn hợp lệ_, ví dụ người khác vừa làm đầy cột. Đừng ném lỗi: bỏ qua nó trong view, server sắp gửi nack. Nhưng nó vẫn đang chờ, nên id của nó vẫn phải nằm trong `pending`.
</details>

<details><summary>Gợi ý 2: settle nhận câu trả lời cho một id không có trong outbox</summary>

Chuyện này xảy ra thật: client gửi lại sau 10 giây (O7), server trả lời _cả hai_ lần (R8). Câu trả lời thứ hai không còn gì để làm.
</details>

<details><summary>Gợi ý 3: test O3 "never flickers back" đỏ</summary>

Nếu server gửi ack **trước** bản cập nhật structure, client bỏ intent khỏi outbox khi `confirmed` chưa có kết quả, và card nhảy về chỗ cũ trong chốc lát. Trong `handleIntent`, `writeChanges` kích hoạt `relay` (gửi update) ngay lập tức, nên chỉ cần gọi `reply()` _sau_ khi ghi.
</details>

<details><summary>Gợi ý 4: test R8 "remembers across a restart" đỏ</summary>

Phải _ghi nhớ_ quyết định (cả ack lẫn nack) vào SQLite, trong **cùng transaction** với thay đổi. Nếu không, server crash giữa chừng sẽ để lại một thay đổi "đã áp dụng nhưng không ai nhớ", và lần gửi lại sẽ áp dụng nó hai lần.
</details>

## Thử phá code

Trong `handleIntent`, chuyển `reply()` lên **trước** transaction. Test nào đỏ? Chạy `pnpm dev`, đặt độ trễ 1500 ms trong dev panel rồi kéo card: bạn có thấy nó giật về một chút không?

## Tự kiểm tra

1. Vì sao client _không_ sửa `confirmed` trực tiếp khi người dùng kéo card? Nếu làm vậy, rollback sẽ khó ở chỗ nào?
2. Vì sao gửi lại một intent (cùng `id`) là an toàn, nhưng gửi một intent _mới_ có cùng nội dung thì không?
3. Thay đổi của người khác tới trong lúc intent của bạn đang chờ. Màn hình của bạn hiện gì, và vì sao (O6)?

## Xong rồi thì

```bash
pnpm lint && pnpm format && pnpm --filter @kanban/server test
git add -A && git commit -m "Lesson 5: optimistic updates"
git push -u origin learn/05-optimistic
git diff solution -- packages/client/src/BoardClient.ts apps/server/src/server.ts
```

Nhắn mình kèm câu trả lời để mình review.
