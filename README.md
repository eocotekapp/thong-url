# TeleBox webapp

Webapp Node.js để:

- upload video lên TeleBox bằng token tài khoản
- tạo item file trên TeleBox
- tạo share link
- cố tự resolve ra:
  - view URL
  - download/direct URL có đuôi file nếu TeleBox sinh được

## Chạy

```bash
npm install
npm start
```

Mở trình duyệt tại:

```bash
http://localhost:3000
```

## Chức năng

### 1. Upload video
- chọn file video
- nhập tên folder nếu muốn
- chọn thời hạn share link
- app sẽ upload rồi tự thử bóc ra `viewUrl` và `downloadUrl`

### 2. Resolve link có sẵn
- dán link `/s/...` hoặc `/f-detail/...`
- app sẽ truy cập trang và quét các URL ứng viên trong HTML
- nếu thấy URL video/direct thì trả về luôn

## Lưu ý

- Direct URL của TeleBox thường là link ký tạm thời, có thể chứa `token`, `ts`, `ip`, `filename`.
- Vì vậy link direct thường không phải vĩnh viễn.
- Nếu TeleBox đổi HTML hoặc JS phía trang share, logic regex có thể cần chỉnh lại.
