export interface ZaloSessionItemInput {
  sessionId: string;
  sessionNumber: number;
  topic: string;
  date?: string;
  sessionDate?: string;
}

export interface ZaloStudentItemInput {
  studentId?: string;
  fullName: string;
  isActive?: boolean;
  attendanceStatus?: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | "UNKNOWN" | string;
  quickTags?: string[];
  teacherNote?: string;
}

export interface ZaloSyllabusSessionInput {
  sessionNumber: number;
  topic: string;
  keyKnowledge?: string[];
  homeworkBrief?: string;
}

export interface ZaloSyllabusCourseInput {
  courseCode: string;
  courseName?: string;
  sessions: ZaloSyllabusSessionInput[];
}

export interface BuildAutoZaloBroadcastParams {
  classCode: string;
  selectedSessionId?: string;
  sessionNumber?: number;
  sessionDate?: string;
  sessions?: ZaloSessionItemInput[];
  students?: ZaloStudentItemInput[];
  attendanceCountOverride?: string;
  generalFeedbackOverride?: string;
  currentTopic?: string;
  currentKeyKnowledge?: string[];
  currentHomeworkBrief?: string;
  keyNotesOverride?: string[];
  nextSessionTimeOverride?: string;
  nextSessionTopicOverride?: string;
  homeworkDeadlineOverride?: string;
  syllabusList?: ZaloSyllabusCourseInput[];
  part2Text?: string;
  /** Bật/tắt mục 2c: Tiến độ sản phẩm cuối khóa (Mặc định tự động bật khi buổi >= 11) */
  includeSpckProgress?: boolean;
  spckProgressOverride?: string;
  /** Bật/tắt mục 2a: Cập nhật tình hình chung nâng cao */
  includeGeneralUpdate?: boolean;
  generalUpdateOverride?: string;
  /** Bật/tắt Đoạn 3: Lời nhắc gửi hình ảnh hoạt động & tài liệu học tập (Mặc định bật) */
  includePart3MediaReminder?: boolean;
  part3TextOverride?: string;
}

/**
 * Rút gọn họ tên học sinh theo quy tắc Tên đệm + Tên (bỏ họ đầu nếu tên >= 3 chữ).
 * Ví dụ: "Nguyễn Thành Phong" -> "Thành Phong", "Đức Tuấn" -> "Đức Tuấn".
 */
export function formatShortZaloName(fullName: string): string {
  const words = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.length >= 3 ? words.slice(1).join(" ") : words.join(" ");
}

export const formatShortStudentName = formatShortZaloName;

/**
 * Nguyên tắc Tịnh tiến Thời gian: Cộng thêm số ngày (mặc định +7 ngày) từ mốc dd/mm/yyyy
 * và trả về Thứ trong tuần kèm ngày dd/mm/yyyy.
 */
export function addDaysToDdMmYyyyDetailed(
  dateStr?: string,
  daysToAdd = 7
): { dateFormatted: string; weekdayLabel: string; fullLabel: string } | null {
  if (!dateStr) return null;
  const m = String(dateStr)
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + daysToAdd);

  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  const dateFormatted = `${dd}/${mm}/${yyyy}`;

  const weekdays = [
    "Chủ nhật",
    "Thứ Hai",
    "Thứ Ba",
    "Thứ Tư",
    "Thứ Năm",
    "Thứ Sáu",
    "Thứ Bảy",
  ];
  const weekdayLabel = weekdays[d.getDay()] || "";
  return {
    dateFormatted,
    weekdayLabel,
    fullLabel: `${weekdayLabel}, ngày ${dateFormatted}`,
  };
}

export function addDaysToDdMmYyyy(dateStr?: string, daysToAdd = 7): string {
  return addDaysToDdMmYyyyDetailed(dateStr, daysToAdd)?.fullLabel || "";
}

export function buildCourseKeyNotes(
  classCode: string,
  keyKnowledge?: string[]
): string[] {
  const upperCode = String(classCode || "").trim().toUpperCase();
  const isGameMakerCourse = /\b(GA|GB|GI)\d*/i.test(upperCode);

  if (isGameMakerCourse) {
    return [
      "- Trình bày được mối liên hệ giữa giao diện, nhân vật và luật chơi trong vòng lặp chơi chính.",
      "- Thực hiện lập trình ổn định các cơ chế điều khiển và chức năng cốt lõi của sản phẩm.",
      "- Thực hiện kiểm thử từng chức năng sau khi hoàn thành để đảm bảo chương trình vận hành mượt mà.",
    ];
  }

  if (Array.isArray(keyKnowledge) && keyKnowledge.length > 0 && String(keyKnowledge[0] || "").trim()) {
    const cleanFirst = String(keyKnowledge[0] || "")
      .replace(/^[-•+*]\s*/, "")
      .trim();
    return [
      `- Trình bày được ý nghĩa và vận dụng kiến thức trọng tâm: ${cleanFirst}`,
      "- Thực hiện viết code/xây dựng sản phẩm và kiểm thử từng chức năng để đảm bảo chương trình vận hành ổn định.",
      "- Thực hiện hoàn thiện dự án cá nhân và rèn luyện tư duy giải quyết vấn đề.",
    ];
  }

  return [
    "- Trình bày được các khái niệm và cấu trúc lệnh trọng tâm đã học trong buổi.",
    "- Thực hiện kiểm thử từng chức năng của sản phẩm để đảm bảo chương trình vận hành ổn định.",
    "- Thực hiện phát triển thêm các tính năng mở rộng cho dự án.",
  ];
}

/**
 * Xây dựng Phần 2b (Nhận xét tình trạng làm BTVN) - xuất khi có tải ảnh BTVN hoặc danh sách học sinh chưa nộp.
 */
export function buildBtvnPart2(unsubmittedRawNames: string[]): string {
  const shortNames = (unsubmittedRawNames || [])
    .map((n) => formatShortZaloName(n))
    .filter(Boolean);

  if (shortNames.length === 0) {
    return [
      "📊 TÌNH TRẠNG BÀI TẬP VỀ NHÀ:",
      "Em xin phép cập nhật tình trạng làm bài của các con: Cả lớp đã hoàn thành **100% bài tập về nhà** đầy đủ và đúng hạn, rất đáng khen ngợi!",
      "Phụ huynh tiếp tục khích lệ các con duy trì tinh thần tự giác ôn tập bài cũ để chuẩn bị tốt cho các nội dung học tập ở buổi tiếp theo.",
      "Em xin cảm ơn Quý phụ huynh!",
    ].join("\n");
  }

  return [
    "📊 TÌNH TRẠNG BÀI TẬP VỀ NHÀ:",
    `Em xin phép cập nhật tình trạng làm bài của các con. Những bạn sau **chưa hoàn thành** bài cần bổ sung gấp: *${shortNames.join(", ")}*`,
    "Phụ huynh nhắc nhở các con hoàn thành đầy đủ bài tập và ôn tập bài cũ thật kỹ để củng cố kiến thức, chuẩn bị tốt cho các nội dung học tập ở buổi tiếp theo.",
    "Em xin cảm ơn Quý phụ huynh!",
  ].join("\n");
}

/**
 * Xây dựng mục 2a: Cập nhật tình hình chung (ghi nhận sự tiến bộ / cần hỗ trợ kèm phương án xử lý).
 */
export function buildGeneralClassUpdateSection(
  students: ZaloStudentItemInput[],
  sessionNumber: number,
  overrideText?: string
): string {
  const custom = String(overrideText || "").trim();
  if (custom) {
    return `🌟 CẬP NHẬT TÌNH HÌNH CHUNG:\n- ${custom.replace(/^[-•*]\s*/, "")}`;
  }

  const activePresent = (students || []).filter(
    (s) => s.isActive !== false && s.attendanceStatus !== "ABSENT"
  );
  const supportNames: string[] = [];
  const distractedNames: string[] = [];

  for (const st of activePresent) {
    const tagsJoined = Array.isArray(st.quickTags) ? st.quickTags.join(" ").toLowerCase() : "";
    const shortName = formatShortZaloName(st.fullName);
    if (!shortName) continue;
    if (/tiếp thu chậm|thao tác.*chậm|cần hỗ trợ|lúng túng|cần kèm|trung bình|chưa kịp/i.test(tagsJoined)) {
      supportNames.push(shortName);
    } else if (/mất tập trung|xao nhãng|nói chuyện riêng|cần nhắc tập trung/i.test(tagsJoined)) {
      distractedNames.push(shortName);
    }
  }

  const lines: string[] = [
    "- Đa số các con nắm bắt tốt kiến thức trọng tâm, chủ động thực hành và hoàn thành nhiệm vụ học tập trên lớp.",
  ];

  if (supportNames.length > 0) {
    lines.push(
      `- Một số bạn thao tác còn hơi chậm (*${supportNames.join(", ")}*), giáo viên đã trực tiếp kèm sát tại lớp và hướng dẫn chia nhỏ từng bước để các con theo kịp tiến độ.`
    );
  }
  if (distractedNames.length > 0) {
    lines.push(
      `- Một số bạn đôi lúc còn xao nhãng (*${distractedNames.join(", ")}*), giáo viên đã kịp thời nhắc nhở và đặt câu hỏi tương tác để giúp các con tập trung hơn vào bài học.`
    );
  }
  if (supportNames.length === 0 && distractedNames.length === 0 && sessionNumber >= 5) {
    lines.push(
      "- Các con có sự tiến bộ rõ rệt về kỹ năng thao tác cũng như khả năng tự kiểm tra và xử lý lỗi trong quá trình làm bài."
    );
  }

  return `🌟 CẬP NHẬT TÌNH HÌNH CHUNG:\n${lines.join("\n")}`;
}

/**
 * Xây dựng mục 2c: Tiến độ sản phẩm cuối khóa (SPCK) dành cho lớp trong giai đoạn dự án (Buổi 11 - 14).
 */
export function buildSpckProgressSection(
  sessionNumber: number,
  overrideText?: string
): string {
  const custom = String(overrideText || "").trim();
  if (custom) {
    return `🚀 TIẾN ĐỘ SẢN PHẨM CUỐI KHÓA (SPCK):\n- ${custom.replace(/^[-•*]\s*/, "")}`;
  }

  if (sessionNumber === 11) {
    return [
      "🚀 TIẾN ĐỘ SẢN PHẨM CUỐI KHÓA (SPCK):",
      "- Lớp đang bắt đầu giai đoạn lên ý tưởng, xác định chủ đề và chuẩn bị tài nguyên cho Sản phẩm cuối khóa (đạt khoảng 20% tiến độ).",
      "- Ba mẹ nhắc các con suy nghĩ thêm ý tưởng và chuẩn bị đầy đủ hình ảnh/nội dung cho dự án của mình.",
    ].join("\n");
  }
  if (sessionNumber === 12) {
    return [
      "🚀 TIẾN ĐỘ SẢN PHẨM CUỐI KHÓA (SPCK):",
      "- Các con đang triển khai xây dựng giao diện và lập trình các chức năng cốt lõi Giai đoạn 1 của Sản phẩm cuối khóa (đạt khoảng 50% - 60% tiến độ).",
      "- Về nhà các con tiếp tục hoàn thiện thêm các tính năng chính để chuẩn bị ghép nối và chạy thử ở buổi tiếp theo.",
    ].join("\n");
  }
  if (sessionNumber === 13) {
    return [
      "🚀 TIẾN ĐỘ SẢN PHẨM CUỐI KHÓA (SPCK):",
      "- Lớp đang hoàn thiện Giai đoạn 2 của Sản phẩm cuối khóa, kiểm thử lỗi sản phẩm và chuẩn bị slide/kịch bản thuyết trình (đạt khoảng 80% - 90% tiến độ).",
      "- Ba mẹ khích lệ các con luyện tập trước phần trình bày ở nhà để thật tự tin trong buổi Bảo vệ dự án cuối khóa (Demo Day) tuần tới.",
    ].join("\n");
  }
  if (sessionNumber >= 14) {
    return [
      "🚀 TIẾN ĐỘ SẢN PHẨM CUỐI KHÓA (SPCK):",
      "- Các con đã hoàn thành 100% Sản phẩm cuối khóa và tham gia thuyết trình bảo vệ dự án trong buổi tổng kết khóa học.",
    ].join("\n");
  }

  return [
    "🚀 TIẾN ĐỘ SẢN PHẨM CUỐI KHÓA (SPCK):",
    `- Các con đang tích cực thực hiện và hoàn thiện dần các hạng mục của Sản phẩm cuối khóa theo lộ trình buổi ${sessionNumber}.`,
  ].join("\n");
}

/**
 * Xây dựng Đoạn 3: Lời nhắc gửi hình ảnh hoạt động lớp học & tài liệu/học liệu.
 */
export function buildPart3MediaAndMaterialsSection(
  isRobotics: boolean,
  overrideText?: string
): string {
  const custom = String(overrideText || "").trim();
  if (custom) {
    return custom;
  }

  if (isRobotics) {
    return [
      "📸 HÌNH ẢNH & TÀI LIỆU BUỔI HỌC:",
      "- Hình ảnh mô hình lắp ráp, các hoạt động tích cực và khoảnh khắc giáo viên hỗ trợ các con trong giờ học được gửi kèm ngay bên dưới.",
      "- Tài liệu / học liệu tóm tắt kiến thức buổi học được đính kèm để Quý Phụ huynh và các con tiện ôn tập tại nhà.",
    ].join("\n");
  }

  return [
    "📸 HÌNH ẢNH & TÀI LIỆU BUỔI HỌC:",
    "- Giáo viên xin gửi kèm bên dưới một số hình ảnh hoạt động học tập tích cực, khoảnh khắc thầy trò cùng trao đổi và hỗ trợ các con thực hành trên lớp.",
    "- Tài liệu / học liệu và nội dung trọng tâm của buổi học được gửi kèm để ba mẹ và các con tiện theo dõi, ôn tập tại nhà.",
  ].join("\n");
}

export const DEFAULT_STANDARD_ZALO_TEMPLATE = `@All Kính gửi quý phụ huynh, giáo viên xin phép tổng kết sau buổi học số {{sessionNumber}} ngày {{sessionDate}}
Mã lớp: {{className}}

- Lớp sĩ số {{attendanceCount}}
- {{generalFeedback}}

📘 NỘI DUNG BUỔI HỌC:
BÀI {{sessionNumber}}: {{lessonTopic}}
{{keyKnowledge}}

📍 NHỮNG ĐIỂM CẦN LƯU Ý:
{{keyNotes}}

📝 NHIỆM VỤ KHI VỀ NHÀ:
Làm bài tập về nhà trên Denise bao gồm:
{{homeworkSummary}}
⏰ Hạn nộp: {{homeworkDeadline}}

📌 NỘI DUNG BUỔI HỌC KẾ TIẾP:
Thời gian: {{nextSessionTime}}
Nội dung bài học: BUỔI {{nextSessionNumber}}: {{nextSessionTopic}}`;

export const DEFAULT_ROBOTICS_ZALO_TEMPLATE = `📢 TỔNG KẾT BUỔI HỌC SỐ {{sessionNumberPad2}} – {{className}}
@All Kính gửi quý phụ huynh, giáo viên xin phép tổng kết sau buổi học số {{sessionNumberPad2}} ngày {{sessionDate}}.
👥 Sĩ số: {{totalStudentsPad2}} học viên | ✅ Hiện diện: {{presentStudentsPad2}} học viên
📝 NỘI DUNG BUỔI HỌC
📚 Bài {{sessionNumber}}: {{lessonTopicCasePreserved}}
{{roboticsKeyKnowledge}}
🌟 TÌNH HÌNH HỌC TẬP
{{roboticsGeneralFeedback}}
🏡 BÀI TẬP VỀ NHÀ
{{roboticsHomeworkLines}}
🗓 BUỔI HỌC TIẾP THEO – BUỔI {{nextSessionNumberPad2}}
⏰ {{roboticsNextSessionTime}}
📚 Nội dung: Bài {{nextSessionNumber}} – {{nextSessionTopicCasePreserved}}
💖 Giáo viên chân thành cảm ơn Quý Phụ huynh đã luôn đồng hành và hỗ trợ các con trong quá trình học tập!`;

/**
 * Nhận diện lớp Robotics để xuất đúng mẫu Thông báo Zalo Robotics.
 */
export function isRoboticsClassForZalo(classCode: string): boolean {
  const upper = String(classCode || "").trim().toUpperCase();
  if (!upper) return false;
  return (
    /\b(ROB|ROBOTICS|PREB|PREA|PREI|ARMB|ARMA|ARMI|SEMIB|SEMIA|SEMII|VEX)\w*/i.test(upper) ||
    /(?:-|_)ROB|[A-Z]*ROB\d/i.test(upper)
  );
}

function formatRoboticsHomeworkLines(rawHomework: string): string {
  const trimmed = String(rawHomework || "").trim();
  if (!trimmed) {
    return [
      "Ôn tập các câu lệnh và nguyên lý lắp ráp đã học trong buổi học.",
      "Chuẩn bị bài cho buổi học tiếp theo.",
    ].join("\n");
  }
  const existingLines = trimmed
    .split(/\r?\n/)
    .map((l) => l.replace(/^(?:[-•*🔹+]\s*)+/, "").trim())
    .filter(Boolean);
  if (existingLines.length > 1) {
    return existingLines.join("\n");
  }
  const singleLine = existingLines[0] || trimmed;
  const sentences = singleLine
    .split(
      /(?<=[.!?])\s+(?=[A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ])/
    )
    .map((s) => s.trim())
    .filter(Boolean);
  return (sentences.length > 0 ? sentences : [singleLine]).join("\n");
}

/**
 * Xây dựng nội dung Thông báo Zalo Tổng kết Buổi học theo quy chuẩn 3 đoạn mới:
 * - Đoạn 1: Câu mở đầu chuẩn + (a) Điểm danh, chuyên cần + (b) Nội dung bài học + (c) Yêu cầu/dặn dò sau buổi học + (d) Thời gian & tiêu đề buổi học kế tiếp.
 * - Đoạn 2: (a) Cập nhật tình hình chung (tùy chọn) + (b) Tình trạng BTVN (khi có ảnh BTVN) + (c) Tiến độ SPCK (tự động ở buổi >= 11 hoặc khi bật).
 * - Đoạn 3: Gửi hình ảnh hoạt động & tài liệu/học liệu (tùy chọn).
 */
export function buildAutoZaloBroadcastText(params: BuildAutoZaloBroadcastParams): string {
  const sessions = Array.isArray(params.sessions) ? params.sessions : [];
  const students = Array.isArray(params.students) ? params.students : [];
  const syllabusList = Array.isArray(params.syllabusList) ? params.syllabusList : [];
  const currentKeyKnowledge = Array.isArray(params.currentKeyKnowledge)
    ? params.currentKeyKnowledge.filter((k) => Boolean(String(k || "").trim()))
    : [];

  const sess = params.selectedSessionId
    ? sessions.find((s) => s.sessionId === params.selectedSessionId)
    : undefined;
  const sessionNum =
    typeof params.sessionNumber === "number" && params.sessionNumber > 0
      ? params.sessionNumber
      : sess?.sessionNumber || 1;
  const sessionDate =
    params.sessionDate || sess?.date || sess?.sessionDate || "chưa xác nhận ngày học";
  const hasConfirmedDate =
    Boolean(sessionDate) && sessionDate !== "chưa xác nhận ngày học";

  const activeStudents = students.filter((s) => s.isActive !== false);
  const totalStudents = activeStudents.length;
  const hasUnconfirmedAttendance =
    totalStudents === 0 ||
    activeStudents.some((s) => !s.attendanceStatus || s.attendanceStatus === "UNKNOWN");
  const presentStudents = activeStudents.filter(
    (s) => s.attendanceStatus === "PRESENT" || s.attendanceStatus === "LATE"
  ).length;
  const absentStudents = activeStudents.filter((s) => s.attendanceStatus === "ABSENT");
  const absentShortNames = absentStudents.map((s) => formatShortZaloName(s.fullName));

  const nextSessionNum = sessionNum + 1;
  const nextSess = sessions.find((s) => s.sessionNumber === nextSessionNum);
  const upperCode = String(params.classCode || "").trim().toUpperCase();
  const sortedSyllabus = [...syllabusList].sort(
    (a, b) => (b.courseCode?.length || 0) - (a.courseCode?.length || 0)
  );
  const matchedCourse = sortedSyllabus.find((c) =>
    upperCode.includes(String(c.courseCode || "").toUpperCase())
  );
  const currentSyllabusSess = matchedCourse?.sessions.find((s) => s.sessionNumber === sessionNum);
  const nextSyllabusSess = matchedCourse?.sessions.find((s) => s.sessionNumber === nextSessionNum);

  const effectiveTopic =
    params.currentTopic || currentSyllabusSess?.topic || sess?.topic || `Buổi ${sessionNum}`;
  const effectiveKnowledge =
    currentKeyKnowledge.length > 0
      ? currentKeyKnowledge
      : Array.isArray(currentSyllabusSess?.keyKnowledge) &&
        currentSyllabusSess!.keyKnowledge!.length > 0
      ? currentSyllabusSess!.keyKnowledge!
      : [effectiveTopic];

  const rawNextDate = (nextSess?.date || nextSess?.sessionDate || "").trim();
  const nextDateWithWeekday = rawNextDate
    ? addDaysToDdMmYyyy(rawNextDate, 0) || `Ngày ${rawNextDate}`
    : addDaysToDdMmYyyy(sessionDate, 7);

  const rawHw =
    params.currentHomeworkBrief !== undefined
      ? params.currentHomeworkBrief
      : currentSyllabusSess?.homeworkBrief || "";

  const isRobotics = isRoboticsClassForZalo(upperCode);

  // Xây dựng các mục của Đoạn 2 (nếu có) và Đoạn 3 (nếu bật)
  const section2Blocks: string[] = [];
  if (params.includeGeneralUpdate) {
    section2Blocks.push(
      buildGeneralClassUpdateSection(students, sessionNum, params.generalUpdateOverride)
    );
  }
  const shouldIncludeSpck =
    params.includeSpckProgress !== undefined
      ? Boolean(params.includeSpckProgress)
      : sessionNum >= 11;
  if (shouldIncludeSpck) {
    section2Blocks.push(
      buildSpckProgressSection(sessionNum, params.spckProgressOverride)
    );
  }
  const activePart2 = String(params.part2Text || "").trim();
  if (activePart2) {
    section2Blocks.push(activePart2);
  }

  const section3Block =
    params.includePart3MediaReminder === true
      ? buildPart3MediaAndMaterialsSection(isRobotics, params.part3TextOverride)
      : "";

  // Nhánh 1: Mẫu Thông báo Zalo chuyên biệt cho lớp Robotics (VT-ROB-..., PREB/PREA/PREI, ARMB/ARMA/ARMI, SEMIB/SEMIA/SEMII)
  if (isRobotics) {
    const sessionNumPad2 = String(sessionNum).padStart(2, "0");
    const nextSessionNumPad2 = String(nextSessionNum).padStart(2, "0");
    const totalPad2 = totalStudents > 0 ? String(totalStudents).padStart(2, "0") : "..";
    const effectivePresentCount = hasUnconfirmedAttendance
      ? Math.max(0, totalStudents - absentStudents.length)
      : presentStudents;
    const presentPad2 =
      totalStudents > 0 ? String(effectivePresentCount).padStart(2, "0") : "..";
    const absentSuffix =
      !hasUnconfirmedAttendance && absentShortNames.length > 0
        ? ` (Vắng: ${absentShortNames.join(", ")})`
        : "";
    const roboticsAttendanceLine = params.attendanceCountOverride
      ? `👥 ${params.attendanceCountOverride}`
      : `👥 Sĩ số: ${totalPad2} học viên | ✅ Hiện diện: ${presentPad2} học viên${absentSuffix}`;

    const cleanTopicCasePreserved =
      String(effectiveTopic || `Bài ${sessionNum}`)
        .replace(/^(?:BÀI|BUỔI)\s+\d+\s*[-:–.]*\s*/i, "")
        .trim() || `Bài học buổi ${sessionNum}`;

    const roboticsKnowledgeLines = effectiveKnowledge
      .map((item) => {
        const cleanItem = String(item || "")
          .trim()
          .replace(/^(?:[-•*🔹+]\s*)+/, "")
          .trim();
        return cleanItem ? `🔹 ${cleanItem}` : "";
      })
      .filter(Boolean)
      .join("\n");

    const joinedKnowledge = effectiveKnowledge.join(" ");
    const hasConditionLoopSensor =
      /điều kiện|if\.\.\.else/i.test(joinedKnowledge) &&
      /vòng lặp/i.test(joinedKnowledge) &&
      /cảm biến/i.test(joinedKnowledge);

    const roboticsGeneralFeedback =
      params.generalFeedbackOverride ||
      (hasConditionLoopSensor
        ? `Trong buổi học số ${sessionNumPad2}, các con tham gia học tập nghiêm túc, tích cực trao đổi với giáo viên và thực hành các nhiệm vụ được giao. Qua bài học, các con được rèn luyện kỹ năng lắp ráp, tư duy logic và vận dụng câu lệnh điều kiện, vòng lặp cùng cảm biến vào lập trình mô hình.`
        : `Trong buổi học số ${sessionNumPad2}, các con tham gia học tập nghiêm túc, tích cực trao đổi với giáo viên và thực hành các nhiệm vụ được giao. Qua bài học, các con được rèn luyện kỹ năng lắp ráp, tư duy logic và vận dụng kiến thức đã học vào chế tạo, lập trình mô hình.`);

    const roboticsHomeworkBlock = formatRoboticsHomeworkLines(rawHw);

    const cleanNextTopicCasePreserved =
      String(
        params.nextSessionTopicOverride ||
          nextSyllabusSess?.topic ||
          nextSess?.topic ||
          `Nội dung buổi ${nextSessionNum}`
      )
        .replace(/^(?:BÀI|BUỔI)\s+\d+\s*[-:–.]*\s*/i, "")
        .trim() || `Nội dung buổi ${nextSessionNum}`;

    const roboticsNextTimeLine =
      params.nextSessionTimeOverride ||
      (nextDateWithWeekday
        ? nextDateWithWeekday
        : "Theo lịch học cố định của lớp (chưa xác nhận ngày cụ thể)");

    const roboticsPart1 = `📢 TỔNG KẾT BUỔI HỌC SỐ ${sessionNumPad2} – ${upperCode}
@All Kính gửi quý phụ huynh, giáo viên xin phép tổng kết sau buổi học số ${sessionNumPad2}${
      hasConfirmedDate ? ` ngày ${sessionDate}` : ""
    }.
${roboticsAttendanceLine}
📝 NỘI DUNG BUỔI HỌC
📚 Bài ${sessionNum}: ${cleanTopicCasePreserved}
${roboticsKnowledgeLines}
🌟 TÌNH HÌNH HỌC TẬP
${roboticsGeneralFeedback}
🏡 BÀI TẬP VỀ NHÀ
${roboticsHomeworkBlock}
🗓 BUỔI HỌC TIẾP THEO – BUỔI ${nextSessionNumPad2}
⏰ ${roboticsNextTimeLine}
📚 Nội dung: Bài ${nextSessionNum} – ${cleanNextTopicCasePreserved}
💖 Giáo viên chân thành cảm ơn Quý Phụ huynh đã luôn đồng hành và hỗ trợ các con trong quá trình học tập!`;

    return [roboticsPart1, ...section2Blocks, section3Block]
      .filter(Boolean)
      .join("\n\n");
  }

  // Nhánh 2: Mẫu Thông báo Zalo chuẩn mới cho lớp Lập trình (Coding)
  // Thứ tự Đoạn 1: Câu mở đầu chuẩn -> (a) Điểm danh -> (b) Nội dung bài học & Lưu ý -> (c) Yêu cầu/Dặn dò BTVN -> (d) Thời gian & Tiêu đề buổi học kế tiếp
  const attendanceStr = params.attendanceCountOverride
    ? params.attendanceCountOverride
    : hasUnconfirmedAttendance
    ? `${totalStudents > 0 ? totalStudents : "..."} (chưa xác nhận đầy đủ điểm danh) ổn định đầu giờ tốt.`
    : presentStudents === totalStudents
    ? `${totalStudents}/${totalStudents} (đi học đầy đủ) ổn định đầu giờ tốt.`
    : `${presentStudents}/${totalStudents} (vắng bạn ${
        absentShortNames.length > 0
          ? absentShortNames.join(", ")
          : `${totalStudents - presentStudents} bạn`
      }) ổn định đầu giờ tốt.`;

  const generalFeedbackLine =
    params.generalFeedbackOverride ||
    "Các con nhớ bài tốt, tự giác trong quá trình học và năng nổ phát biểu, xây dựng bài trong buổi học.";

  const nextTopic = (
    params.nextSessionTopicOverride ||
    nextSyllabusSess?.topic ||
    nextSess?.topic ||
    `NỘI DUNG BUỔI ${nextSessionNum}`
  )
    .replace(/^(?:BÀI|BUỔI)\s+\d+\s*:\s*/i, "")
    .trim()
    .toUpperCase();

  const nextTimeLine =
    params.nextSessionTimeOverride ||
    (nextDateWithWeekday
      ? nextDateWithWeekday
      : "Theo lịch học cố định của lớp (chưa xác nhận ngày cụ thể)");
  const deadlineLine =
    params.homeworkDeadlineOverride ||
    (nextDateWithWeekday ? nextDateWithWeekday : "Trước buổi học kế tiếp");

  const keyKnowledgeText = effectiveKnowledge
    .map((item) => {
      const t = String(item || "").trim();
      return /^[-•*]/.test(t) ? t.replace(/^[•*]\s*/, "- ") : `- ${t}`;
    })
    .join("\n");

  const rawKeyNotes =
    Array.isArray(params.keyNotesOverride) && params.keyNotesOverride.length > 0
      ? params.keyNotesOverride
      : buildCourseKeyNotes(upperCode, currentKeyKnowledge);
  const keyNotesText = rawKeyNotes
    .map((line) => {
      const trimmed = String(line || "").trim();
      return /^[-•*]/.test(trimmed) ? trimmed.replace(/^[•*]\s*/, "- ") : `- ${trimmed}`;
    })
    .join("\n");

  const defaultDeniseLines = [
    "+ 10 câu hỏi trắc nghiệm.",
    "+ 2 bài thực hành (làm theo yêu cầu đề bài).",
  ];
  const customHwTrimmed = String(rawHw || "")
    .trim()
    .replace(/^[+-]\s*/, "");
  const homeworkDetails = customHwTrimmed
    ? [...defaultDeniseLines, `+ ${customHwTrimmed}`].join("\n")
    : defaultDeniseLines.join("\n");

  const cleanTopicUpper = String(effectiveTopic || `Buổi ${sessionNum}`)
    .replace(/^(?:BÀI|BUỔI)\s+\d+\s*:\s*/i, "")
    .trim()
    .toUpperCase();

  const part1 = `@All Kính gửi quý phụ huynh, giáo viên xin phép tổng kết sau buổi học số ${sessionNum}${
    hasConfirmedDate ? ` ngày ${sessionDate}` : sessionDate ? ` – ${sessionDate}` : ""
  }
Mã lớp: ${upperCode}

- Lớp sĩ số ${attendanceStr}
- ${generalFeedbackLine.replace(/^[-•*]\s*/, "")}

📘 NỘI DUNG BUỔI HỌC:
BÀI ${sessionNum}: ${cleanTopicUpper}
${keyKnowledgeText}

📍 NHỮNG ĐIỂM CẦN LƯU Ý:
${keyNotesText}

📝 NHIỆM VỤ KHI VỀ NHÀ:
Làm bài tập về nhà trên Denise bao gồm:
${homeworkDetails}
⏰ Hạn nộp: ${deadlineLine}

📌 NỘI DUNG BUỔI HỌC KẾ TIẾP:
Thời gian: ${nextTimeLine}
Nội dung bài học: BUỔI ${nextSessionNum}: ${nextTopic}`;

  return [part1, ...section2Blocks, section3Block]
    .filter(Boolean)
    .join("\n\n");
}

