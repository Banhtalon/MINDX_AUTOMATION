import type { CourseSyllabus, QuickTag, QuickTagCategory } from "../db/json-config";

export type QuickTagTrack = "coding" | "robotics" | "session14" | "common";
export type QuickTagRole =
  | "excellent"
  | "good"
  | "positive"
  | "slow"
  | "distracted"
  | "improve";

export interface SkillLevelClassification {
  levelCode: 1 | 2 | 3 | 4 | 5 | 0;
  label: string;
  description: string;
  badgeClass: string;
}

const ROBOTICS_CLASS_REGEX = /(?:rob|pre[bai]|arm[bai]|semi[bai]|vex)/i;

export function detectTrackByClassCode(classCode: string): "coding" | "robotics" {
  return ROBOTICS_CLASS_REGEX.test(String(classCode || "").trim()) ? "robotics" : "coding";
}

export function getDefaultCheckpointSessions(classCodeOrTrack: string): number[] {
  const normalized = String(classCodeOrTrack || "").trim().toLowerCase();
  if (normalized === "robotics" || ROBOTICS_CLASS_REGEX.test(normalized)) {
    return [4, 8];
  }
  return [5, 9];
}

export function resolveCheckpointSessionsForClass(
  classCode: string,
  syllabusList?: Array<Pick<CourseSyllabus, "courseCode" | "checkpointSessions">>
): number[] {
  const upperCode = String(classCode || "").trim().toUpperCase();
  if (Array.isArray(syllabusList) && syllabusList.length > 0 && upperCode) {
    const sorted = [...syllabusList].sort(
      (a, b) => String(b.courseCode || "").length - String(a.courseCode || "").length
    );
    const matched = sorted.find((c) => {
      const code = String(c.courseCode || "").trim().toUpperCase();
      return Boolean(code && upperCode.includes(code));
    });
    if (matched && Array.isArray(matched.checkpointSessions)) {
      const validNums = matched.checkpointSessions
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 13);
      return Array.from(new Set(validNums)).sort((a, b) => a - b);
    }
  }
  return getDefaultCheckpointSessions(upperCode);
}

export function isCheckpointSession(
  classCode: string,
  sessionNumber: number,
  syllabusList?: Array<Pick<CourseSyllabus, "courseCode" | "checkpointSessions">>
): boolean {
  const num = Number(sessionNumber);
  if (!Number.isInteger(num) || num < 1 || num >= 14) return false;
  const checkpoints = resolveCheckpointSessionsForClass(classCode, syllabusList);
  return checkpoints.includes(num);
}

export function isSession14QuickTagCategory(
  catOrTag?: {
    category?: string;
    categoryName?: string;
    track?: string;
    id?: string;
  } | null
): boolean {
  if (!catOrTag) return false;
  const track = String(catOrTag.track || "").trim().toLowerCase();
  if (track === "session14" || track === "spck") return true;
  if (track === "coding" || track === "robotics" || track === "common") return false;

  const cat = String(catOrTag.category || "").trim().toLowerCase();
  const catName = String(catOrTag.categoryName || "").trim().toLowerCase();
  const id = String(catOrTag.id || "").trim().toLowerCase();

  return (
    cat.startsWith("spck_") ||
    cat.includes("session14") ||
    id.startsWith("s14_") ||
    /buổi\s*14|spck/i.test(catName)
  );
}

export function classifyQuickTagTrack(
  tagOrCat: {
    id?: string;
    category?: string;
    categoryName?: string;
    track?: string;
  }
): QuickTagTrack {
  const track = String(tagOrCat.track || "").trim().toLowerCase();
  if (track === "session14" || track === "spck") return "session14";
  if (track === "robotics") return "robotics";
  if (track === "coding") return "coding";
  if (track === "common") return "common";

  if (isSession14QuickTagCategory(tagOrCat)) {
    return "session14";
  }

  const cat = String(tagOrCat.category || "").toLowerCase();
  const catName = String(tagOrCat.categoryName || "").toLowerCase();
  const id = String(tagOrCat.id || "").toLowerCase();

  if (
    cat.includes("robot") ||
    cat.startsWith("rob_") ||
    id.startsWith("rob_") ||
    /robot|lắp ráp|cơ khí|cảm biến|🤖/i.test(catName)
  ) {
    return "robotics";
  }
  if (
    cat === "execution" ||
    cat.includes("coding") ||
    cat.startsWith("code_") ||
    cat.startsWith("exec_") ||
    id.startsWith("code_") ||
    id.startsWith("exec_") ||
    /lập trình|code|cú pháp|💻/i.test(catName)
  ) {
    return "coding";
  }
  return "common";
}

export function filterRegularSessionQuickTagCategories(
  categories: QuickTagCategory[]
): QuickTagCategory[] {
  if (!Array.isArray(categories)) return [];
  return categories.filter((cat) => !isSession14QuickTagCategory(cat));
}

const SESSION14_TAG_TEXT_REGEX =
  /^s14_|slide thuyết trình|phụ thuộc.*vào ai|bố cục.*flexbox|thuyết trình còn nhỏ|sản phẩm chạy mượt/i;

export function isSession14QuickTagValue(
  rawTag: string,
  configuredCategories?: QuickTagCategory[]
): boolean {
  const clean = String(rawTag || "").trim();
  if (!clean) return false;
  const lower = clean.toLowerCase();
  if (SESSION14_TAG_TEXT_REGEX.test(lower)) return true;

  if (Array.isArray(configuredCategories)) {
    for (const cat of configuredCategories) {
      if (!isSession14QuickTagCategory(cat)) continue;
      for (const t of cat?.tags || []) {
        if (
          String(t?.id || "").trim().toLowerCase() === lower ||
          String(t?.label || "").trim().toLowerCase() === lower
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

export function filterRegularQuickTagValues(
  rawTags?: string[],
  configuredCategories?: QuickTagCategory[]
): string[] {
  if (!Array.isArray(rawTags)) return [];
  return rawTags
    .map((t) => String(t || "").trim())
    .filter((t) => Boolean(t) && !isSession14QuickTagValue(t, configuredCategories));
}

export function classifyStudentSkillLevel(
  rawTags?: string[],
  configuredCategories?: QuickTagCategory[]
): SkillLevelClassification {
  const tags = filterRegularQuickTagValues(rawTags, configuredCategories);

  if (tags.length === 0) {
    return {
      levelCode: 0,
      label: "Chưa chọn thẻ",
      description:
        "Cấp độ 2 - Khá: Nắm được kiến thức trọng tâm, thái độ học tập nghiêm túc, hoàn thành đúng yêu cầu bài thực hành nhưng cần thêm thời gian hoặc gợi ý ở các phần mở rộng/tối ưu hóa.",
      badgeClass: "bg-slate-800 text-slate-400 border-slate-700",
    };
  }

  const tagLookup = new Map<string, QuickTag>();
  if (Array.isArray(configuredCategories)) {
    for (const cat of configuredCategories) {
      if (isSession14QuickTagCategory(cat)) continue;
      for (const t of cat?.tags || []) {
        if (t?.label) tagLookup.set(t.label.trim().toLowerCase(), t);
        if (t?.id) tagLookup.set(t.id.trim().toLowerCase(), t);
      }
    }
  }

  let hasExcellent = false;
  let hasGood = false;
  let hasSlow = false;
  let hasDistracted = false;
  let hasImprove = false;
  let positiveCount = 0;

  for (const raw of tags) {
    const lower = raw.toLowerCase();
    const matched = tagLookup.get(lower);
    const role = String(matched?.role || "").trim().toLowerCase();

    if (role) {
      if (role === "excellent") {
        hasExcellent = true;
        positiveCount++;
      } else if (role === "distracted") {
        hasDistracted = true;
      } else if (role === "slow") {
        hasSlow = true;
      } else if (role === "improve") {
        hasImprove = true;
      } else if (role === "good" || role === "positive") {
        hasGood = true;
        positiveCount++;
      }
      continue;
    }

    if (/xuất sắc|giỏi|vận dụng.*sáng tạo|sáng tạo|🌟|💡|lvl_.*xuat_sac|tier_1/i.test(lower)) {
      hasExcellent = true;
      positiveCount++;
      continue;
    }

    if (
      /mất tập trung|xao nhãng|nói chuyện riêng|làm việc riêng|cần tập trung hơn|👀|tier_3/i.test(
        lower
      )
    ) {
      hasDistracted = true;
      continue;
    }

    if (/thao tác.*chậm|cú pháp còn chậm|lúng túng|hay nhầm lệnh|⌨️|🔌|🐛/i.test(lower)) {
      hasImprove = true;
      continue;
    }

    if (
      /tiếp thu chậm|lắp ráp còn chậm|nhầm chốt|cần kèm|trung bình|chưa kịp|🐢|🔩|🛠️|lvl_.*can_kem|tier_4|tier_5/i.test(
        lower
      )
    ) {
      hasSlow = true;
      continue;
    }

    if (
      /tiếp thu tốt|làm bài tập đầy đủ|lắp ráp.*lập trình tốt|hăng hái|phối hợp nhóm|giữ kit tốt|đạt yêu cầu|khá|tốt|tích cực|hiểu bài nhanh|👍|✅|📝|🙋|🤖|🤝|lvl_.*dat|tier_2/i.test(
        lower
      )
    ) {
      hasGood = true;
      positiveCount++;
    }
  }

  // Promote to Excellent if teacher ticked 3+ positive tags with zero constructive tags (e.g. all 3 Robotics positive tags)
  if (positiveCount >= 3 && !hasSlow && !hasDistracted && !hasImprove) {
    hasExcellent = true;
  }

  const needsSupport = hasSlow || (hasImprove && !hasGood && !hasExcellent);

  if (needsSupport && hasDistracted) {
    return {
      levelCode: 5,
      label: "Cấp độ 5 - Trung bình, mất tập trung",
      description:
        "Cấp độ 5 - Trung bình, mất tập trung: Chưa nắm chắc kiến thức cơ bản của buổi học do chưa thực sự tập trung lắng nghe khi thầy giảng giải, cần sự sát sao nhiều hơn để theo kịp tiến độ.",
      badgeClass: "bg-rose-500/20 text-rose-300 border-rose-500/40",
    };
  }

  if (needsSupport) {
    return {
      levelCode: 4,
      label: "Cấp độ 4 - Trung bình",
      description:
        "Cấp độ 4 - Trung bình: Có sự cố gắng và thái độ hợp tác tốt nhưng tốc độ tiếp thu và thao tác thực hành còn chậm, cần thầy hướng dẫn từng bước để hoàn thành sản phẩm.",
      badgeClass: "bg-orange-500/20 text-orange-300 border-orange-500/40",
    };
  }

  if (hasDistracted && (hasGood || hasExcellent)) {
    return {
      levelCode: 3,
      label: "Cấp độ 3 - Khá nhưng mất tập trung",
      description:
        "Cấp độ 3 - Khá nhưng mất tập trung: Tư duy nhạy bén, hiểu bài nhanh nhưng đôi lúc còn xao nhãng, làm việc riêng hoặc thao tác vội vàng dẫn đến lỗi nhỏ không đáng có.",
      badgeClass: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    };
  }

  if (hasDistracted) {
    return {
      levelCode: 5,
      label: "Cấp độ 5 - Trung bình, mất tập trung",
      description:
        "Cấp độ 5 - Trung bình, mất tập trung: Chưa nắm chắc kiến thức cơ bản của buổi học do chưa thực sự tập trung lắng nghe khi thầy giảng giải, cần sự sát sao nhiều hơn để theo kịp tiến độ.",
      badgeClass: "bg-rose-500/20 text-rose-300 border-rose-500/40",
    };
  }

  if (hasExcellent && !hasImprove) {
    return {
      levelCode: 1,
      label: "Cấp độ 1 - Giỏi",
      description:
        "Cấp độ 1 - Giỏi: Tiếp thu nhanh, nắm vững tư duy thuật toán và công nghệ, chủ động hoàn thành tốt bài tập cơ bản lẫn nâng cao, có sự sáng tạo.",
      badgeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    };
  }

  return {
    levelCode: 2,
    label: "Cấp độ 2 - Khá",
    description:
      "Cấp độ 2 - Khá: Nắm được kiến thức trọng tâm, thái độ học tập nghiêm túc, hoàn thành đúng yêu cầu bài thực hành nhưng cần thêm thời gian hoặc gợi ý ở các phần mở rộng/tối ưu hóa.",
    badgeClass: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
  };
}

const CODING_VALID_LABELS = new Set<string>([
  "✅ Tiếp thu tốt",
  "📝 Làm bài tập đầy đủ",
  "🙋 Hăng hái phát biểu",
  "💡 Vận dụng & Sáng tạo tốt",
  "🐢 Tiếp thu chậm",
  "👀 Mất tập trung",
  "⌨️ Thao tác / Cú pháp còn chậm",
]);

const ROBOTICS_VALID_LABELS = new Set<string>([
  "🤖 Lắp ráp & Lập trình tốt",
  "🙋 Hăng hái phát biểu",
  "🤝 Phối hợp nhóm & Giữ Kit tốt",
  "👀 Mất tập trung",
  "🔩 Lắp ráp còn chậm / Nhầm chốt",
  "🔌 Lập trình / Đấu mạch còn lúng túng",
]);

export function normalizeQuickTagsForTrack(
  rawTags: string[] | undefined | null,
  track: "coding" | "robotics"
): string[] {
  if (!Array.isArray(rawTags) || rawTags.length === 0) return [];
  const validSet = track === "robotics" ? ROBOTICS_VALID_LABELS : CODING_VALID_LABELS;
  const result: string[] = [];
  const addUnique = (label: string) => {
    if (label && !result.includes(label)) {
      result.push(label);
    }
  };

  for (const raw of rawTags) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) continue;
    if (validSet.has(trimmed)) {
      addUnique(trimmed);
      continue;
    }
    const lower = trimmed.toLowerCase();
    if (
      /^s14_|slide thuyết trình|phụ thuộc.*vào ai|bố cục.*flexbox|thuyết trình còn nhỏ|sản phẩm chạy mượt/i.test(
        lower
      )
    ) {
      continue;
    }
    if (/xuất sắc|sáng tạo|vận dụng tốt|🌟|💡/i.test(lower)) {
      addUnique(
        track === "robotics" ? "🤖 Lắp ráp & Lập trình tốt" : "💡 Vận dụng & Sáng tạo tốt"
      );
    } else if (/hăng hái|phát biểu|🙋/i.test(lower)) {
      addUnique("🙋 Hăng hái phát biểu");
    } else if (/làm bài tập đầy đủ|📝/i.test(lower)) {
      addUnique(
        track === "robotics" ? "🤖 Lắp ráp & Lập trình tốt" : "📝 Làm bài tập đầy đủ"
      );
    } else if (/phối hợp nhóm|giữ kit|🤝/i.test(lower)) {
      addUnique(
        track === "robotics" ? "🤝 Phối hợp nhóm & Giữ Kit tốt" : "✅ Tiếp thu tốt"
      );
    } else if (/mất tập trung|xao nhãng|nói chuyện|làm việc riêng|👀/i.test(lower)) {
      addUnique("👀 Mất tập trung");
    } else if (/tiếp thu chậm|nhầm chốt|lắp ráp còn chậm|cần kèm thêm|🐢|🔩|🛠️/i.test(lower)) {
      addUnique(
        track === "robotics" ? "🔩 Lắp ráp còn chậm / Nhầm chốt" : "🐢 Tiếp thu chậm"
      );
    } else if (/thao tác.*chậm|cú pháp.*chậm|đấu mạch|lúng túng|⌨️|🔌/i.test(lower)) {
      addUnique(
        track === "robotics"
          ? "🔌 Lập trình / Đấu mạch còn lúng túng"
          : "⌨️ Thao tác / Cú pháp còn chậm"
      );
    } else if (/đạt yêu cầu|tiếp thu tốt|lắp ráp.*tốt|tập trung tốt|chăm chỉ|👍|✅|🤖/i.test(lower)) {
      addUnique(
        track === "robotics" ? "🤖 Lắp ráp & Lập trình tốt" : "✅ Tiếp thu tốt"
      );
    }
  }

  return result;
}
