# Bài 7: Offline: tắt mạng, reload, không mất gì

> Branch `learn/07-offline`. Lời giải: tag `solution` (đừng mở trước khi làm xong).

## Vì sao bài này quan trọng

"Offline-first" nghe đơn giản ("cứ lưu xuống máy"), nhưng cái khó nằm ở các chi tiết:

- **Lưu cái gì?** Cả hai doc (để reload vẫn thấy bảng, kể cả dữ liệu đã nhận từ server) _và_ outbox (những thay đổi chưa gửi).
- **Thứ tự.** Outbox phải gửi lại **đúng thứ tự cũ** (F5). "Tạo card X" phải tới server trước "di chuyển card X".
- **Nhiều tab.** Hai tab cùng một bảng ghi chung một IndexedDB. Thiết kế "một dòng cho mỗi intent" giúp chúng không ghi đè nhau.
- **Origin.** Dữ liệu nạp từ đĩa không được gửi lên server như thể vừa gõ, cũng không được lưu lại lần nữa.

IndexedDB dùng API kiểu _callback_ (request → `onsuccess`). Bài này cũng là dịp để tập bọc nó thành Promise.

## Đọc trước

1. `docs/TRUTH_TABLE.md`: các dòng **F1–F9**.
2. `packages/client/src/localStore.ts`:
   - phần khởi tạo DB (`onupgradeneeded`: 2 object store và các index);
   - `load()`, `appendUpdate`, `addIntent`, `removeIntent`, `write()`;
   - `MemoryStore` ở cuối file: cùng giao diện, nhưng viết bằng mảng. Đọc nó để biết hàm của bạn phải trả về gì.
3. `packages/client/src/BoardClient.ts`: `connect()` chờ `ready` (tức `loadLocal`), các hàm `saveContent`/`saveStructure`, và `STORAGE`.
4. Test: `packages/client/test/localStore.test.ts` và `apps/server/test/offline.test.ts`. Ở đây "reload" là tạo một client mới trên cùng một IndexedDB.

## Việc của bạn

| File                                 | Hàm                    | Làm gì                                                     |
| ------------------------------------ | ---------------------- | ---------------------------------------------------------- |
| `packages/client/src/localStore.ts`  | `loadDoc`              | đọc và gộp các update của một doc; nén lại khi log quá dài |
| `packages/client/src/localStore.ts`  | `loadOutbox`           | các intent đang chờ của bảng, cũ nhất trước                |
| `packages/client/src/BoardClient.ts` | phần trong `loadLocal` | đưa dữ liệu đã lưu trở lại vào client                      |

## Chạy

```bash
pnpm --filter @kanban/client exec vitest --watch localStore     # bước 1: hai hàm đọc IndexedDB
pnpm --filter @kanban/server exec vitest run offline            # bước 2: reload khi offline, đầu-cuối
```

Xong thì xoá các dòng `eslint-disable` ở đầu `localStore.ts` và `BoardClient.ts`, rồi chạy `pnpm lint`. Thử thật như sau:

1. `pnpm dev:server` và `pnpm dev:web` ở hai terminal.
2. Tắt server, sửa vài card, **reload** trang.
3. Bật lại server.

## Gợi ý

<details><summary>Gợi ý 1: bọc request IndexedDB thành Promise</summary>

Xem `loadOutbox` cần gì: `db.transaction("outbox").objectStore("outbox").index("byBoard").getAll(boardId)` trả về một _request_. `resolve` trong `onsuccess`, `reject(idbError(...))` trong `onerror`. Còn với `loadDoc`, vì có thể _ghi_ (nén log), hãy resolve khi **transaction** hoàn tất (`tx.oncomplete`), không phải khi request xong.
</details>

<details><summary>Gợi ý 2: "oldest first" dựa vào đâu?</summary>

Object store `outbox` dùng `autoIncrement`, nên key tăng dần theo thứ tự thêm vào. `getAll` trả các dòng theo thứ tự key.
</details>

<details><summary>Gợi ý 3: nén log mà không làm mất dòng của tab khác</summary>

Chỉ xoá đúng những key bạn **đã đọc** (`getAllKeys` trên cùng index và range), rồi thêm một dòng gộp. Dòng mà tab khác thêm sau đó có key lớn hơn, nên không bị đụng tới.
</details>

<details><summary>Gợi ý 4: test F2+F3 báo pending sai, hoặc thứ tự sai</summary>

Trong `loadLocal`: intent đã lưu là _cũ hơn_ những gì `mutate()` vừa thêm trong lúc chờ đọc đĩa, nên phải đứng trước. Và đừng thêm một intent hai lần nếu nó có ở cả hai danh sách.
</details>

## Thử phá code

Trong `loadOutbox`, đảo ngược kết quả (`.reverse()`). Test nào đỏ? Đọc thông báo lỗi: server từ chối intent "move" vì card chưa tồn tại. Đó chính là F5.

## Tự kiểm tra

1. Vì sao lưu cả **structure** doc (do server viết) xuống máy, chứ không chỉ lưu outbox?
2. Text gõ khi offline được gửi lên server lúc kết nối lại bằng cách nào? Có cần outbox cho text không? (Nhớ lại bài 3.)
3. Hai tab cùng gửi một intent đã lưu thì sao? Điều gì bảo vệ dữ liệu (R8)?

## Xong rồi thì

```bash
pnpm lint && pnpm format && pnpm --filter @kanban/client test && pnpm --filter @kanban/server test
git add -A && git commit -m "Lesson 7: offline"
git push -u origin learn/07-offline
git diff solution -- packages/client/src/localStore.ts packages/client/src/BoardClient.ts
```

Nhắn mình kèm câu trả lời để mình review.
