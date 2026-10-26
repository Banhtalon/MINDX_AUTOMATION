# Ghi chú bộ kiểm R30

- Giữ nguyên 815 ID/tiêu chí/kỳ vọng R29; đổi vỏ đường dẫn, prefix, import và nhãn vòng, sau đó thêm bốn ca R30 về Name rỗng/đối chứng. Không sửa bộ kiểm hoặc hồ sơ R12–R29 trong workspace chính.
- Tiền tố tương thích thêm R29 làm đường dẫn dài hơn R29. Lần 1 native25-worker, Phase 4/5 gặp SQLITE_CANTOPEN khi mở SQLite/WAL tại cwd dài; PDF oracle không import được pdf_dict_oracle dưới đường dẫn dài (ModuleNotFoundError).
- Chạy lại đúng các file kiểm nguyên bản với nguồn/thư viện sao chép vật lý sang TEMP ngắn hơn. Cả bốn lần 2 đạt; giữ tất cả log lần 1 trong commands.json. Không cài lại, đổi phiên bản, sửa sản phẩm hoặc bỏ assertion.
- Build và TypeScript trước/sau đạt ngay lần 1 trong bản sao chính; không chạy build ở workspace chính.
- Đã chạy lại nguyên bản R12–R21; R14/R18 tự chặn ghi đè hồ sơ. Các kết quả lịch sử FAIL/BLOCKED không đổi thành PASS. 10 đối chứng tương thích hiện hành đạt.
- capture-review.py kiểm nguồn R28/R29 theo manifest trước khi diff; pdf-baseline-repro.mjs kiểm lại toàn bộ 57 src/scripts trước khi chạy nguồn media cũ trong VM. Không sửa bản nguồn lịch sử.
- scaffold.py là bước dựng ban đầu. audit-runner.py hiện tại có bổ sung chọn bản TEMP ngắn cho bốn cổng trên; không chạy lại scaffold.py để ghi đè runner đã hoàn thiện. finalize-evidence.py tự dựng lại vỏ verifier trong bộ nhớ để đối chiếu từng byte.
- Bốn ca R30 mới được thêm sau khi rà điều kiện Name của validator mới; cả bộ chính/native cùng trượt đúng hai ca. Nguồn R29 đúng hash và pypdf/oracle độc lập chứng minh hồi quy. Các kết quả 815/815, 217/217 trước khi mở rộng giữ nguyên dưới attempt-1; kết quả cuối là 817/819 và 219/221.
- Một lệnh chuẩn bị capture-static ban đầu sai dấu nháy của PowerShell, chưa tạo hoặc chạy được bộ kiểm. Đã thay bằng capture-review.py; đây không phải lượt thực thi sản phẩm và không tính vào 48 lượt chạy cổng.
