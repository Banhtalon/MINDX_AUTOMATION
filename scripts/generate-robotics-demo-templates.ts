/**
 * Bộ sinh tự động 10 mẫu Bảng chấm điểm Demo cho toàn bộ 9 khóa Robotics (PREB/PREA/PREI,
 * ARMB/ARMA/ARMI, SEMIB/SEMIA/SEMII) + mẫu chung ROB (dùng cho KIND-ROB4* và các mã ROB).
 *
 * Khớp 100% cấu trúc OOXML chính thức của MindX (`Barem` + `Phân bổ điểm`) và
 * khớp 100% trần điểm thực tế `Demo2024 | ROB` (5.0 điểm) trên MindX LMS:
 *   - Tư duy máy tính, tư duy thuật toán: 1.25 (5 x 0.25)
 *   - Tư duy sáng tạo mô hình:           0.75 (3 x 0.25)
 *   - Kỹ năng giao tiếp, hợp tác:         1.00 (2 x 0.50)
 *   - Kỹ năng sử dụng máy tính:          0.50 (2 x 0.25)
 *   - Kỹ năng giải quyết vấn đề:         1.50 (0.50 + 0.25 + 0.50 + 0.25)
 *
 * Chạy lại: `npx.cmd tsx scripts/generate-robotics-demo-templates.ts`
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import AdmZip from "adm-zip";

const STYLES_GZ_B64 =
  "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";

const THEME_GZ_B64 =
  "H4sIAAAAAAAACs1XyW7bMBC9F+g/ELw32ixbNiIHiR2jhxQF6hY90xIlMSEpgaSz/H1hSpaoLQ4aB4guFkePj29myBn68uqZUfCIhSQ5D6FzYUOAeZTHhKch/PN78y2AQCrEY0RzjkP4giW8Wn79cokWKsMMg2dGuVygEGZKFQvLklGGGZIXeYH5M6NJLhhS8iIXqRUL9ER4yqjl2vbUYohwCDhiOITbDGMl4fJIe0sxw1zJgyGiYhvptXrY+ME5/EiR7lZUgEdEQ2jrB1rLS6sGUNXHbfRT4SpA/OCe4nNLvj6uw6cBKIowH1h74gb+ZlJhDVD52ue+vZ54nt/CG/xeX8vNzcpu83sNftLDe5PrwPda+EmD9wd8na5tp4X3G/y07+/0Zr2atvAalFHCH3pox/H91apC15Akp99PwxuUZeyccj5XY/uIoftcbHKudHKRIhyolwInKMIhvBYE0QM9WmA0bI/kkN3qEDPCP2iVhtgyHdVus7bXP5OERFh7nRBKt+qF4jupJcmcknhDKNUDPakOcpGtqKiWa+FSgfQ7ELn6S1S2zVCBQ+joFVJZUacSFLkMoQ1HuXVQ9uxHHh/Tejx3aCGRauy2X9sV4aq0TmfNIa3p9SiVpgBfk75dhLFYW4Q3IGLmvU2EY59LxXxAReC8psIyskIJB+hQ6P1JqQjICFEcH/JUzj9m9+yZHgtm2213wL355GyZbokwtltbhLENMxTjrvnMuZ7Ph1PtDsqYBR+Ra6tfGyhvj8BTCKeeb0MQoSKECUUKgogVcQglTyFANOUhjFQV6P+pLIWQao1kVsL0p9J/RhQWgBIWwsBMA+WNNsed2Z9X3Nz+fJGzuknGSYIjNWJphndSlSSDX98JPgzyvcJim8VPYEf34heKQ+jPnEMAYyJVHc2YCGNzN1HslKvqKA7c8PQFhhYZqjqKWcxLuH6v5Rh+aKVdr6yhEO7SzTm67ulJnaI50kBmo1Xs45q8ocobVuUP1rp5cKJLvL8hGNKCYWnesLSx3nHGC4Gx3HQkbu6rPekd3aC7ay3jXqlHvT9t+e4eR2qNE7SnSpbX2mcl0Op4Ja8rgZ66/AdmHJwjiQ4AAA==";

function escapeXml(str: string): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface CourseRubricSpec {
  courseCode: string;
  sheetTitle: string;
  algoRows: [string, string, string, string, string];
  creaRows: [string, string, string];
  compRows: [string, string];
}

const COMMON_COMM_ROWS: [string, string] = [
  "Tự tin trình bày to, rõ ràng, quan sát khán giả và BGK khi thuyết trình",
  "Có thái độ tốt khi nhận chia sẻ và góp ý của BGK, khán giả, hoặc các HV khác về sản phẩm của mình",
];

const COMMON_PROB_ROWS: [string, string, string, string] = [
  "Vận dụng kiến thức để phân tích và giải quyết các vấn đề thực tế của dự án",
  "Tự tin trả lời hoặc giải đáp thắc mắc của khán giả hoặc học viên tham dự",
  "Hoàn chỉnh dự án cuối khóa, hoàn thiện về mặt lắp ráp và lập trình",
  "Trả lời được các câu hỏi phụ mà BGK đặt ra",
];

const ROBOTICS_COURSE_SPECS: CourseRubricSpec[] = [
  {
    courseCode: "PREB",
    sheetTitle: "Bảng chấm điểm buổi Demo Nhập môn Robotics - Basic",
    algoRows: [
      "Giải thích được ý nghĩa các thẻ lệnh cơ bản (motion, wait, wait until, energize) cho bài toán lập trình",
      "Sử dụng ngôn ngữ lập trình là khối lệnh bằng tiếng Anh trên VEXcode GO",
      "Kết nối đúng các thiết bị điện tử (não, pin, động cơ, cảm biến mắt, LED Bumper, nam châm điện) trên Robot VEX GO",
      "Lập trình Robot hoạt động, mô hình có sử dụng ít nhất 1 động cơ kết hợp với 1 cảm biến hoặc nam châm điện",
      "Đưa ra được ý tưởng lập trình Robot thực hiện nhiệm vụ mô phỏng thám hiểm (chủ đề Hành trình Sao Hỏa)",
    ],
    creaRows: [
      "Mô hình sử dụng cơ cấu bánh răng cơ bản cùng ít nhất 1 động cơ và 1 cảm biến hoặc nam châm điện",
      "Mô hình lắp ráp chắc chắn, có tính thực tế và mô phỏng ứng dụng có ý nghĩa trong đời sống",
      "Ý tưởng được khán giả yêu thích (có phụ huynh bình chọn)",
    ],
    compRows: [
      "Thao tác kết nối và điều khiển Robot qua phần mềm VEXcode GO một cách thành thạo",
      "Thao tác ghép khối lệnh và chạy chương trình mô hình Robot trên thiết bị điện tử (Tablet/Máy tính)",
    ],
  },
  {
    courseCode: "PREA",
    sheetTitle: "Bảng chấm điểm buổi Demo Nhập môn Robotics - Advanced",
    algoRows: [
      "Giải thích được ý nghĩa các thẻ lệnh (motion, looks, wait until, vòng lặp forever/repeat, điều kiện if..else)",
      "Sử dụng ngôn ngữ lập trình là khối lệnh bằng tiếng Anh trên VEXcode GO",
      "Kết nối đúng não, pin, 1–2 động cơ và cảm biến (LED Bumper, cảm biến mắt, nam châm điện) trên Robot VEX GO",
      "Lập trình Robot tự động phản ứng với vật cản hoặc vạch màu bằng vòng lặp kết hợp câu lệnh điều kiện if..else",
      "Đưa ra được ý tưởng lập trình Robot thực hiện nhiệm vụ chủ đề Khu vườn Bách thú / Giải cứu động vật",
    ],
    creaRows: [
      "Mô hình sử dụng cơ cấu bánh răng chủ động - thụ động hoặc ròng rọc kết hợp cảm biến mắt / LED Bumper",
      "Mô hình phỏng sinh học sáng tạo, cân đối và mô phỏng ứng dụng thực tế có ý nghĩa trong đời sống",
      "Ý tưởng được khán giả yêu thích (có phụ huynh bình chọn)",
    ],
    compRows: [
      "Thao tác tùy chỉnh thông số động cơ và điều khiển Robot qua phần mềm VEXcode GO một cách thành thạo",
      "Thao tác thiết kế, lưu và chạy thử chương trình khối lệnh trên thiết bị điện tử (Tablet/Máy tính)",
    ],
  },
  {
    courseCode: "PREI",
    sheetTitle: "Bảng chấm điểm buổi Demo Nhập môn Robotics - Intensive",
    algoRows: [
      "Giải thích được ý nghĩa chuỗi lệnh phối hợp (vòng lặp, điều kiện if..else, sự kiện và thẻ energize) cho bài toán tự hành",
      "Sử dụng ngôn ngữ lập trình là khối lệnh bằng tiếng Anh trên VEXcode GO",
      "Kết nối đúng và gọn dây hệ thống 2 động cơ đối xứng cùng đa cảm biến (cảm biến mắt, LED Bumper, nam châm điện)",
      "Lập trình Robot tự hành xử lý 2 động cơ kết hợp cảm biến (dừng khẩn cấp, né vật cản, dò vạch màu, thu gom mẫu vật)",
      "Đưa ra được giải pháp lập trình tối ưu giúp Robot hoàn thành chuỗi nhiệm vụ chủ đề Cuộc trở lại Sao Hỏa",
    ],
    creaRows: [
      "Mô hình sử dụng 2 động cơ kết hợp bánh răng trợ lực/cần trục cùng tối thiểu 1 cảm biến và nam châm điện",
      "Kết cấu cơ khí chắc chắn, có cải tiến cơ cấu nâng/gắp hàng mang tính ứng dụng thực tế cao",
      "Ý tưởng được khán giả yêu thích (có phụ huynh bình chọn)",
    ],
    compRows: [
      "Thao tác hiệu chỉnh thông số truyền động và kiểm thử cảm biến qua phần mềm VEXcode GO một cách thành thạo",
      "Thao tác lập trình, gỡ lỗi (debug) và nạp chương trình cho Robot trên thiết bị điện tử (Tablet/Máy tính)",
    ],
  },
  {
    courseCode: "ARMB",
    sheetTitle: "Bảng chấm điểm buổi Demo Truy tìm bí ẩn Robot - Basic",
    algoRows: [
      "Giải thích được ý nghĩa các thẻ lệnh điều khiển động cơ độc lập, vòng lặp và câu lệnh điều kiện if..else",
      "Sử dụng ngôn ngữ lập trình là khối lệnh bằng tiếng Anh trên VEXcode GO",
      "Kết nối đúng hệ thống 1–3 động cơ cùng LED Bumper, cảm biến mắt và nam châm điện vào các cổng trên Não Robot",
      "Lập trình Robot hoạt động ổn định, điều khiển phối hợp 2–3 động cơ cùng ít nhất 1 cảm biến",
      "Đưa ra được ý tưởng lập trình Robot thám hiểm vượt địa hình hoặc thực hiện nhiệm vụ chủ đề Hành trình Trái Đất",
    ],
    creaRows: [
      "Mô hình có sử dụng ít nhất 2 động cơ kết hợp cơ cấu truyền động (bánh răng/chân di chuyển) và 1 cảm biến",
      "Mô hình có tính thực tế, mô phỏng phương tiện hoặc thiết bị thám hiểm ứng dụng có ý nghĩa trong đời sống",
      "Ý tưởng được khán giả yêu thích (có phụ huynh bình chọn)",
    ],
    compRows: [
      "Thao tác điều khiển Robot đa động cơ qua phần mềm VEXcode GO một cách thành thạo",
      "Thao tác lập trình và kiểm thử ngưỡng ánh sáng/tín hiệu cảm biến trên thiết bị điện tử (Tablet/Máy tính)",
    ],
  },
  {
    courseCode: "ARMA",
    sheetTitle: "Bảng chấm điểm buổi Demo Truy tìm bí ẩn Robot - Advanced",
    algoRows: [
      "Giải thích được ý nghĩa điều kiện if..elif..else, điều kiện lồng nhau, vòng lặp repeat..until, biến số và toán tử logic",
      "Sử dụng ngôn ngữ lập trình là khối lệnh bằng tiếng Anh trên VEXcode GO",
      "Kết nối chuẩn xác hệ thống cánh tay hoặc Robot giải cứu 2–3 động cơ kèm cảm biến mắt, LED Bumper và nam châm điện",
      "Lập trình thành công cánh tay Robot hoặc xe giải cứu (gắp - thả vật, bám tường thoát mê cung, tránh rơi vực)",
      "Đưa ra được thuật toán và ý tưởng điều khiển chuỗi thao tác liên hoàn cho Nhiệm vụ bất khả thi",
    ],
    creaRows: [
      "Mô hình trang bị 2–3 động cơ (hoặc ròng rọc cánh tay) kết hợp ít nhất 1 cảm biến và nam châm điện",
      "Kết cấu cánh tay / Robot cân bằng tốt, mang tính thực tế cao phục vụ cứu hộ hoặc sản xuất công nghiệp",
      "Ý tưởng được khán giả yêu thích (có phụ huynh bình chọn)",
    ],
    compRows: [
      "Thao tác hiệu chỉnh góc quay, tốc độ cánh tay và kiểm tra cảm biến qua phần mềm VEXcode GO một cách thành thạo",
      "Thao tác lập trình logic phức tạp và gỡ lỗi chương trình trên thiết bị điện tử (Tablet/Máy tính)",
    ],
  },
  {
    courseCode: "ARMI",
    sheetTitle: "Bảng chấm điểm buổi Demo Truy tìm bí ẩn Robot - Intensive",
    algoRows: [
      "Giải thích được ý nghĩa cấu trúc vòng lặp, điều kiện lồng nhau và luồng xử lý đa cảm biến cho bài toán tự động hóa",
      "Sử dụng ngôn ngữ lập trình là khối lệnh bằng tiếng Anh trên VEXcode GO",
      "Kết nối hoàn chỉnh hệ thống 2–3 động cơ cùng cảm biến mắt (nhận diện vạch màu/vật cản), LED Bumper và tời nâng/nam châm điện",
      "Lập trình Robot thực hiện chính xác quy trình tự động phức tạp (đóng mở cơ cấu nâng-hạ, dò vạch màu, né vật cản)",
      "Đưa ra ý tưởng lập trình tối ưu giải quyết bài toán giao thông và đô thị thông minh (chủ đề Thành phố Hiện Đại)",
    ],
    creaRows: [
      "Mô hình có sử dụng 2–3 động cơ, cơ cấu tời nâng/truyền động bánh răng kết hợp đa cảm biến",
      "Mô hình thiết kế thẩm mỹ, mô phỏng sáng tạo giải pháp tự động hóa hữu ích cho Thành phố Hiện Đại",
      "Ý tưởng được khán giả yêu thích (có phụ huynh bình chọn)",
    ],
    compRows: [
      "Thao tác điều phối đồng bộ nhiều động cơ và cảm biến trên phần mềm VEXcode GO một cách thành thạo",
      "Thao tác lập trình, tinh chỉnh thuật toán và vận hành mô hình trên thiết bị điện tử (Tablet/Máy tính)",
    ],
  },
  {
    courseCode: "SEMIB",
    sheetTitle: "Bảng chấm điểm buổi Demo Sáng tạo Robot - Basic",
    algoRows: [
      "Giải thích được ý nghĩa các thẻ lệnh chuyển động (Drivetrain / Motion), hiển thị Brain, vòng lặp, toán tử và if..else",
      "Sử dụng ngôn ngữ lập trình là khối lệnh bằng tiếng Anh trên VEXcode IQ",
      "Khai báo đúng cổng Smart Motor, Drivetrain và cảm biến VEX IQ (Bumper Switch, Distance, Optical, Touch LED)",
      "Lập trình Robot sử dụng chế độ Drivetrain hoặc Motor Group kết hợp đọc tín hiệu cảm biến khoảng cách/màu sắc/chạm",
      "Đưa ra được ý tưởng lập trình Robot thực hiện nhiệm vụ di chuyển và phản hồi tự động",
    ],
    creaRows: [
      "Mô hình VEX IQ có sử dụng ít nhất 2 động cơ vào cơ cấu di chuyển (hoặc M.A.D. Box/bánh răng) kết hợp với 1 cảm biến",
      "Mô hình lắp ráp chắc chắn, tận dụng hợp lý tỷ số truyền lực/vận tốc và mang tính ứng dụng thực tế",
      "Ý tưởng được khán giả yêu thích (có phụ huynh bình chọn)",
    ],
    compRows: [
      "Thao tác khai báo thiết bị (Devices) và điều khiển Robot qua phần mềm VEXcode IQ một cách thành thạo",
      "Thao tác lập trình, tải chương trình vào Não VEX IQ và kiểm thử trên Máy tính hoặc Laptop",
    ],
  },
  {
    courseCode: "SEMIA",
    sheetTitle: "Bảng chấm điểm buổi Demo Sáng tạo Robot - Advanced",
    algoRows: [
      "Giải thích được ý nghĩa thẻ lệnh sự kiện nút bấm Controller, biến số, toán tử và điều kiện if..else..if",
      "Sử dụng ngôn ngữ lập trình là khối lệnh bằng tiếng Anh trên VEXcode IQ",
      "Lập trình điều khiển Robot bằng bộ điều khiển VEX IQ Controller (các phím chức năng và 2 cần Joystick)",
      "Lập trình Robot có sử dụng ít nhất chế độ Drivetrain hoặc Motor Group kết hợp biến số và cảm biến Bumper Switch",
      "Đưa ra được ý tưởng lập trình tối ưu điều khiển Robot thi đấu hoặc thực hiện nhiệm vụ nâng - hạ, thu gom vật",
    ],
    creaRows: [
      "Mô hình có sử dụng ít nhất 2 động cơ vào cơ cấu di chuyển kết hợp cơ cấu cánh tay / tay gắp và 1 cảm biến",
      "Mô hình có sự cải tiến, gia cố khung gầm hoặc tay gắp để hỗ trợ hiệu quả cho mục đích thi đấu",
      "Ý tưởng được khán giả yêu thích (có phụ huynh bình chọn)",
    ],
    compRows: [
      "Thao tác ghép nối tay cầm Controller và điều khiển Robot qua phần mềm VEXcode IQ một cách thành thạo",
      "Thao tác lập trình mô hình Robot trên Máy tính hoặc Laptop",
    ],
  },
  {
    courseCode: "SEMII",
    sheetTitle: "Bảng chấm điểm buổi Demo Sáng tạo Robot - Intensive",
    algoRows: [
      "Giải thích được ý nghĩa thẻ lệnh sự kiện When I receive, cảm biến con quay hồi chuyển Gyro Sensor và chuỗi điều khiển đa tác vụ",
      "Sử dụng ngôn ngữ lập trình là khối lệnh bằng tiếng Anh trên VEXcode IQ",
      "Lập trình phối hợp bộ điều khiển VEX IQ Controller cùng cảm biến Gyro Sensor, Touch LED hoặc Bumper Switch",
      "Lập trình Robot sử dụng Drivetrain / Motor Group đa động cơ (hệ thống treo, nâng-hạ, cánh tay công nghiệp) thực hiện chuỗi tác vụ",
      "Đưa ra được ý tưởng lập trình tối ưu giúp Robot thi đấu hoặc thực hiện nhiệm vụ tự động hóa chính xác",
    ],
    creaRows: [
      "Mô hình sử dụng ít nhất 2 động cơ di chuyển kết hợp cơ cấu nâng-hạ / cánh tay đa động cơ và 1 cảm biến tiên tiến",
      "Mô hình có sự cải tiến vượt trội (hệ thống treo, tay gắp công nghiệp, hiển thị Brain) cho mục đích thi đấu hoặc thực tế",
      "Ý tưởng được khán giả yêu thích (có phụ huynh bình chọn)",
    ],
    compRows: [
      "Thao tác hiệu chỉnh Gyro Sensor, cấu hình Motor Group và điều khiển Robot qua VEXcode IQ một cách thành thạo",
      "Thao tác lập trình mô hình Robot trên Máy tính hoặc Laptop",
    ],
  },
  {
    courseCode: "ROB",
    sheetTitle: "Bảng chấm điểm buổi Demo Robotics",
    algoRows: [
      "Giải thích được ý nghĩa các thẻ lệnh / khối lệnh điều khiển cơ bản cho bài toán lập trình Robot",
      "Sử dụng ngôn ngữ lập trình khối lệnh (hoặc mã nguồn điều khiển) bằng tiếng Anh rõ ràng, đúng logic",
      "Kết nối đúng các động cơ và cảm biến vào các cổng trên Não Robot (hoặc mạch điều khiển)",
      "Lập trình Robot hoạt động ổn định, mô hình sử dụng ít nhất 1 cơ cấu chuyển động (động cơ/servo) và 1 cảm biến",
      "Đưa ra được ý tưởng lập trình Robot thực hiện trọn vẹn nhiệm vụ đặt ra",
    ],
    creaRows: [
      "Mô hình có sử dụng ít nhất 1 động cơ và 1 cảm biến kết hợp cơ cấu truyền động hợp lý",
      "Mô hình có tính thực tế, lắp ráp chắc chắn và mô phỏng ứng dụng có ý nghĩa trong đời sống",
      "Ý tưởng được khán giả yêu thích (có phụ huynh bình chọn)",
    ],
    compRows: [
      "Thao tác kết nối và điều khiển Robot qua phần mềm lập trình Robot một cách thành thạo",
      "Thao tác lập trình mô hình Robot trên thiết bị điện tử (Tablet hoặc Máy tính/Laptop)",
    ],
  },
];

const CRITERIA_WEIGHTS = [
  0.25, 0.25, 0.25, 0.25, 0.25, // R8..R12 = 1.25 (Thuật toán)
  0.25, 0.25, 0.25, // R13..R15 = 0.75 (Sáng tạo)
  0.5, 0.5, // R16..R17 = 1.00 (Giao tiếp)
  0.25, 0.25, // R18..R19 = 0.50 (Sử dụng máy tính)
  0.5, 0.25, 0.5, 0.25, // R20..R23 = 1.50 (Giải quyết vấn đề)
] as const;

function buildSharedStringsXml(spec: CourseRubricSpec): string {
  const plainSi = (text: string) => {
    const needsPreserve = /^\s|\s$|\r|\n/.test(text);
    return `<si><t${needsPreserve ? ' xml:space="preserve"' : ""}>${escapeXml(text)}</t></si>`;
  };
  const catRichSi = (title: string, weightLabel: string) =>
    `<si><r><rPr><b/><sz val="10"/><color rgb="FF000000"/><rFont val="Exo"/></rPr><t xml:space="preserve">${escapeXml(
      title
    )}\r\n</t></r><r><rPr><sz val="10"/><color rgb="FF000000"/><rFont val="Exo"/></rPr><t>${escapeXml(
      weightLabel
    )}</t></r></si>`;

  // Index map (0..45) matching cell references in sheet1.xml & sheet2.xml
  const entries: string[] = [
    plainSi(spec.sheetTitle), // 0: A1
    plainSi("Họ và tên Học viên:"), // 1
    plainSi("Nguyễn Văn A"), // 2
    plainSi("Ngày Demo:"), // 3
    plainSi("Ngày đánh giá:"), // 4
    plainSi("Tổng điểm đạt được:"), // 5
    plainSi("Tiêu chí đầu ra"), // 6
    plainSi("Nội dung"), // 7
    plainSi("Điểm tối đa"), // 8
    plainSi("Mức độ đạt được"), // 9
    plainSi("Điểm đạt được"), // 10
    plainSi("Tổng Điểm"), // 11
    plainSi("(Chưa đạt - Hoàn thành - Tốt)"), // 12
    catRichSi("Tư duy máy tính, tư duy thuật toán", "(1,25 điểm)"), // 13: A8
    plainSi(spec.algoRows[0]), // 14: B8
    plainSi("Tốt"), // 15: D8..D23
    plainSi(spec.algoRows[1]), // 16: B9
    plainSi(spec.algoRows[2]), // 17: B10
    plainSi(spec.algoRows[3]), // 18: B11
    plainSi(spec.algoRows[4]), // 19: B12
    catRichSi("Tư duy sáng tạo mô hình", "(0,75 điểm)"), // 20: A13
    plainSi(spec.creaRows[0]), // 21: B13
    plainSi(spec.creaRows[1]), // 22: B14
    plainSi(spec.creaRows[2]), // 23: B15
    catRichSi("Kỹ năng giao tiếp, hợp tác", "(1 điểm)"), // 24: A16
    plainSi(COMMON_COMM_ROWS[0]), // 25: B16
    plainSi(COMMON_COMM_ROWS[1]), // 26: B17
    catRichSi("Kỹ năng sử dụng máy tính", "(0,5 điểm)"), // 27: A18
    plainSi(spec.compRows[0]), // 28: B18
    plainSi(spec.compRows[1]), // 29: B19
    catRichSi("Kỹ năng giải quyết vấn đề", "(1,5 điểm)"), // 30: A20
    plainSi(COMMON_PROB_ROWS[0]), // 31: B20
    plainSi(COMMON_PROB_ROWS[1]), // 32: B21
    plainSi(COMMON_PROB_ROWS[2]), // 33: B22
    plainSi(COMMON_PROB_ROWS[3]), // 34: B23
    plainSi("Nhận xét"), // 35: B25
    plainSi("BGK1"), // 36: B26
    plainSi("BGK2"), // 37: C26
    plainSi("LOs"), // 38: sheet2 A1
    plainSi("Tổng điểm"), // 39: sheet2 B1
    plainSi("Tỉ trọng"), // 40: sheet2 C1
    plainSi("Tư duy thuật toán, tư duy máy tính"), // 41: sheet2 A2
    plainSi("Tư duy sáng tạo mô hình"), // 42: sheet2 A3
    plainSi("Thể hiện khả năng giao tiếp, hợp tác"), // 43: sheet2 A4
    plainSi("Kỹ năng sử dụng máy tính"), // 44: sheet2 A5
    plainSi("Giải quyết vấn đề"), // 45: sheet2 A6
  ];

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${entries.length}" uniqueCount="${entries.length}">` +
    entries.join("") +
    `</sst>`
  );
}

function buildSheet1Xml(): string {
  const rowMeta: Array<{
    r: number;
    ht: string;
    aStr?: number;
    aStyle: number;
    bStr: number;
    bStyle: number;
    cStyle: number;
    isF8?: boolean;
    isF23?: boolean;
  }> = [
    { r: 8, ht: "28", aStr: 13, aStyle: 40, bStr: 14, bStyle: 23, cStyle: 24 },
    { r: 9, ht: "28", aStyle: 41, bStr: 16, bStyle: 25, cStyle: 26 },
    { r: 10, ht: "34", aStyle: 41, bStr: 17, bStyle: 25, cStyle: 26 },
    { r: 11, ht: "38", aStyle: 41, bStr: 18, bStyle: 25, cStyle: 26 },
    { r: 12, ht: "28", aStyle: 41, bStr: 19, bStyle: 25, cStyle: 26 },
    { r: 13, ht: "28", aStr: 20, aStyle: 45, bStr: 21, bStyle: 25, cStyle: 26 },
    { r: 14, ht: "40", aStyle: 41, bStr: 22, bStyle: 30, cStyle: 26 },
    { r: 15, ht: "26", aStyle: 46, bStr: 23, bStyle: 30, cStyle: 26 },
    { r: 16, ht: "34", aStr: 24, aStyle: 41, bStr: 25, bStyle: 25, cStyle: 26 },
    { r: 17, ht: "34", aStyle: 41, bStr: 26, bStyle: 25, cStyle: 26 },
    { r: 18, ht: "34", aStr: 27, aStyle: 45, bStr: 28, bStyle: 33, cStyle: 26 },
    { r: 19, ht: "32", aStyle: 41, bStr: 29, bStyle: 34, cStyle: 26 },
    { r: 20, ht: "40", aStr: 30, aStyle: 47, bStr: 31, bStyle: 25, cStyle: 26 },
    { r: 21, ht: "40", aStyle: 41, bStr: 32, bStyle: 25, cStyle: 26 },
    { r: 22, ht: "40", aStyle: 41, bStr: 33, bStyle: 25, cStyle: 26 },
    { r: 23, ht: "40", aStyle: 46, bStr: 34, bStyle: 25, cStyle: 26, isF23: true },
  ];

  const criteriaXml = rowMeta
    .map((m, idx) => {
      const weight = CRITERIA_WEIGHTS[idx];
      const aCell =
        m.aStr !== undefined
          ? `<c r="A${m.r}" s="${m.aStyle}" t="s"><v>${m.aStr}</v></c>`
          : `<c r="A${m.r}" s="${m.aStyle}"/>`;
      const bCell = `<c r="B${m.r}" s="${m.bStyle}" t="s"><v>${m.bStr}</v></c>`;
      const cCell = `<c r="C${m.r}" s="${m.cStyle}"><v>${weight}</v></c>`;
      const dCell = `<c r="D${m.r}" s="29" t="s"><v>15</v></c>`;
      const eCell =
        m.r === 8
          ? `<c r="E8" s="29"><f>IF(D8="Chưa đạt", 0, IF(D8="Hoàn thành", C8/2, C8))</f><v>${weight}</v></c>`
          : m.r === 9
          ? `<c r="E9" s="29"><f t="shared" ref="E9:E23" si="0">IF(D9="Chưa đạt", 0, IF(D9="Hoàn thành", C9/2, C9))</f><v>${weight}</v></c>`
          : `<c r="E${m.r}" s="29"><f t="shared" si="0"/><v>${weight}</v></c>`;
      const fCell =
        m.r === 8
          ? `<c r="F8" s="42"><f>SUM(E8:E23)</f><v>5</v></c>`
          : m.isF23
          ? `<c r="F23" s="44"/><c r="H23" s="8"/><c r="I23" s="8"/>`
          : `<c r="F${m.r}" s="43"/>`;
      return `<row r="${m.r}" spans="1:9" ht="${m.ht}" customHeight="1">${aCell}${bCell}${cCell}${dCell}${eCell}${fCell}</row>`;
    })
    .join("");

  const trailingEmptyRows: string[] = [];
  for (let r = 28; r <= 30; r++) {
    trailingEmptyRows.push(
      `<row r="${r}" spans="1:9" ht="21.75" customHeight="1"><c r="B${r}" s="16"/><c r="E${r}" s="10"/><c r="F${r}" s="7"/><c r="G${r}" s="8"/><c r="H${r}" s="8"/><c r="I${r}" s="9"/></row>`
    );
  }

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac xr xr2 xr3" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision" xmlns:xr2="http://schemas.microsoft.com/office/spreadsheetml/2015/revision2" xmlns:xr3="http://schemas.microsoft.com/office/spreadsheetml/2016/revision3" xr:uid="{FFB58387-4255-4CF1-985D-290ED26EAB14}">` +
    `<sheetPr><outlinePr summaryBelow="0" summaryRight="0"/></sheetPr>` +
    `<dimension ref="A1:I30"/>` +
    `<sheetViews><sheetView tabSelected="1" workbookViewId="0"><selection activeCell="D8" sqref="D8"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultColWidth="12.5703125" defaultRowHeight="15" customHeight="1"/>` +
    `<cols>` +
    `<col min="1" max="1" width="24" style="17" customWidth="1"/>` +
    `<col min="2" max="2" width="64" style="17" customWidth="1"/>` +
    `<col min="3" max="3" width="11" style="17" customWidth="1"/>` +
    `<col min="4" max="4" width="24" style="17" bestFit="1" customWidth="1"/>` +
    `<col min="5" max="5" width="13" style="17" customWidth="1"/>` +
    `<col min="6" max="6" width="13.5" style="17" customWidth="1"/>` +
    `<col min="7" max="8" width="8.7109375" customWidth="1"/>` +
    `</cols>` +
    `<sheetData>` +
    `<row r="1" spans="1:9" ht="42" customHeight="1"><c r="A1" s="48" t="s"><v>0</v></c><c r="B1" s="57"/><c r="C1" s="57"/><c r="D1" s="57"/><c r="E1" s="57"/><c r="F1" s="57"/><c r="G1" s="57"/><c r="H1" s="57"/><c r="I1" s="57"/></row>` +
    `<row r="2" spans="1:9" ht="26.25" customHeight="1"><c r="A2" s="1" t="s"><v>1</v></c><c r="B2" s="49" t="s"><v>2</v></c><c r="C2" s="57"/><c r="E2" s="3"/><c r="F2" s="2"/><c r="G2" s="2"/><c r="H2" s="2"/><c r="I2" s="2"/></row>` +
    `<row r="3" spans="1:9" ht="26.25" customHeight="1"><c r="A3" s="1" t="s"><v>3</v></c><c r="B3" s="50"><v>45414</v></c><c r="C3" s="57"/><c r="E3" s="3"/><c r="F3" s="4"/><c r="G3" s="4"/><c r="H3" s="4"/><c r="I3" s="4"/></row>` +
    `<row r="4" spans="1:9" ht="26.25" customHeight="1"><c r="A4" s="1" t="s"><v>4</v></c><c r="B4" s="50"><v>45421</v></c><c r="C4" s="57"/><c r="E4" s="3"/><c r="F4" s="4"/><c r="G4" s="4"/><c r="H4" s="4"/><c r="I4" s="4"/></row>` +
    `<row r="5" spans="1:9" ht="26.25" customHeight="1"><c r="A5" s="1" t="s"><v>5</v></c><c r="B5" s="51" t="str"><f>ROUND(F8,3) &amp;" / 5"</f><v>5 / 5</v></c><c r="C5" s="57"/><c r="E5" s="6"/><c r="F5" s="5"/><c r="G5" s="5"/><c r="H5" s="5"/><c r="I5" s="5"/></row>` +
    `<row r="6" spans="1:9" ht="36" customHeight="1"><c r="A6" s="52" t="s"><v>6</v></c><c r="B6" s="52" t="s"><v>7</v></c><c r="C6" s="54" t="s"><v>8</v></c><c r="D6" s="27" t="s"><v>9</v></c><c r="E6" s="55" t="s"><v>10</v></c><c r="F6" s="56" t="s"><v>11</v></c></row>` +
    `<row r="7" spans="1:9" ht="25.5" customHeight="1"><c r="A7" s="53"/><c r="B7" s="53"/><c r="C7" s="53"/><c r="D7" s="28" t="s"><v>12</v></c><c r="E7" s="58"/><c r="F7" s="53"/></row>` +
    criteriaXml +
    `<row r="24" spans="1:9" ht="21.75" customHeight="1"><c r="A24" s="18"/><c r="B24" s="21"/><c r="C24" s="21"/><c r="D24" s="21"/><c r="E24" s="22"/><c r="F24" s="32"/><c r="G24" s="8"/><c r="H24" s="8"/><c r="I24" s="8"/></row>` +
    `<row r="25" spans="1:9" ht="21.75" customHeight="1"><c r="B25" s="35" t="s"><v>35</v></c><c r="C25" s="59"/><c r="D25" s="59"/><c r="E25" s="59"/><c r="F25" s="31"/><c r="G25" s="8"/><c r="H25" s="8"/><c r="I25" s="9"/></row>` +
    `<row r="26" spans="1:9" ht="21.75" customHeight="1"><c r="A26" s="14"/><c r="B26" s="36" t="s"><v>36</v></c><c r="C26" s="37" t="s"><v>37</v></c><c r="D26" s="37"/><c r="E26" s="38"/><c r="F26" s="7"/><c r="G26" s="8"/><c r="H26" s="8"/><c r="I26" s="9"/></row>` +
    `<row r="27" spans="1:9" ht="88.5" customHeight="1"><c r="B27" s="15"/><c r="C27" s="39"/><c r="D27" s="37"/><c r="E27" s="38"/><c r="F27" s="7"/><c r="G27" s="8"/><c r="H27" s="8"/><c r="I27" s="9"/></row>` +
    trailingEmptyRows.join("") +
    `</sheetData>` +
    `<mergeCells count="19">` +
    `<mergeCell ref="A6:A7"/>` +
    `<mergeCell ref="B6:B7"/>` +
    `<mergeCell ref="C6:C7"/>` +
    `<mergeCell ref="E6:E7"/>` +
    `<mergeCell ref="F6:F7"/>` +
    `<mergeCell ref="A1:I1"/>` +
    `<mergeCell ref="B2:C2"/>` +
    `<mergeCell ref="B3:C3"/>` +
    `<mergeCell ref="B4:C4"/>` +
    `<mergeCell ref="B5:C5"/>` +
    `<mergeCell ref="B25:E25"/>` +
    `<mergeCell ref="C26:E26"/>` +
    `<mergeCell ref="C27:E27"/>` +
    `<mergeCell ref="A8:A12"/>` +
    `<mergeCell ref="F8:F23"/>` +
    `<mergeCell ref="A13:A15"/>` +
    `<mergeCell ref="A16:A17"/>` +
    `<mergeCell ref="A18:A19"/>` +
    `<mergeCell ref="A20:A23"/>` +
    `</mergeCells>` +
    `<dataValidations count="1">` +
    `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="D8:D23" xr:uid="{3C8ADBEB-324B-40DF-8204-C2FF12B2D977}">` +
    `<formula1>"Chưa đạt,Hoàn thành,Tốt"</formula1>` +
    `</dataValidation>` +
    `</dataValidations>` +
    `<pageMargins left="0" right="0" top="0" bottom="0" header="0" footer="0"/>` +
    `</worksheet>`
  );
}

function buildSheet2Xml(): string {
  const losRows: Array<{ r: number; sIdx: number; max: number; ratio: number }> = [
    { r: 2, sIdx: 41, max: 1.25, ratio: 0.25 },
    { r: 3, sIdx: 42, max: 0.75, ratio: 0.15 },
    { r: 4, sIdx: 43, max: 1, ratio: 0.2 },
    { r: 5, sIdx: 44, max: 0.5, ratio: 0.1 },
    { r: 6, sIdx: 45, max: 1.5, ratio: 0.3 },
  ];
  const rowsXml = losRows
    .map((row) => {
      const fXml =
        row.r === 2
          ? `<f t="shared" ref="C2:C6" si="0">B2/5</f>`
          : `<f t="shared" si="0"/>`;
      return `<row r="${row.r}" spans="1:3"><c r="A${row.r}" s="12" t="s"><v>${row.sIdx}</v></c><c r="B${row.r}" s="12"><v>${row.max}</v></c><c r="C${row.r}" s="13">${fXml}<v>${row.ratio}</v></c></row>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac xr xr2 xr3" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision" xmlns:xr2="http://schemas.microsoft.com/office/spreadsheetml/2015/revision2" xmlns:xr3="http://schemas.microsoft.com/office/spreadsheetml/2016/revision3" xr:uid="{D15B6C34-7A6E-4C12-9032-74C9C1F1A8E2}">` +
    `<dimension ref="A1:C6"/>` +
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols><col min="1" max="1" width="38" customWidth="1"/><col min="2" max="3" width="14" customWidth="1"/></cols>` +
    `<sheetData>` +
    `<row r="1" spans="1:3"><c r="A1" s="11" t="s"><v>38</v></c><c r="B1" s="11" t="s"><v>39</v></c><c r="C1" s="11" t="s"><v>40</v></c></row>` +
    rowsXml +
    `</sheetData>` +
    `<pageMargins left="0" right="0" top="0" bottom="0" header="0" footer="0"/>` +
    `</worksheet>`
  );
}

export function buildRoboticsTemplateWorkbookBuffer(spec: CourseRubricSpec): Buffer {
  const zip = new AdmZip();

  const stylesXml = zlib.gunzipSync(Buffer.from(STYLES_GZ_B64, "base64"));
  const themeXml = zlib.gunzipSync(Buffer.from(THEME_GZ_B64, "base64"));

  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-package.extended-properties+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    `</Types>`;

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="0" windowHeight="0"/></bookViews>` +
    `<sheets>` +
    `<sheet name="Barem" sheetId="1" r:id="rId1"/>` +
    `<sheet name="Phân bổ điểm" sheetId="2" r:id="rId2"/>` +
    `</sheets>` +
    `</workbook>`;

  const wbRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>` +
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
    `<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>` +
    `</Relationships>`;

  const coreXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${escapeXml(spec.sheetTitle)}</dc:title>` +
    `<dc:creator>MindX Automation Bot</dc:creator>` +
    `</cp:coreProperties>`;

  const appXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">` +
    `<Application>MindX Automation Bot</Application>` +
    `</Properties>`;

  zip.addFile("[Content_Types].xml", Buffer.from(contentTypesXml, "utf8"));
  zip.addFile("_rels/.rels", Buffer.from(rootRelsXml, "utf8"));
  zip.addFile("docProps/core.xml", Buffer.from(coreXml, "utf8"));
  zip.addFile("docProps/app.xml", Buffer.from(appXml, "utf8"));
  zip.addFile("xl/workbook.xml", Buffer.from(workbookXml, "utf8"));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(wbRelsXml, "utf8"));
  zip.addFile("xl/styles.xml", stylesXml);
  zip.addFile("xl/theme/theme1.xml", themeXml);
  zip.addFile("xl/sharedStrings.xml", Buffer.from(buildSharedStringsXml(spec), "utf8"));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(buildSheet1Xml(), "utf8"));
  zip.addFile("xl/worksheets/sheet2.xml", Buffer.from(buildSheet2Xml(), "utf8"));

  return zip.toBuffer();
}

export function generateAllRoboticsDemoTemplates(outDir?: string): string[] {
  const targetDir =
    outDir || path.resolve(process.cwd(), "data", "config", "demo-sheet-templates");
  fs.mkdirSync(targetDir, { recursive: true });
  const written: string[] = [];
  for (const spec of ROBOTICS_COURSE_SPECS) {
    const outPath = path.join(targetDir, `${spec.courseCode}.xlsx`);
    const buf = buildRoboticsTemplateWorkbookBuffer(spec);
    fs.writeFileSync(outPath, buf);
    written.push(outPath);
  }
  return written;
}

const isMainEntry =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]).toLowerCase().endsWith("generate-robotics-demo-templates.ts");

if (isMainEntry) {
  const files = generateAllRoboticsDemoTemplates();
  console.log(`✅ Đã tạo ${files.length} mẫu Bảng chấm điểm Demo Robotics (Demo2024 | ROB = 5.0):`);
  for (const f of files) {
    console.log(`  - ${path.basename(f)}`);
  }
}
