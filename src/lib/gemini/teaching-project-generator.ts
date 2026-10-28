import { GoogleGenerativeAI, SchemaType, type Schema } from "@google/generative-ai";
import { config } from "../config";
import { getCoursesSyllabus, type CourseSyllabus } from "../db/json-config";
import {
  getDb,
  normalizeAssignedStudentIds,
  normalizeDateToIsoYmd,
  teachingProjectRepo,
  type TeachingProjectTaskItem,
  type TeachingStudentItem,
} from "../db/sqlite";

export type TeachingCourseTrack =
  | "GAMEMAKER"
  | "SCRATCH"
  | "PYTHON_APP"
  | "WEB"
  | "COMPUTER_SCIENCE"
  | "ROBOTICS"
  | "GENERAL";

export interface RawTaskTemplateItem {
  taskName: string;
  description: string;
  weightPercent: number;
}

const STANDARD_FIVE_TASKS_BY_TRACK: Record<TeachingCourseTrack, RawTaskTemplateItem[]> = {
  GAMEMAKER: [
    {
      taskName: "1. Lên ý tưởng & chuẩn bị tài nguyên game",
      description:
        "- Xác định thể loại game, cốt truyện, nhân vật chính và mục tiêu thắng/thua.\n- Tìm kiếm và chuẩn bị đầy đủ tài nguyên: hình ảnh nhân vật (Sprite), phông nền (Background/Tileset) và âm thanh.\n- Khởi tạo dự án trên GameMaker và thiết lập cấu trúc thư mục.",
      weightPercent: 20,
    },
    {
      taskName: "2. Thiết kế màn chơi (Room) & đối tượng (Object)",
      description:
        "- Tạo các Object cho nhân vật chính, kẻ địch, vật phẩm và tường chắn.\n- Thiết kế bố cục ít nhất 3 màn chơi (Room: Menu, Play, Win/Lose) với kích thước và khung nhìn hợp lý.\n- Sắp xếp bản đồ, chướng ngại vật và thiết lập vùng va chạm (Collision Mask).",
      weightPercent: 20,
    },
    {
      taskName: "3. Lập trình điều khiển nhân vật & gameplay chính",
      description:
        "- Lập trình di chuyển nhân vật mượt mà bằng bàn phím/chuột kèm đổi hoạt ảnh (Animation).\n- Xử lý va chạm giữa nhân vật với tường, vật phẩm và chướng ngại vật.\n- Lập trình hành vi của nhân vật phụ / kẻ địch trong màn chơi.",
      weightPercent: 20,
    },
    {
      taskName: "4. Hoàn thiện cơ chế tính điểm, UI & âm thanh",
      description:
        "- Xây dựng hệ thống Điểm số (Score), Máu/Mạng (HP/Lives) và hiển thị HUD trên màn hình.\n- Lập trình điều kiện chuyển màn, màn hình Chiến thắng (Win), Thua cuộc (Game Over) và các nút bấm điều hướng.\n- Bổ sung nhạc nền, hiệu ứng âm thanh và cân bằng độ khó của game.",
      weightPercent: 20,
    },
    {
      taskName: "5. Kiểm thử sửa lỗi, đóng gói & làm Slide thuyết trình",
      description:
        "- Chơi thử toàn bộ các màn, rà soát và sửa triệt để các lỗi kẹt nhân vật hoặc lỗi điểm số (fix bug).\n- Chụp ảnh màn hình sản phẩm, đóng gói file dự án hoàn chỉnh.\n- Soạn Slide thuyết trình giới thiệu ý tưởng, tính năng nổi bật và luyện tập trình bày Demo trước lớp.",
      weightPercent: 20,
    },
  ],
  SCRATCH: [
    {
      taskName: "1. Lên ý tưởng & thiết kế nhân vật, sân khấu",
      description:
        "- Chọn chủ đề dự án (trò chơi hoặc câu chuyện tương tác), xác định nhân vật và luật chơi.\n- Tạo hoặc tải lên các nhân vật (Sprite), trang phục (Costume) và phông nền sân khấu (Backdrop).\n- Sắp xếp vị trí xuất hiện ban đầu cho các nhân vật.",
      weightPercent: 20,
    },
    {
      taskName: "2. Lập trình chuyển động & điều khiển nhân vật chính",
      description:
        "- Sử dụng các khối lệnh sự kiện (Events), chuyển động (Motion) và vòng lặp (Loops) để điều khiển nhân vật.\n- Thiết lập hiệu ứng đổi trang phục khi di chuyển và giới hạn nhân vật trong khung sân khấu.",
      weightPercent: 20,
    },
    {
      taskName: "3. Xây dựng tương tác, va chạm & biến số điểm",
      description:
        "- Tạo biến số (Variables) quản lý Điểm số, Thời gian hoặc Mạng chơi.\n- Sử dụng khối lệnh điều kiện (If/Touching) và phát tin nhắn (Broadcast) để xử lý ăn vật phẩm, né chướng ngại vật.",
      weightPercent: 20,
    },
    {
      taskName: "4. Hoàn thiện màn hình Bắt đầu / Kết thúc & âm thanh",
      description:
        "- Tạo màn hình Start, màn hình Chiến thắng (You Win) và Kết thúc (Game Over).\n- Thêm âm thanh, hiệu ứng hình ảnh sinh động và kiểm tra độ mượt của chương trình.",
      weightPercent: 20,
    },
    {
      taskName: "5. Sửa lỗi cuối, hoàn thiện dự án & làm Slide thuyết trình",
      description:
        "- Chạy thử toàn bộ dự án, sửa các lỗi phát sinh và lưu file .sb3 hoàn chỉnh.\n- Chuẩn bị Slide thuyết trình nêu rõ ý tưởng, các khối lệnh tâm đắc và luyện tập tự tin trình bày trước lớp.",
      weightPercent: 20,
    },
  ],
  PYTHON_APP: [
    {
      taskName: "1. Lên ý tưởng & thiết kế khung giao diện (Qt Designer)",
      description:
        "- Xác định đề tài ứng dụng quản lý / tiện ích và danh sách các chức năng cốt lõi.\n- Thiết kế bố cục giao diện chính, thanh điều hướng, Stacked Widget và các hộp thoại (Dialog) trên Qt Designer.\n- Chuẩn bị bộ icon, hình ảnh đúng tỷ lệ và phối màu giao diện hài hòa.",
      weightPercent: 20,
    },
    {
      taskName: "2. Hoàn thiện chi tiết UI/QSS & kết nối giao diện vào Python",
      description:
        "- Trang trí giao diện bằng QSS (màu sắc, bo góc, hiệu ứng hover/click cho nút bấm và danh sách).\n- Viết khung chương trình Python nạp các tệp giao diện (.ui) và chuyển đổi mượt mà giữa các màn hình.",
      weightPercent: 20,
    },
    {
      taskName: "3. Lập trình Hướng đối tượng (OOP) & hiển thị dữ liệu",
      description:
        "- Định nghĩa Lớp (Class) và Đối tượng (Object) mô tả dữ liệu của ứng dụng.\n- Xây dựng cơ chế đọc/ghi dữ liệu (JSON/File) và đổ danh sách dữ liệu lên giao diện (List Widget / Table).",
      weightPercent: 20,
    },
    {
      taskName: "4. Lập trình chức năng Quản lý dữ liệu (CRUD) & tìm kiếm",
      description:
        "- Lập trình đầy đủ các chức năng Thêm mới, Xem chi tiết, Chỉnh sửa, Xóa (kèm hộp thoại xác nhận QMessageBox).\n- Bổ sung chức năng Tìm kiếm, Lọc/Sắp xếp dữ liệu và kiểm tra dữ liệu đầu vào.",
      weightPercent: 20,
    },
    {
      taskName: "5. Tối ưu UI/UX, sửa lỗi & làm Slide thuyết trình",
      description:
        "- Kiểm thử toàn bộ các nút bấm và luồng thao tác, sửa lỗi đường dẫn ảnh và lỗi ngoại lệ (fix bug).\n- Đóng gói mã nguồn ứng dụng, làm Slide thuyết trình và luyện tập Demo sản phẩm cuối khóa.",
      weightPercent: 20,
    },
  ],
  WEB: [
    {
      taskName: "1. Lên ý tưởng đề tài & xây dựng khung cấu trúc HTML",
      description:
        "- Xác định chủ đề Website, đối tượng người dùng, sơ đồ các trang và bảng màu chủ đạo.\n- Chuẩn bị hình ảnh, icon, font chữ và xây dựng cấu trúc HTML chuẩn ngữ nghĩa (Header, Navbar, Main, Section, Footer).",
      weightPercent: 20,
    },
    {
      taskName: "2. Thiết kế giao diện CSS, bố cục Flexbox/Grid & Responsive",
      description:
        "- Định dạng giao diện chuyên nghiệp bằng CSS/Flexbox/CSS Grid cho Trang chủ và các trang thành phần.\n- Tạo hiệu ứng chuyển động mượt mà (Hover, Transition) và đảm bảo hiển thị tương thích trên nhiều kích thước màn hình (Responsive).",
      weightPercent: 20,
    },
    {
      taskName: "3. Lập trình tương tác JavaScript & xử lý dữ liệu",
      description:
        "- Lập trình DOM Events xử lý các thao tác người dùng: tìm kiếm, lọc danh sách, giỏ hàng hoặc modal chi tiết.\n- Ứng dụng LocalStorage / nạp dữ liệu động từ mảng đối tượng hoặc API.",
      weightPercent: 20,
    },
    {
      taskName: "4. Hoàn thiện tính năng Đăng nhập/Form & các trang phụ",
      description:
        "- Xây dựng và kiểm tra hợp lệ (Validate) cho các biểu mẫu: Đăng nhập, Đăng ký, Liên hệ hoặc Đặt hàng.\n- Liên kết đồng bộ thanh điều hướng giữa tất cả các trang và kiểm tra lỗi hiển thị.",
      weightPercent: 20,
    },
    {
      taskName: "5. Đưa Website lên Internet, kiểm thử & làm Slide thuyết trình",
      description:
        "- Rà soát lỗi giao diện/console, tối ưu tốc độ tải ảnh và triển khai Website (GitHub Pages / Hosting).\n- Chuẩn bị Slide thuyết trình giới thiệu bố cục, tính năng kỹ thuật và luyện tập trình bày Demo.",
      weightPercent: 20,
    },
  ],
  COMPUTER_SCIENCE: [
    {
      taskName: "1. Xác định bài toán, chủ đề & thu thập bộ dữ liệu",
      description:
        "- Xác định chủ đề phân tích / bài toán thuật toán và mục tiêu cần giải quyết.\n- Đặt các câu hỏi phân tích trọng tâm và thu thập bộ dữ liệu thực tế (CSV/Excel/Dataset).",
      weightPercent: 20,
    },
    {
      taskName: "2. Làm sạch, tiền xử lý & biến đổi dữ liệu bằng Python",
      description:
        "- Kiểm tra cấu trúc dữ liệu, xử lý giá trị khuyết thiếu (missing values), dữ liệu trùng lặp và chuẩn hóa kiểu dữ liệu.\n- Tạo thêm các cột/đặc trưng mới phục vụ cho việc thống kê chuyên sâu.",
      weightPercent: 20,
    },
    {
      taskName: "3. Phân tích thống kê & trực quan hóa biểu đồ",
      description:
        "- Thực hiện lọc, nhóm (groupby), sắp xếp và tính toán các chỉ số thống kê đặc trưng.\n- Vẽ các biểu đồ trực quan (Bar, Line, Pie, Scatter, Heatmap...) thể hiện rõ xu hướng và mối tương quan dữ liệu.",
      weightPercent: 20,
    },
    {
      taskName: "4. Xây dựng thuật toán / mô hình dự đoán & đánh giá kết quả",
      description:
        "- Áp dụng thuật toán hoặc mô hình học máy / hồi quy trong chương trình để giải quyết bài toán.\n- Đánh giá độ chính xác của mô hình và rút ra các nhận định có giá trị từ dữ liệu.",
      weightPercent: 20,
    },
    {
      taskName: "5. Hoàn thiện báo cáo, câu chuyện dữ liệu & Slide thuyết trình",
      description:
        "- Trình bày mã nguồn/Notebook sạch đẹp, có chú thích rõ ràng từng bước xử lý.\n- Xây dựng câu chuyện dữ liệu (Data Storytelling), làm Slide thuyết trình và luyện tập báo cáo cuối khóa.",
      weightPercent: 20,
    },
  ],
  ROBOTICS: [
    {
      taskName: "1. Lên ý tưởng mô hình Robot & phác thảo cơ cấu cơ khí",
      description:
        "- Xác định chủ đề dự án Robotics, nhiệm vụ của Robot và nguyên lý hoạt động.\n- Lựa chọn các linh kiện cơ khí, động cơ, cảm biến cần thiết trong bộ Kit.",
      weightPercent: 20,
    },
    {
      taskName: "2. Lắp ráp khung Robot & hoàn thiện kết cấu truyền động",
      description:
        "- Lắp ráp phần khung sườn vững chắc, cân đối và lắp đặt hệ thống bánh xe / tay máy / bánh răng.\n- Kiểm tra độ chắc chắn của các chốt nối và độ mượt của cơ cấu chuyển động.",
      weightPercent: 20,
    },
    {
      taskName: "3. Đấu nối động cơ, cảm biến & lập trình điều khiển cơ bản",
      description:
        "- Kết nối dây cáp từ động cơ và cảm biến vào bộ não điều khiển (Hub/Controller) đúng cổng.\n- Lập trình các thao tác di chuyển và phản hồi cơ bản của Robot.",
      weightPercent: 20,
    },
    {
      taskName: "4. Lập trình tự hành nâng cao & chạy thử nghiệm thực tế",
      description:
        "- Kết hợp điều kiện cảm biến, vòng lặp và biến số để Robot xử lý tình huống tự động.\n- Chạy thử nghiệm nhiều lần trên sa bàn thực tế, tinh chỉnh tốc độ, góc quay và độ nhạy cảm biến.",
      weightPercent: 20,
    },
    {
      taskName: "5. Hoàn thiện mô hình, chuẩn bị Slide/Video & thuyết trình Demo",
      description:
        "- Trang trí hoàn thiện mô hình Robot, quay video / chụp ảnh quá trình hoạt động.\n- Làm Slide thuyết trình giới thiệu cấu tạo, thuật toán điều khiển và luyện tập trình bày trước lớp.",
      weightPercent: 20,
    },
  ],
  GENERAL: [
    {
      taskName: "1. Lên ý tưởng đề tài & chuẩn bị tài nguyên dự án",
      description:
        "- Xác định chủ đề sản phẩm cuối khóa, mục tiêu và danh sách các chức năng chính.\n- Tìm kiếm và chuẩn bị đầy đủ hình ảnh, dữ liệu và tài nguyên cần thiết cho dự án.",
      weightPercent: 20,
    },
    {
      taskName: "2. Thiết kế giao diện & xây dựng khung sườn sản phẩm",
      description:
        "- Khởi tạo dự án và thiết kế bố cục các màn hình / thành phần chính của sản phẩm.\n- Sắp xếp các đối tượng, hình ảnh và kiểm tra tính thẩm mỹ của giao diện.",
      weightPercent: 20,
    },
    {
      taskName: "3. Lập trình các chức năng cốt lõi của dự án",
      description:
        "- Vận dụng kiến thức đã học trong khóa để lập trình các tính năng chính và xử lý tương tác người dùng.\n- Kiểm tra hoạt động của từng chức năng ngay sau khi viết code.",
      weightPercent: 20,
    },
    {
      taskName: "4. Hoàn thiện tính năng mở rộng, hiệu ứng & kiểm thử sửa lỗi",
      description:
        "- Bổ sung các tính năng phụ, âm thanh/hiệu ứng và tối ưu trải nghiệm sử dụng.\n- Chạy thử toàn bộ sản phẩm để phát hiện và sửa triệt để các lỗi phát sinh (fix bug).",
      weightPercent: 20,
    },
    {
      taskName: "5. Đóng gói sản phẩm hoàn chỉnh & làm Slide thuyết trình",
      description:
        "- Hoàn thiện sản phẩm cuối cùng, chụp ảnh giao diện và đóng gói đầy đủ các tệp dự án.\n- Soạn Slide thuyết trình giới thiệu ý tưởng, chức năng nổi bật và luyện tập trình bày tự tin trước lớp.",
      weightPercent: 20,
    },
  ],
};

export function detectTeachingCourseTrack(
  classCode: string,
  courseName?: string
): TeachingCourseTrack {
  const code = String(classCode || "").trim().toUpperCase();
  const name = String(courseName || "").trim().toUpperCase();

  if (
    /(?:^|[-_])(ROB|ROBO|SEMI|SEMIA|SEMIB|ARMA|ARMB|PRE)/i.test(code) ||
    /ROBOTICS|ROBO/i.test(name)
  ) {
    return "ROBOTICS";
  }
  if (/(?:^|[-_])(GB|GA|GI)\d*/i.test(code) || /GAME\s*CREATOR|GAMEMAKER/i.test(name)) {
    return "GAMEMAKER";
  }
  if (/(?:^|[-_])(SB|SA|SI)\d*/i.test(code) || /SCRATCH|KITTEN/i.test(name)) {
    return "SCRATCH";
  }
  if (/(?:^|[-_])(PTB|PTA|PTI)\d*/i.test(code) || /APP\s*PRODUCER|PYQT|PYTHON\s*APP/i.test(name)) {
    return "PYTHON_APP";
  }
  if (/(?:^|[-_])(JSB|JSA|JSI)\d*/i.test(code) || /WEB\s*DEVELOPER|HTML|JAVASCRIPT/i.test(name)) {
    return "WEB";
  }
  if (/(?:^|[-_])(CSB|CSA|CSI)\d*/i.test(code) || /COMPUTER\s*SCIENTIST|DATA/i.test(name)) {
    return "COMPUTER_SCIENCE";
  }
  return "GENERAL";
}

export function findMatchedCourseSyllabus(
  classCode: string,
  courseName?: string
): CourseSyllabus | undefined {
  const all = getCoursesSyllabus();
  const upperCode = String(classCode || "").trim().toUpperCase();
  const sorted = [...all].sort((a, b) => b.courseCode.length - a.courseCode.length);

  const byCode = sorted.find((c) => upperCode.includes(c.courseCode.toUpperCase()));
  if (byCode) return byCode;

  if (courseName) {
    const upperName = courseName.trim().toUpperCase();
    const byName = sorted.find((c) => c.courseName.toUpperCase() === upperName);
    if (byName) return byName;
  }
  return undefined;
}

export function getStandardFiveTasksForClass(
  classCode: string,
  endDate?: string,
  assignedStudentIds?: number[],
  courseName?: string
): TeachingProjectTaskItem[] {
  const track = detectTeachingCourseTrack(classCode, courseName);
  const templates = STANDARD_FIVE_TASKS_BY_TRACK[track] || STANDARD_FIVE_TASKS_BY_TRACK.GENERAL;
  const deadline = normalizeDateToIsoYmd(endDate);
  const studentIds = normalizeAssignedStudentIds(assignedStudentIds || []);

  return templates.slice(0, 5).map((tpl, idx) => ({
    slotIndex: idx + 1,
    taskId: null,
    taskName: tpl.taskName,
    description: tpl.description,
    weightPercent: 20,
    deadline,
    assignedStudentIds: studentIds,
  }));
}

/**
 * Merges any existing tasks already saved on Teaching (e.g., 1 partial task on VT-C4K-GA38)
 * with the standard 5-task template so the teacher always gets a complete 5-task (100%) list,
 * preserving existing `taskId`s and filling in missing descriptions or `0000-00-00` deadlines.
 */
export function mergeExistingTeachingTasksWithStandardFive(params: {
  classCode: string;
  courseName?: string;
  endDate?: string;
  allStudentIds: number[];
  existingRemoteTasks: Array<{
    id?: number | string | null;
    task_name?: string;
    taskName?: string;
    description?: string;
    weight_percent?: number | string;
    weightPercent?: number | string;
    deadline?: string;
    assigned_students?: string | number[];
    assignedStudentIds?: number[];
  }>;
}): {
  tasks: TeachingProjectTaskItem[];
  extraRemoteTaskIds: number[];
  wasAutoCompleted: boolean;
} {
  const standardTasks = getStandardFiveTasksForClass(
    params.classCode,
    params.endDate,
    params.allStudentIds,
    params.courseName
  );
  const validEndDate = normalizeDateToIsoYmd(params.endDate);
  const defaultStudents = normalizeAssignedStudentIds(params.allStudentIds);

  const remoteList = Array.isArray(params.existingRemoteTasks)
    ? params.existingRemoteTasks
    : [];

  if (remoteList.length === 0) {
    return {
      tasks: standardTasks,
      extraRemoteTaskIds: [],
      wasAutoCompleted: true,
    };
  }

  let wasAutoCompleted = remoteList.length !== 5;
  const merged: TeachingProjectTaskItem[] = [];

  for (let i = 0; i < 5; i++) {
    const std = standardTasks[i];
    const remote = remoteList[i];
    if (!remote) {
      merged.push(std);
      wasAutoCompleted = true;
      continue;
    }

    const rawId = remote.id !== undefined && remote.id !== null ? Number(remote.id) : null;
    const taskId = rawId !== null && Number.isInteger(rawId) && rawId > 0 ? rawId : null;

    const rawName = String(remote.taskName ?? remote.task_name ?? "").trim();
    const taskName = rawName || std.taskName;
    if (!rawName) wasAutoCompleted = true;

    const rawDesc = String(remote.description ?? "").replace(/\r\n/g, "\n").trim();
    const description = rawDesc || std.description;
    if (!rawDesc) wasAutoCompleted = true;

    const rawDeadline = normalizeDateToIsoYmd(remote.deadline);
    const deadline = rawDeadline || validEndDate || std.deadline;
    if (!rawDeadline && deadline) wasAutoCompleted = true;

    const parsedAssigned = normalizeAssignedStudentIds(
      remote.assignedStudentIds ?? remote.assigned_students
    );
    const assignedStudentIds =
      parsedAssigned.length > 0 ? parsedAssigned : defaultStudents;
    if (parsedAssigned.length === 0 && defaultStudents.length > 0) {
      wasAutoCompleted = true;
    }

    // If remote had < 5 tasks, normalize weights to 20% each so the 5 tasks sum to 100%
    const rawWeight = Number(remote.weightPercent ?? remote.weight_percent ?? 20);
    const weightPercent =
      remoteList.length === 5 && Number.isInteger(rawWeight) && rawWeight >= 1 && rawWeight <= 100
        ? rawWeight
        : 20;
    if (weightPercent !== rawWeight) {
      wasAutoCompleted = true;
    }

    merged.push({
      slotIndex: i + 1,
      taskId,
      taskName,
      description,
      weightPercent,
      deadline,
      assignedStudentIds,
    });
  }

  // Ensure weights of the 5 tasks sum to 100%
  const sumWeight = merged.reduce((acc, t) => acc + t.weightPercent, 0);
  if (sumWeight !== 100) {
    for (const t of merged) {
      t.weightPercent = 20;
    }
    wasAutoCompleted = true;
  }

  const extraRemoteTaskIds = remoteList
    .slice(5)
    .map((r) => Number(r.id))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (extraRemoteTaskIds.length > 0) {
    wasAutoCompleted = true;
  }

  return {
    tasks: merged,
    extraRemoteTaskIds,
    wasAutoCompleted,
  };
}

function collectClassStudentNamesForRedaction(
  classCode?: string,
  explicitNames?: string[]
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const pushName = (raw?: string | null) => {
    const clean = String(raw || "").replace(/\s+/g, " ").trim();
    if (clean.length < 2) return;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(clean);
    }
  };

  for (const n of explicitNames || []) {
    pushName(n);
  }

  const normClass = String(classCode || "").trim().toUpperCase();
  if (normClass) {
    try {
      const rec = teachingProjectRepo.findOne(normClass);
      if (rec?.studentsJson) {
        const parsed = JSON.parse(rec.studentsJson) as TeachingStudentItem[];
        if (Array.isArray(parsed)) {
          for (const s of parsed) {
            pushName(s?.studentName);
          }
        }
      }
    } catch {
      // ignore
    }

    try {
      const db = getDb();
      const rows = db
        .prepare(`SELECT fullName FROM students WHERE UPPER(classId) = ? ORDER BY studentId ASC`)
        .all(normClass) as Array<{ fullName?: string }>;
      for (const r of rows) {
        pushName(r?.fullName);
      }
    } catch {
      // ignore
    }
  }

  return ordered;
}

/**
 * Strips student names (multi-pass: 1. all full names, 2. all 2-word combinations,
 * 3. all given names, 4. any adjacent family/middle name tokens -> STUDENT_01, STUDENT_02...),
 * emails, and phone numbers from any free-text string before sending to Gemini (Rule 5 PII Guardrail).
 */
export function sanitizeTeachingAiHint(
  rawHint?: string,
  studentNamesToRedact?: string[],
  classCode?: string
): string {
  let text = String(rawHint || "").trim();
  if (!text) return "";

  // 1. Redact emails and phone numbers
  text = text.replace(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    "[REDACTED_EMAIL]"
  );
  text = text.replace(
    /(?:\+?84|0)(?:\d[\s.-]?){8,10}\d/g,
    "[REDACTED_PHONE]"
  );

  const escapeRegexToken = (token: string): string =>
    token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const stripViAccents = (s: string): string =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D");

  // 2. Collect ordered student roster and assign deterministic aliases STUDENT_01, STUDENT_02...
  const names = collectClassStudentNamesForRedaction(classCode, studentNamesToRedact);
  const entries = names.map((fullName, index) => {
    const alias = `STUDENT_${String(index + 1).padStart(2, "0")}`;
    const parts = fullName
      .trim()
      .split(/\s+/)
      .filter((p) => p.length >= 2);
    return { fullName: fullName.trim(), alias, parts, index };
  });

  // Pass 1: Replace ALL full names (longest first) across the entire roster before touching shorter forms
  const pass1Full = [...entries].sort(
    (a, b) => b.parts.length - a.parts.length || b.fullName.length - a.fullName.length || a.index - b.index
  );
  for (const item of pass1Full) {
    if (item.parts.length === 0) continue;
    const fullPattern = item.parts.map(escapeRegexToken).join("\\s+");
    text = text.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${fullPattern}(?![\\p{L}\\p{N}])`, "giu"),
      item.alias
    );
    const asciiParts = item.parts.map((p) => escapeRegexToken(stripViAccents(p)));
    const asciiFullPattern = asciiParts.join("\\s+");
    if (asciiFullPattern.toLowerCase() !== fullPattern.toLowerCase()) {
      text = text.replace(
        new RegExp(`(?<![\\p{L}\\p{N}])${asciiFullPattern}(?![\\p{L}\\p{N}])`, "giu"),
        item.alias
      );
    }
  }

  // Pass 2: Replace ALL 2-word sub-phrases (last 2 words, first+last word, first 2 words) across all students
  const twoWordPatterns: Array<{ pattern: string; alias: string; len: number; index: number }> = [];
  for (const item of entries) {
    const p = item.parts;
    if (p.length >= 2) {
      const pairs: Array<[string, string]> = [
        [p[p.length - 2], p[p.length - 1]],
        [p[0], p[p.length - 1]],
      ];
      if (p.length >= 3) {
        pairs.push([p[0], p[1]]);
      }
      for (const [w1, w2] of pairs) {
        const pat = `${escapeRegexToken(w1)}\\s+${escapeRegexToken(w2)}`;
        twoWordPatterns.push({
          pattern: pat,
          alias: item.alias,
          len: w1.length + w2.length,
          index: item.index,
        });
        const asciiPat = `${escapeRegexToken(stripViAccents(w1))}\\s+${escapeRegexToken(stripViAccents(w2))}`;
        if (asciiPat.toLowerCase() !== pat.toLowerCase()) {
          twoWordPatterns.push({
            pattern: asciiPat,
            alias: item.alias,
            len: w1.length + w2.length,
            index: item.index,
          });
        }
      }
    }
  }
  twoWordPatterns.sort((a, b) => b.len - a.len || a.index - b.index);
  for (const tw of twoWordPatterns) {
    text = text.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${tw.pattern}(?![\\p{L}\\p{N}])`, "giu"),
      tw.alias
    );
  }

  // Pass 3: Replace ALL single-word given names (both accented and accent-stripped last token of each student name)
  for (const item of entries) {
    if (item.parts.length >= 1) {
      const given = item.parts[item.parts.length - 1];
      if (given.length >= 2) {
        const escapedGiven = escapeRegexToken(given);
        text = text.replace(
          new RegExp(`(?<![\\p{L}\\p{N}])${escapedGiven}(?![\\p{L}\\p{N}])`, "giu"),
          item.alias
        );
        const asciiGiven = escapeRegexToken(stripViAccents(given));
        if (asciiGiven.toLowerCase() !== escapedGiven.toLowerCase() && asciiGiven.length >= 2) {
          text = text.replace(
            new RegExp(`(?<![\\p{L}\\p{N}])${asciiGiven}(?![\\p{L}\\p{N}])`, "giu"),
            item.alias
          );
        }
      }
    }
  }

  // Pass 4: Absorb any leftover family/middle name tokens immediately preceding STUDENT_XX
  const allFamilyMiddleTokens = new Set<string>();
  for (const item of entries) {
    for (const part of item.parts.slice(0, -1)) {
      if (part.length >= 2) {
        allFamilyMiddleTokens.add(escapeRegexToken(part));
        const asciiPart = escapeRegexToken(stripViAccents(part));
        if (asciiPart.length >= 2) allFamilyMiddleTokens.add(asciiPart);
      }
    }
  }
  if (allFamilyMiddleTokens.size > 0) {
    const tokenUnion = Array.from(allFamilyMiddleTokens).join("|");
    text = text.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])(?:(?:${tokenUnion})\\s+)+(STUDENT_\\d{2})(?![\\p{L}\\p{N}])`, "giu"),
      "$1"
    );
  }

  return text.slice(0, 600);
}

const TEACHING_TASKS_RESPONSE_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    projectDescription: {
      type: SchemaType.STRING,
      description: "Mô tả ngắn gọn mục tiêu dự án cuối khóa của lớp (1-2 câu).",
    },
    tasks: {
      type: SchemaType.ARRAY,
      description: "Danh sách đúng 5 phần công việc theo lộ trình làm sản phẩm cuối khóa.",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          slotIndex: {
            type: SchemaType.INTEGER,
            description: "Thứ tự phần công việc từ 1 đến 5.",
          },
          taskName: {
            type: SchemaType.STRING,
            description:
              "Tên phần công việc chung ngắn gọn (ví dụ: 1. Lên ý tưởng & chuẩn bị tài nguyên).",
          },
          description: {
            type: SchemaType.STRING,
            description:
              "Mô tả chi tiết các đầu việc học sinh phải thực hiện trong giai đoạn này (2-4 gạch đầu dòng).",
          },
          weightPercent: {
            type: SchemaType.INTEGER,
            description: "Tỷ trọng phần trăm của công việc (mặc định 20).",
          },
        },
        required: ["slotIndex", "taskName", "description", "weightPercent"],
      },
    },
  },
  required: ["projectDescription", "tasks"],
};

export interface GenerateTeachingTasksAiInput {
  classCode: string;
  courseName?: string;
  endDate?: string;
  assignedStudentIds?: number[];
  existingTasks?: TeachingProjectTaskItem[];
  teacherHint?: string;
  studentNamesToRedact?: string[];
  mockAiExecutor?: (prompt: string) => Promise<string>;
}

export async function generateTeachingProjectTasksWithAI(
  input: GenerateTeachingTasksAiInput
): Promise<{
  success: boolean;
  usedAi: boolean;
  projectDescription: string;
  tasks: TeachingProjectTaskItem[];
  promptSent?: string;
  error?: string;
  errorCode?: string;
}> {
  const classCode = String(input.classCode || "").trim().toUpperCase();
  const track = detectTeachingCourseTrack(classCode, input.courseName);
  const syllabus = findMatchedCourseSyllabus(classCode, input.courseName);
  const endDate = normalizeDateToIsoYmd(input.endDate);
  const studentIds = normalizeAssignedStudentIds(input.assignedStudentIds || []);
  const fallbackTasks = getStandardFiveTasksForClass(
    classCode,
    endDate,
    studentIds,
    input.courseName
  );

  // Preserve existing remote taskIds on slots 1..5
  const existingTaskIds = (input.existingTasks || []).slice(0, 5).map((t) =>
    t?.taskId && Number.isInteger(Number(t.taskId)) && Number(t.taskId) > 0
      ? Number(t.taskId)
      : null
  );

  const applyTaskIds = (items: TeachingProjectTaskItem[]): TeachingProjectTaskItem[] =>
    items.slice(0, 5).map((item, idx) => ({
      ...item,
      slotIndex: idx + 1,
      taskId: existingTaskIds[idx] ?? item.taskId ?? null,
      deadline: endDate || item.deadline || "",
      assignedStudentIds:
        item.assignedStudentIds && item.assignedStudentIds.length > 0
          ? item.assignedStudentIds
          : studentIds,
    }));

  const safeHint = sanitizeTeachingAiHint(
    input.teacherHint,
    input.studentNamesToRedact,
    classCode
  );
  const safeCourseName = sanitizeTeachingAiHint(
    input.courseName,
    input.studentNamesToRedact,
    classCode
  );
  const safeClassCode = sanitizeTeachingAiHint(
    classCode,
    input.studentNamesToRedact,
    classCode
  );

  // Rule 5 Guardrail: If no matched syllabus, unrecognized course track ("GENERAL"), and no teacher hint -> INSUFFICIENT_INFO
  if (!syllabus && track === "GENERAL" && !safeHint) {
    return {
      success: false,
      usedAi: false,
      projectDescription: "",
      tasks: [],
      error: "INSUFFICIENT_INFO",
      errorCode: "INSUFFICIENT_INFO",
    };
  }

  const syllabusTopics = syllabus
    ? syllabus.sessions
        .slice(0, 14)
        .map((s) => `- Buổi ${s.sessionNumber}: ${s.topic} (${(s.keyKnowledge || []).slice(0, 2).join("; ")})`)
        .join("\n")
    : `- Khóa học thuộc nhóm chuyên đề: ${track}`;

  const prompt = `Bạn là trợ lý học vụ tại MindX. Hãy thiết kế lộ trình "5 Phần Công Việc" làm Sản phẩm cuối khóa (SPCK) cho lớp học dưới đây để giáo viên nhập vào bảng Báo cáo tiến độ Dự án cuối khóa trên hệ thống Teaching.

THÔNG TIN KHÓA HỌC:
- Mã lớp: ${safeClassCode}
- Tên khóa học: ${syllabus?.courseName || safeCourseName || track}
- Mô tả khóa học: ${syllabus?.description || "Khóa học công nghệ & lập trình thực hành tại MindX"}
- Nội dung các buổi học trong giáo trình:
${syllabusTopics}
${safeHint ? `- Ghi chú / Yêu cầu thêm của giáo viên: ${safeHint}` : ""}

QUY TẮC BẮT BUỘC:
1. Tạo ĐÚNG 5 phần công việc theo trình tự thời gian (Timeline) để hoàn thành dự án cuối khóa:
   - Phần 1 (20%): Lên ý tưởng, xác định đề tài & chuẩn bị tài nguyên/hình ảnh/dữ liệu.
   - Phần 2 (20%): Thiết kế giao diện / màn chơi / bố cục / lắp ráp khung sườn sản phẩm.
   - Phần 3 (20%): Lập trình các chức năng cốt lõi (vận dụng kiến thức trọng tâm trong giáo trình).
   - Phần 4 (20%): Hoàn thiện tính năng phụ, hiệu ứng/âm thanh & kiểm thử sửa lỗi (fix bug).
   - Phần 5 (20%): Đóng gói sản phẩm hoàn chỉnh, làm Slide thuyết trình & luyện tập trình bày Demo.
2. Mỗi phần công việc gồm 2 trường tách biệt rõ ràng:
   - "taskName": Tên phần công việc chung ngắn gọn, đánh số từ "1. ..." đến "5. ..." (dưới 90 ký tự).
   - "description": Mô tả chi tiết các đầu việc học sinh cần làm trong phần đó (trình bày bằng 2-3 gạch đầu dòng "- ", bám sát đúng công cụ/ngôn ngữ của khóa học).
3. Mỗi phần có "weightPercent" = 20 (tổng 5 phần = 100%).
4. Tuyệt đối không nhắc tới tên riêng của bất kỳ học sinh nào.`;

  try {
    let rawJsonText = "";
    if (typeof input.mockAiExecutor === "function") {
      rawJsonText = await input.mockAiExecutor(prompt);
    } else {
      if (!config.geminiApiKey || config.geminiApiKey === "your_gemini_api_key_here") {
        return {
          success: true,
          usedAi: false,
          projectDescription:
            syllabus?.description ||
            `Dự án Sản phẩm cuối khóa lớp ${classCode} (${safeCourseName || track}).`,
          tasks: applyTaskIds(fallbackTasks),
          promptSent: prompt,
        };
      }

      const genAI = new GoogleGenerativeAI(config.geminiApiKey);
      const model = genAI.getGenerativeModel({
        model: "gemini-3.5-flash-lite",
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: TEACHING_TASKS_RESPONSE_SCHEMA,
          temperature: 0.35,
        },
      });
      const result = await model.generateContent(prompt);
      rawJsonText = result.response.text();
    }

    const parsed = JSON.parse(rawJsonText);
    const rawTasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
    if (rawTasks.length !== 5) {
      throw new Error(`AI trả về ${rawTasks.length} công việc (yêu cầu đúng 5 công việc).`);
    }

    const aiTasks: TeachingProjectTaskItem[] = rawTasks.slice(0, 5).map((item: any, idx: number) => {
      const fallback = fallbackTasks[idx];
      const rawName = String(item?.taskName || "").trim();
      const rawDesc = String(item?.description || "").replace(/\r\n/g, "\n").trim();
      const numberedName =
        rawName && /^\d+\./.test(rawName)
          ? rawName
          : rawName
          ? `${idx + 1}. ${rawName}`
          : fallback.taskName;

      return {
        slotIndex: idx + 1,
        taskId: existingTaskIds[idx] ?? null,
        taskName: numberedName,
        description: rawDesc || fallback.description,
        weightPercent: 20,
        deadline: endDate,
        assignedStudentIds: studentIds,
      };
    });

    return {
      success: true,
      usedAi: true,
      projectDescription:
        String(parsed?.projectDescription || "").trim() ||
        syllabus?.description ||
        `Dự án Sản phẩm cuối khóa lớp ${classCode}.`,
      tasks: applyTaskIds(aiTasks),
      promptSent: prompt,
    };
  } catch (err: any) {
    return {
      success: true,
      usedAi: false,
      projectDescription:
        syllabus?.description ||
        `Dự án Sản phẩm cuối khóa lớp ${classCode} (${input.courseName || track}).`,
      tasks: applyTaskIds(fallbackTasks),
      promptSent: prompt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
