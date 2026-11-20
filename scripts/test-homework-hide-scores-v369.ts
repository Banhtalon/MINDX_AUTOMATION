import assert from "node:assert/strict";
import {
  getHomeworkColumnShortLabel,
  getHomeworkCompletionItems,
  resolveHomeworkCompletionState,
} from "../src/lib/report-card/homework-completion-helpers";

console.log("=== BẮT ĐẦU KIỂM THỬ ẨN/HIỆN ĐIỂM SỐ BTVN (/homework-grader) ===");

// 1. Short column labels
assert.equal(getHomeworkColumnShortLabel("Homework 1", 1), "HW 1");
assert.equal(getHomeworkColumnShortLabel("Homework 12", 12), "HW 12");
assert.equal(getHomeworkColumnShortLabel("Buổi 3", 3), "HW 3");
assert.equal(getHomeworkColumnShortLabel("Bài tập nâng cao cuối khóa", 5), "HW 5");

// 2. Completion state rules
assert.deepEqual(resolveHomeworkCompletionState(null), {
  practiceDone: false,
  quizDone: false,
});
assert.deepEqual(
  resolveHomeworkCompletionState({ status: "GRADED", score: 0, quizScore: null }),
  { practiceDone: true, quizDone: false }
);
assert.deepEqual(
  resolveHomeworkCompletionState({ status: "SUBMITTED_UNGRADED", score: null, quizScore: 86 }),
  { practiceDone: true, quizDone: true }
);
assert.deepEqual(
  resolveHomeworkCompletionState({ status: "NOT_SUBMITTED", score: null, quizScore: 60 }),
  { practiceDone: false, quizDone: true }
);
assert.deepEqual(
  resolveHomeworkCompletionState({ status: "REDO_REQUESTED", score: null, quizScore: null }),
  { practiceDone: false, quizDone: false }
);

// 3. Cách A ("both" mode) -> TH & Q separate pills
const bothItems = getHomeworkCompletionItems(
  { status: "SUBMITTED_UNGRADED", score: null, quizScore: null },
  "both"
);
assert.deepEqual(bothItems, [
  { key: "practice", prefix: "TH", done: true, label: "Đã làm" },
  { key: "quiz", prefix: "Q", done: false, label: "Chưa làm" },
]);

// 4. "practice" mode -> single pill
const practiceItems = getHomeworkCompletionItems(
  { status: "NOT_SUBMITTED", score: null, quizScore: 90 },
  "practice"
);
assert.deepEqual(practiceItems, [
  { key: "practice", prefix: null, done: false, label: "Chưa làm" },
]);

// 5. "quiz" mode -> single pill
const quizItems = getHomeworkCompletionItems(
  { status: "NOT_SUBMITTED", score: null, quizScore: 60 },
  "quiz"
);
assert.deepEqual(quizItems, [
  { key: "quiz", prefix: null, done: true, label: "Đã làm" },
]);

console.log("✅ TẤT CẢ KIỂM THỬ ẨN/HIỆN ĐIỂM SỐ BTVN ĐỀU PASS 100%!");
