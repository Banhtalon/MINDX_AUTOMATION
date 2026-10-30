export interface SessionProgressMilestone {
  sessionNumber: number;
  isKnownSession: boolean;
  milestoneTaskCount: 0 | 1 | 2 | 3 | 4 | 5;
  targetPercent: 0 | 20 | 40 | 60 | 80 | 100;
  label: string;
  buttonLabel: string;
}

/**
 * Ánh xạ buổi học hiện tại của lớp sang mốc tiến độ Dự án Cuối khóa (Teaching):
 * - Chưa rõ buổi (0) -> 0% (0/5 công việc, khóa nút 1 chạm để tránh đẩy nhầm)
 * - Buổi 1..10       -> 0% (0/5 công việc)
 * - Buổi 11          -> 20% (1/5 công việc)
 * - Buổi 12          -> 60% (3/5 công việc — GĐ1 SPCK)
 * - Buổi 13          -> 80% (4/5 công việc — GĐ2 SPCK)
 * - Buổi >= 14       -> 100% (5/5 công việc — Tổng kết & Demo SPCK)
 */
export function mapSessionToTeachingProgressMilestone(
  rawSessionNumber: number
): SessionProgressMilestone {
  const num = Number.isFinite(Number(rawSessionNumber))
    ? Math.max(0, Math.floor(Number(rawSessionNumber)))
    : 0;

  if (num <= 0) {
    return {
      sessionNumber: 0,
      isKnownSession: false,
      milestoneTaskCount: 0,
      targetPercent: 0,
      label: "Chưa xác định buổi hiện tại • 0% (0/5 việc)",
      buttonLabel:
        "🚀 Cập nhật tiến độ theo buổi hiện tại (Chưa rõ buổi → Mở ⚙️ Nâng cao)",
    };
  }

  if (num >= 14) {
    return {
      sessionNumber: 14,
      isKnownSession: true,
      milestoneTaskCount: 5,
      targetPercent: 100,
      label: "Buổi 14 • Hoàn thành 100% (5/5 việc)",
      buttonLabel: "🚀 Cập nhật tiến độ theo buổi hiện tại (Buổi 14 → 100%)",
    };
  }

  if (num === 13) {
    return {
      sessionNumber: 13,
      isKnownSession: true,
      milestoneTaskCount: 4,
      targetPercent: 80,
      label: "Buổi 13 • 80% (4/5 việc)",
      buttonLabel: "🚀 Cập nhật tiến độ theo buổi hiện tại (Buổi 13 → 80%)",
    };
  }

  if (num === 12) {
    return {
      sessionNumber: 12,
      isKnownSession: true,
      milestoneTaskCount: 3,
      targetPercent: 60,
      label: "Buổi 12 • 60% (3/5 việc)",
      buttonLabel: "🚀 Cập nhật tiến độ theo buổi hiện tại (Buổi 12 → 60%)",
    };
  }

  if (num === 11) {
    return {
      sessionNumber: 11,
      isKnownSession: true,
      milestoneTaskCount: 1,
      targetPercent: 20,
      label: "Buổi 11 • 20% (1/5 việc)",
      buttonLabel: "🚀 Cập nhật tiến độ theo buổi hiện tại (Buổi 11 → 20%)",
    };
  }

  const displaySession = `Buổi ${num}`;
  return {
    sessionNumber: num,
    isKnownSession: true,
    milestoneTaskCount: 0,
    targetPercent: 0,
    label: `${displaySession} • 0% (0/5 việc)`,
    buttonLabel: `🚀 Cập nhật tiến độ theo buổi hiện tại (${displaySession} → 0%)`,
  };
}

export interface SpckTeachingProgressSuggestion {
  shouldShow: boolean;
  sessionNumber: number;
  milestoneTaskCount: 0 | 1 | 2 | 3 | 4 | 5;
  targetPercent: 0 | 20 | 40 | 60 | 80 | 100;
  buttonText: string;
  description: string;
}

/**
 * S6.2: Chỉ hiển thị thẻ gợi ý cập nhật tiến độ Teaching sau khi nộp SPCK Buổi 12/13/14
 * đã có ít nhất 1 học viên VERIFIED trên LMS.
 */
export function getSpckVerifiedTeachingProgressSuggestion(params: {
  sessionNumber: number;
  verifiedCount: number;
  pendingOrFailedCount?: number;
}): SpckTeachingProgressSuggestion {
  const sess = Number(params.sessionNumber);
  const verified = Number(params.verifiedCount) || 0;
  const pendingOrFailed = Math.max(0, Number(params.pendingOrFailedCount) || 0);
  const milestone = mapSessionToTeachingProgressMilestone(sess);

  if (verified <= 0 || pendingOrFailed > 0 || ![12, 13, 14].includes(sess)) {
    return {
      shouldShow: false,
      sessionNumber: sess,
      milestoneTaskCount: milestone.milestoneTaskCount,
      targetPercent: milestone.targetPercent,
      buttonText: `📈 Cập nhật tiến độ Teaching lên ${milestone.targetPercent}%`,
      description: "",
    };
  }

  return {
    shouldShow: true,
    sessionNumber: sess,
    milestoneTaskCount: milestone.milestoneTaskCount,
    targetPercent: milestone.targetPercent,
    buttonText: `📈 Cập nhật tiến độ Teaching lên ${milestone.targetPercent}%`,
    description: `Đã nộp & xác minh ${verified} bài SPCK Buổi ${sess} trên LMS. Bấm 1 chạm để đẩy tiến độ cả lớp lên ${milestone.targetPercent}% (${milestone.milestoneTaskCount}/5 công việc) trên Teaching.`,
  };
}
