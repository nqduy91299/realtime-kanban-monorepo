# Bài 2: Sắp xếp mà không phải đánh số lại

> Branch `learn/02-ordering`. Lời giải: tag `solution` (đừng mở trước khi làm xong).

## Vì sao bài này quan trọng

Nếu lưu vị trí card bằng số thứ tự (0, 1, 2, …), mỗi lần chèn card vào giữa thì phải **đánh số lại mọi card phía sau**. Hai người kéo thả cùng lúc sẽ ghi đè số của nhau, và card bị trùng vị trí hoặc nhảy lung tung.

Project dùng **fractional indexing**: vị trí là một _chuỗi_ sắp xếp được, ví dụ `"a0"` < `"a0V"` < `"a1"`. Muốn chèn giữa hai card thì tạo một chuỗi nằm giữa hai chuỗi đó. Mỗi lần di chuyển **chỉ đổi đúng một card** (D5). Thư viện `fractional-indexing` đã lo phần tạo chuỗi (`keyBetween`). Việc của bạn là phần _xung quanh_ nó, và đó là chỗ dễ sai nhất.

## Đọc trước

1. `docs/TRUTH_TABLE.md`: **D5** và dòng **C8** (hai người chèn vào cùng một chỗ).
2. `packages/shared/src/order.ts`: `keyBetween`, `sortedColumnIds`, `sortedCardIds`, `cardOrderAt`, `columnOrderAt` (đều có sẵn).
3. `packages/shared/test/order.test.ts` và khối `C8` trong `test/conflicts.test.ts`.

## Việc của bạn

| Hàm             | Yêu cầu                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `byOrderThenId` | So sánh theo `order`, nếu bằng nhau thì theo `id`. Mọi máy phải ra **cùng một thứ tự**                  |
| `orderAt`       | Trả về key đặt một item vào vị trí `index` trong danh sách `ids` (đã sắp xếp, không chứa chính item đó) |

## Chạy

```bash
cd packages/shared && pnpm test:watch
```

Xong khi tất cả test của `packages/shared` xanh, rồi xoá dòng `eslint-disable` ở đầu `order.ts` và chạy `pnpm lint`.

## Gợi ý

<details><summary>Gợi ý 1: test "sorting uses byte order, not locale order" đỏ</summary>

`"B".localeCompare("a")` và `"B" < "a"` cho kết quả khác nhau. Fractional key được thiết kế để so sánh theo **mã ký tự** (byte order). Hãy dùng `<` / `>`.
</details>

<details><summary>Gợi ý 2: keyBetween ném lỗi "a >= b"</summary>

Khi hai card _trùng key_ (tình huống C8), không tồn tại chuỗi nào nằm giữa chúng. Đề xuất: bước qua cả nhóm trùng key để lấy `after` là key đầu tiên **lớn hơn hẳn** `before`. Test "steps past a tie" mô tả kết quả mong muốn.
</details>

<details><summary>Gợi ý 3: index = 0 hoặc index = độ dài danh sách</summary>

Ở đầu danh sách thì không có `before`, ở cuối thì không có `after`. `keyBetween` nhận `null` cho đầu mở.
</details>

## Thử phá code

Đổi comparator sang `a[1].order.localeCompare(b[1].order)`. Test nào đỏ? Tưởng tượng điều gì xảy ra nếu hai người dùng hai ngôn ngữ trình duyệt khác nhau.

## Tự kiểm tra

1. Vì sao cần tie-break bằng `id` khi hai key bằng nhau? Hai key bằng nhau xuất hiện trong tình huống thực tế nào?
2. Di chuyển một card bằng fractional index sinh ra mấy thay đổi? Với "đánh số lại" thì sao? Điều đó liên quan gì đến conflict khi nhiều người cùng kéo thả?
3. Key có thể dài mãi không, nếu cứ chèn liên tục vào cùng một chỗ? Bạn sẽ xử lý thế nào nếu đó là vấn đề?

## Xong rồi thì

```bash
pnpm lint && pnpm format
git add -A && git commit -m "Lesson 2: ordering"
git push -u origin learn/02-ordering
git diff solution -- packages/shared/src/order.ts
```

Nhắn mình kèm câu trả lời để mình review.
