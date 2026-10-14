# Bài 3: Đồng bộ text bằng CRDT (Yjs)

> Branch `learn/03-sync`. Lời giải: tag `solution` (đừng mở trước khi làm xong).

## Vì sao bài này quan trọng

Đây là trái tim của câu phỏng vấn _"design a collaborative editor"_. Bạn sẽ tự nối luồng đồng bộ giữa server và nhiều client:

- **Handshake 2 bước (sync1 / sync2).** Bên A gửi _state vector_: "tôi đã có những gì" (một danh sách gọn, mỗi client tương ứng một con số). Bên B chỉ trả về **đúng phần A còn thiếu**. Nhờ vậy người vào sau nhận đủ lịch sử (S4), và người vừa offline xong gửi lên đúng những gì họ đã sửa (F4).
- **Relay.** Mỗi update server nhận được thì lưu lại (S5), rồi gửi cho mọi người trong phòng (S6) _trừ người gửi_.
- **Origin.** Mỗi thay đổi trong Yjs có kèm một "nhãn nguồn gốc" (`origin`). Dựa vào đó, client biết đâu là chữ mình gõ (cần gửi đi) và đâu là chữ vừa nhận từ server (gửi lại sẽ thành vòng lặp vô tận).

## Đọc trước

1. `docs/TRUTH_TABLE.md`: **D1, D2, §10** và các dòng **S1–S7, C1–C3, F4**.
2. `packages/shared/src/protocol.ts`: các loại message và chú thích về sync1/sync2.
3. `packages/shared/test/crdt.test.ts`: hàm `exchange()` là toàn bộ ý tưởng của handshake, viết trong 4 dòng.
4. `apps/server/src/server.ts`: `onConnection` (server tự gửi sync1 khi client vừa kết nối) và `handle`.
5. `packages/client/src/BoardClient.ts`: `open()` (client gửi sync1 cho cả 2 doc) và `receive()`.

## Việc của bạn

4 chỗ có `TODO lesson 3`:

| File                                 | Chỗ                            | Làm gì                                                         |
| ------------------------------------ | ------------------------------ | -------------------------------------------------------------- |
| `apps/server/src/room.ts`            | `relay()`                      | lưu update, gửi cho người khác trong phòng                     |
| `apps/server/src/server.ts`          | `case "sync1"`                 | trả sync2 với phần client còn thiếu                            |
| `packages/client/src/BoardClient.ts` | `case "sync1"`, `case "sync2"` | trả lời server; nhận phần mình thiếu, rồi chuyển sang "online" |
| `packages/client/src/BoardClient.ts` | `onLocalContentUpdate`         | chỉ gửi chữ _mình_ gõ                                          |

Các API Yjs bạn cần: `Y.encodeStateVector(doc)`, `Y.encodeStateAsUpdate(doc, stateVector)`, `Y.applyUpdate(doc, update, origin)`. Dữ liệu nhị phân đi qua mạng dưới dạng base64: `toBase64` / `fromBase64`.

## Chạy

```bash
pnpm --filter @kanban/server exec vitest run sync     # chỉ file test/sync.test.ts (9 test)
```

⏳ Khi chưa làm xong, mỗi test sẽ **chờ tới hết giờ (5 giây)** rồi mới báo đỏ, vì client không bao giờ "online" được. Cả file mất chừng một phút, chuyện bình thường. Khi cả file xanh, chạy thêm `pnpm --filter @kanban/server test` để chắc chắn mọi test của server đều xanh (bài này là nền móng của mọi thứ khác).

Xong thì xoá các dòng `eslint-disable` ở đầu `room.ts` và `BoardClient.ts`, rồi chạy `pnpm lint`.

## Gợi ý

<details><summary>Gợi ý 1: relay gửi cho ai?</summary>

Trong `server.ts`, khi nhận update từ client, server gọi `Y.applyUpdate(room.content, …, conn)`: tham số thứ 3 (origin) chính là kết nối đã gửi. Còn khi server tự sửa (seed board, áp dụng intent), origin là `SERVER_ORIGIN`, và lúc đó thì gửi cho _tất cả_.
</details>

<details><summary>Gợi ý 2: client không bao giờ "online"</summary>

`open()` tạo `pendingSync` gồm 2 doc. Mỗi lần nhận sync2, xoá doc đó khỏi tập. Khi tập rỗng thì gọi `setStatus("online")`, và `whenSynced()` chờ đúng sự kiện này.
</details>

<details><summary>Gợi ý 3: test R1 "viewer's edit is rejected" đỏ</summary>

Viewer không được gửi update. Có 2 chỗ client có thể gửi: `onLocalContentUpdate` và câu trả lời sync1 (gửi lên những gì viewer "có mà server không có").
</details>

<details><summary>Gợi ý 4: vòng lặp vô tận / tin nhắn bị gửi lại</summary>

Update nhận từ server được áp dụng với origin `REMOTE`. Update nạp từ IndexedDB có origin `STORAGE`. Cả hai đều _không_ phải chữ mình gõ.
</details>

## Thử phá code

Trong `relay`, gửi cho _cả người gửi_. Test nào đỏ, hay không test nào đỏ? Vì sao Yjs vẫn chịu được chuyện nhận lại chính update của mình? (Gợi ý: CRDT là _idempotent_.) Vậy bỏ qua người gửi giúp ích ở điểm nào?

## Tự kiểm tra

1. Vì sao server _cũng_ gửi sync1 cho client khi client vừa kết nối? Nếu chỉ client gửi sync1 thì tình huống nào sẽ mất dữ liệu?
2. State vector khác gì so với "gửi toàn bộ document"? Khi nào chúng cho ra cùng một kết quả?
3. Bạn có cần sắp xếp thứ tự các update trước khi `applyUpdate` không? Vì sao? (Nhìn test S3 trong `crdt.test.ts`.)

## Xong rồi thì

```bash
pnpm lint && pnpm format && pnpm --filter @kanban/server test
git add -A && git commit -m "Lesson 3: sync"
git push -u origin learn/03-sync
git diff solution -- apps/server/src packages/client/src/BoardClient.ts
```

Nhắn mình kèm câu trả lời để mình review.
