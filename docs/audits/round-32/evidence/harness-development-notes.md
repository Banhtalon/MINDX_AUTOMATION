# Nhật ký bộ kiểm và môi trường R32

- Chỉ tạo/sửa hồ sơ mới trong R32; không thay nguồn sản phẩm để chạy kiểm.
- Lần sao chép đầu gặp thư mục `public` không tồn tại (robocopy 16). Dừng bước chuẩn bị; lần tiếp bỏ thư mục không tồn tại, sao chép vật lý đầy đủ các thư mục cần thiết. Không có sản phẩm được chạy ở bước này.
- 11 lượt khởi chạy cổng đầu bị lỗi preload `MODULE_NOT_FOUND`: dấu `\` trong NODE_OPTIONS bị Node xử lý thành escape. Node dừng trước khi nạp sản phẩm. Sửa đường dẫn rào kiểm toán dùng `/`, không sửa sản phẩm hoặc nới rào mạng. Toàn bộ log attempt-1 được giữ; receipt có `classification=HARNESS_PRELOAD_ERROR`, `productEvaluated=false`.
- Bốn JSON được bộ điều phối sao chép ở các lượt preload lỗi là kết quả lịch sử có sẵn trong snapshot, không phải lần chạy mới. Receipt được gắn `freshResults=false`; tuyệt đối không dùng chúng để kết luận. Từ lượt tiếp theo, chỉ nhận JSON có thời gian sửa sau lúc bắt đầu lệnh (`freshResults=true`).
- Sau sửa preload, toàn bộ 11 cổng được chạy lại. Mã thoát, thời gian, log và SHA-256 nằm trong commands.json. Không dùng mã thoát 0 của bộ điều phối thay mã thoát của cổng con.
- R16 nguyên bản có 15/16 ca đạt, trượt PHASE1-SCHEMA do kỳ vọng 7 bảng; nguồn hiện tại có 8 bảng. Giữ nguyên FAIL. Ca R32-REG-SCHEMA kiểm đủ tên 8 bảng, học viên đúng lớp và cấm đổi chủ bài nộp.
- Lượt R32 độc lập đầu có 65 ca, 33 đạt/32 trượt. Một ca trượt là lỗi tên trong đối chứng của kiểm toán viên (`score_matrix` thay vì `score_matrix_cache`), không phải lỗi sản phẩm. Đã sửa ca đối chứng, thêm kiểm khóa ở phần R16 bị bỏ dở, thêm 2 ca card 03/URL chứa nhau và bằng chứng thứ tự sửa DB trước Save. Không đổi kỳ vọng của ca lỗi sản phẩm.
- Lượt độc lập thứ hai: 67 ca, 34 đạt/33 trượt. Lượt ba chỉ bổ sung dấu SHA-256 chính bộ kiểm vào JSON để gắn kết quả với file bàn giao cuối; kết quả giữ nguyên 34/67. Kết luận dùng **attempt-3** và `phase6-results.json`; giữ đủ các lượt trước để đối chiếu.
- Các fixture đều giả. Junction dùng kiểm allowlist chỉ tạo trong TEMP; khi sao chép bằng chứng về R32 chính, bỏ qua junction và không đọc mục tiêu qua chúng. Tham khảo fixture-copy.json.
- Không chạy lại các oracle PDF/GraphQL hay toàn bộ chuỗi R22..R30; không lấy số PASS cũ của chúng làm kết quả R32. Bộ R31 chính chạy nguyên byte và đạt mới 819/819.
