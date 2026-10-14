# Bài 6: Presence (ai đang ở đây, con trỏ, đang làm gì)

> Branch `learn/06-presence`. Lời giải: tag `solution` (đừng mở trước khi làm xong).

## Vì sao bài này quan trọng

Presence là loại dữ liệu khác hẳn card và text. Nó **tạm thời**: không lưu, không undo, không giữ khi offline (P6). Mất một cập nhật vị trí con trỏ cũng không sao, vì cập nhật tiếp theo sẽ tới ngay. Bù lại, phải xử lý tốt chuyện **người dùng biến mất**:

- **Đóng tab:** phải biến mất **ngay** khỏi màn hình người khác (P5). Server tự xoá presence của kết nối vừa đóng.
- **Mất mạng mà không đóng tab:** server không nhận được tín hiệu "close". Khi đó cần cơ chế hết hạn (30 giây) và heartbeat. Phần này đã có sẵn.
- **Kết nối lại:** phải thấy lại mọi người ngay (P8). Ở đây có một cái bẫy trong cách Yjs awareness so sánh "clock". Đây là bug thật mà mình đã gặp và sửa ở M3.

## Đọc trước

1. `docs/TRUTH_TABLE.md`: **D6** và các dòng **P1–P8**.
2. `packages/shared/src/presence.ts`: hình dạng của một presence, và vì sao phải `parsePresence`.
3. Mã nguồn `y-protocols/awareness` trong `node_modules`: đọc hàm `applyAwarenessUpdate`, chú ý điều kiện `currClock < clock`.
4. `apps/server/src/room.ts` (`Rooms.leave` gọi `forgetPresence`) và `server.ts` (`case "awareness"`).
5. `packages/client/src/BoardClient.ts`: `setPresence`, `onLocalAwarenessUpdate`, chỗ gọi `forgetPeers` (khi socket đóng) và `reannouncePresence` (trong `open()`).
6. `apps/server/test/presence.test.ts`.

## Việc của bạn

| File                                 | Hàm                  | Làm gì                                                       |
| ------------------------------------ | -------------------- | ------------------------------------------------------------ |
| `apps/server/src/room.ts`            | `relayAwareness`     | nhớ client id thuộc kết nối nào; gửi cho người khác          |
| `apps/server/src/room.ts`            | `forgetPresence`     | xoá presence của một kết nối vừa đóng                        |
| `packages/client/src/BoardClient.ts` | `onAwarenessChange`  | dựng danh sách `peers` (trừ chính mình, có kiểm tra dữ liệu) |
| `packages/client/src/BoardClient.ts` | `forgetPeers`        | khi offline: quên mọi người, và **quên luôn clock của họ**   |
| `packages/client/src/BoardClient.ts` | `reannouncePresence` | khi kết nối lại: gửi lại trạng thái của mình với clock mới   |

## Chạy

```bash
pnpm --filter @kanban/server exec vitest run presence
```

Xong khi file này xanh. Sau đó xoá các dòng `eslint-disable` ở đầu 2 file và chạy `pnpm lint`. Thử thật bằng `pnpm dev` với hai cửa sổ có độ rộng khác nhau.

## Gợi ý

<details><summary>Gợi ý 1: test "closed tab disappears at once" đỏ</summary>

`forgetPresence` chỉ xoá được những gì mình _biết_ thuộc về kết nối đó, tức `conn.awarenessIds`. Danh sách này phải được cập nhật trong `relayAwareness` mỗi khi kết nối gửi presence lên (added, updated → thêm; removed → bỏ).
</details>

<details><summary>Gợi ý 2: test "ignores presence that doesn't match the schema" đỏ</summary>

Ai cũng có thể gửi bất kỳ thứ gì qua awareness. Một cái tên chứa `<script>` hay một màu kiểu `red; background: url(x)` không được lọt vào UI. `parsePresence` trả `null` cho state không hợp lệ.
</details>

<details><summary>Gợi ý 3: test P8 "coming back shows them again immediately" đỏ</summary>

Awareness chỉ chấp nhận một state nếu **clock của nó mới hơn** clock cuối cùng đã thấy. Hãy nghĩ cả hai chiều:

- Khi offline, client xoá state của người khác nhưng vẫn _nhớ clock_ của họ. Lúc kết nối lại, server gửi state với **cùng** clock đó, và nó bị bỏ qua. Cách sửa: `this.awareness.meta`.
- Server đã xoá state của bạn khi kết nối cũ đóng. Nếu bạn gửi lại state với clock cũ, server cũng bỏ qua. Cách sửa: `setLocalState` tự tăng clock.

</details>

## Thử phá code

Trong `forgetPeers`, bỏ bước xoá clock. Chạy test P8: nó đỏ. Giờ mở `pnpm dev`, tắt rồi bật server: người kia hiện lại sau tối đa **15 giây** (lúc họ tự gia hạn presence) thay vì ngay lập tức. Đây là kiểu bug "thỉnh thoảng chậm" rất khó tái hiện ngoài đời.

## Tự kiểm tra

1. Vì sao presence không đi qua outbox và cơ chế ack/nack như card? Nếu một cập nhật con trỏ bị mất thì sao?
2. Cùng một người mở 2 tab thì thấy 1 hay 2 avatar (P7)? Vì sao thiết kế như vậy?
3. Server làm thế nào để biết một tab đã "chết" khi mạng rớt mà không có sự kiện close?

## Xong rồi thì

```bash
pnpm lint && pnpm format && pnpm --filter @kanban/server test
git add -A && git commit -m "Lesson 6: presence"
git push -u origin learn/06-presence
git diff solution -- apps/server/src/room.ts packages/client/src/BoardClient.ts
```

Nhắn mình kèm câu trả lời để mình review.
