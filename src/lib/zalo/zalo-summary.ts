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
 * Xây dựng Phần 2 (Nhận xét tình trạng làm BTVN) - CHỈ xuất khi có tải ảnh BTVN.
 */
export function buildBtvnPart2(unsubmittedRawNames: string[]): string {
  const shortNames = (unsubmittedRawNames || [])
    .map((n) => formatShortZaloName(n))
    .filter(Boolean);

  if (shortNames.length === 0) {
    return [
      "Em xin phép cập nhật tình trạng làm bài của các con: Cả lớp đã hoàn thành **100% bài tập về nhà** đầy đủ và đúng hạn, rất đáng khen ngợi!",
      "Phụ huynh tiếp tục khích lệ các con duy trì tinh thần tự giác ôn tập bài cũ để chuẩn bị tốt cho các nội dung học tập ở buổi tiếp theo.",
      "Em xin cảm ơn Quý phụ huynh!",
    ].join("\n");
  }

  return [
    `Em xin phép cập nhật tình trạng làm bài của các con. Những bạn sau **chưa hoàn thành** bài cần bổ sung gấp: *${shortNames.join(", ")}*`,
    "Phụ huynh nhắc nhở các con hoàn thành đầy đủ bài tập và ôn tập bài cũ thật kỹ để củng cố kiến thức, chuẩn bị tốt cho các nội dung học tập ở buổi tiếp theo.",
    "Em xin cảm ơn Quý phụ huynh!",
  ].join("\n");
}

export const DEFAULT_STANDARD_ZALO_TEMPLATE = `@All Kính gửi quý phụ huynh học viên
Em xin phép tổng kết sau buổi học số {{sessionNumber}} – {{sessionDate}}
Mã lớp: {{className}}

- Lớp sĩ số {{attendanceCount}}
- {{generalFeedback}}

📘 NỘI DUNG BUỔI HỌC:
BÀI {{sessionNumber}}: {{lessonTopic}}
{{keyKnowledge}}

📍 NHỮNG ĐIỂM CẦN LƯU Ý:
{{keyNotes}}

📌 NỘI DUNG BUỔI HỌC KẾ TIẾP:
Thời gian: {{nextSessionTime}}
Nội dung bài học: BUỔI {{nextSessionNumber}}: {{nextSessionTopic}}

📝 NHIỆM VỤ KHI VỀ NHÀ:
Làm bài tập về nhà trên Denise bao gồm:
{{homeworkSummary}}
⏰ Hạn nộp: {{homeworkDeadline}}`;

export const DEFAULT_ROBOTICS_ZALO_TEMPLATE = `📢 TỔNG KẾT BUỔI HỌC SỐ {{sessionNumberPad2}} – {{className}}
@All Kính gửi Quý Phụ huynh,
Giáo viên xin cập nhật tình hình học tập của các con sau buổi học số {{sessionNumberPad2}} – ngày {{sessionDate}}.
👥 Sĩ số: {{totalStudentsPad2}} học viên | ✅ Hiện diện: {{presentStudentsPad2}} học viên
📝 NỘI DUNG BUỔI HỌC
📚 Bài {{sessionNumber}}: {{lessonTopicCasePreserved}}
{{roboticsKeyKnowledge}}
🌟 TÌNH HÌNH HỌC TẬP
{{roboticsGeneralFeedback}}
🏡 BÀI TẬP VỀ NHÀ
{{roboticsHomeworkLines}}
🗓 BUỔI HỌC TIẾP THEO – BUỔI {{nextSessionNumberPad2}}
📚 Nội dung: Bài {{nextSessionNumber}} – {{nextSessionTopicCasePreserved}}
⏰ {{roboticsNextSessionTime}}
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
 * Xây dựng nội dung Thông báo Zalo Tổng kết Buổi học (Hỗ trợ cả mẫu Lập trình 6 mục & mẫu Robotics chuyên biệt + Phần 2 BTVN tùy chọn).
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

  // Nhánh 1: Mẫu Thông báo Zalo chuyên biệt cho lớp Robotics (VT-ROB-..., PREB/PREA/PREI, ARMB/ARMA/ARMI, SEMIB/SEMIA/SEMII)
  if (isRoboticsClassForZalo(upperCode)) {
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

    const hasConfirmedDate =
      Boolean(sessionDate) && sessionDate !== "chưa xác nhận ngày học";

    const roboticsPart1 = `📢 TỔNG KẾT BUỔI HỌC SỐ ${sessionNumPad2} – ${upperCode}
@All Kính gửi Quý Phụ huynh,
Giáo viên xin cập nhật tình hình học tập của các con sau buổi học số ${sessionNumPad2}${
      hasConfirmedDate ? ` – ngày ${sessionDate}` : ""
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
📚 Nội dung: Bài ${nextSessionNum} – ${cleanNextTopicCasePreserved}
⏰ ${roboticsNextTimeLine}
💖 Giáo viên chân thành cảm ơn Quý Phụ huynh đã luôn đồng hành và hỗ trợ các con trong quá trình học tập!`;

    const activePart2 = String(params.part2Text || "").trim();
    return activePart2 ? `${roboticsPart1}\n\n${activePart2}` : roboticsPart1;
  }

  // Nhánh 2: Mẫu Thông báo Zalo chuẩn 6 mục cho lớp Lập trình (Coding)
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

  const part1 = `@All Kính gửi quý phụ huynh học viên
Em xin phép tổng kết sau buổi học số ${sessionNum}${sessionDate ? ` – ${sessionDate}` : ""}
Mã lớp: ${upperCode}

- Lớp sĩ số ${attendanceStr}
- ${generalFeedbackLine.replace(/^[-•*]\s*/, "")}

📘 NỘI DUNG BUỔI HỌC:
BÀI ${sessionNum}: ${cleanTopicUpper}
${keyKnowledgeText}

📍 NHỮNG ĐIỂM CẦN LƯU Ý:
${keyNotesText}

📌 NỘI DUNG BUỔI HỌC KẾ TIẾP:
Thời gian: ${nextTimeLine}
Nội dung bài học: BUỔI ${nextSessionNum}: ${nextTopic}

📝 NHIỆM VỤ KHI VỀ NHÀ:
Làm bài tập về nhà trên Denise bao gồm:
${homeworkDetails}
⏰ Hạn nộp: ${deadlineLine}`;

  const activePart2 = String(params.part2Text || "").trim();
  return activePart2 ? `${part1}\n\n${activePart2}` : part1;
}
