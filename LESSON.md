# Bài 4: Gắn một ô `<input>` vào text dùng chung

> Branch `learn/04-text-binding`. Lời giải: tag `solution` (đừng mở trước khi làm xong).

## Vì sao bài này quan trọng

Yjs giữ text dùng chung, còn trình duyệt có ô `<input>` của nó. Nối hai thứ này lại có hai cái khó mà phỏng vấn hay hỏi:

1. **Sự kiện `input` chỉ cho biết giá trị mới**, không nói người dùng vừa gõ gì ở đâu. Phải tự suy ra _thay đổi nhỏ nhất_ (`diffText`) để gửi vào Y.Text. Nếu xoá hết rồi chèn lại cả chuỗi, mọi thao tác của người khác cùng lúc đó sẽ bị mất.
2. **Khi người khác sửa text, con trỏ của bạn không được nhảy.** Nếu họ chèn chữ _trước_ con trỏ, con trỏ phải dịch sang phải đúng chừng ấy ký tự (`transformIndex`). Đây chính là ý tưởng cốt lõi của OT (Operational Transformation), ở dạng nhỏ nhất.

`CollaborativeInput.tsx` (đã có sẵn) dùng 3 hàm bạn sắp viết. Chúng là hàm thuần nên test chạy rất nhanh.

## Đọc trước

1. `apps/web/src/CollaborativeInput.tsx`: xem 3 hàm được dùng ở đâu. Chú ý phần IME: tiếng Việt kiểu Telex!
2. `packages/client/src/textBinding.ts`: chú thích của từng hàm chính là đề bài.
3. `packages/client/test/textBinding.test.ts`: các ví dụ, và **2 property test**:
   - `diffText`: áp dụng edit lên `before` phải ra đúng `after`, với _mọi_ chuỗi;
   - `transformIndex`: phải cho cùng kết quả với chính Yjs (relative position).

## Việc của bạn

| Hàm                            | Đầu vào → đầu ra                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| `diffText(before, after)`      | `{ index, deleteCount, insert }`, hoặc `null` nếu không đổi                                         |
| `transformIndex(index, delta)` | vị trí con trỏ sau một thay đổi từ xa. `delta` có dạng `[{retain: 3}, {insert: "ab"}, {delete: 1}]` |
| `changeEnd(delta)`             | vị trí con trỏ sau khi undo/redo: ngay sau đoạn vừa chèn, hoặc tại chỗ vừa xoá                      |

## Chạy

```bash
pnpm --filter @kanban/client exec vitest --watch textBinding
```

Xong khi `textBinding.test.ts` xanh hết. Sau đó xoá 2 dòng `eslint-disable` ở đầu file và chạy `pnpm lint`.

## Gợi ý

<details><summary>Gợi ý 1: diffText với "aaa" → "aaaa"</summary>

Tìm phần đầu chung dài nhất (prefix), rồi phần cuối chung dài nhất (suffix). Cẩn thận: prefix và suffix **không được chồng lên nhau**. Với "aaa" → "aaaa", nếu không giới hạn, cả hai đều có thể "ăn" hết chuỗi.
</details>

<details><summary>Gợi ý 2: delta đọc thế nào?</summary>

Duyệt `delta` từ trái sang phải, kèm `pos` là vị trí trong **text cũ**:

- `retain: n`: bỏ qua n ký tự (`pos += n`).
- `insert`: chèn thêm, `pos` không đổi.
- `delete: n`: xoá n ký tự kể từ `pos`.

Dừng khi đã đi qua con trỏ.
</details>

<details><summary>Gợi ý 3: chèn đúng tại vị trí con trỏ thì sao?</summary>

Property test so với Yjs, và Yjs "dính" con trỏ vào ký tự **phía sau** nó, nên chữ chèn đúng tại con trỏ sẽ đẩy con trỏ sang phải. Test "insert exactly at cursor" mô tả đúng điều này.
</details>

<details><summary>Gợi ý 4: xoá một đoạn chứa luôn con trỏ</summary>

Con trỏ rơi về điểm bắt đầu của đoạn bị xoá: chỉ trừ đi phần bị xoá _trước_ con trỏ, không trừ cả đoạn.
</details>

## Thử phá code

Trong `CollaborativeInput.tsx`, tạm thay `transformIndex(selectionStart, delta)` bằng `input.value.length`. Mở 2 tab (`pnpm dev`) rồi gõ cùng một tiêu đề ở cả hai: con trỏ sẽ nhảy về cuối mỗi khi tab kia gõ. Đó chính là bug mà hàm của bạn ngăn chặn.

## Tự kiểm tra

1. Vì sao `diffText` chỉ trả về **một** edit? Một sự kiện `input` có khi nào chứa hai chỗ sửa tách rời không?
2. Gõ tiếng Việt bằng Telex ("aa" → "â") thì `diffText` nhận được gì? Vì sao `CollaborativeInput` phải chờ `compositionend`?
3. `transformIndex` có cần biết _ai_ đã sửa text không? Vì sao?

## Xong rồi thì

```bash
pnpm lint && pnpm format && pnpm --filter @kanban/client test
git add -A && git commit -m "Lesson 4: text binding"
git push -u origin learn/04-text-binding
git diff solution -- packages/client/src/textBinding.ts
```

Nhắn mình kèm câu trả lời để mình review.
