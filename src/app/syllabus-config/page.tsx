import { getCoursesSyllabus, getGradingRubrics, getQuickTags, getZaloTemplates } from "@/lib/db/json-config";

export default function SyllabusConfigPage() {
  const courses = getCoursesSyllabus();
  const rubrics = getGradingRubrics();
  const tagCategories = getQuickTags();
  const templates = getZaloTemplates();

  return (
    <div className="space-y-6">
      <div className="p-6 rounded-xl bg-slate-900 border border-slate-800">
        <div className="flex items-center space-x-3">
          <span className="text-3xl">⚙️</span>
          <div>
            <h1 className="text-2xl font-bold text-white">Màn hình 4: Quản lý Giáo trình, Barem & Mẫu Zalo</h1>
            <p className="text-sm text-slate-400">Xem và cấu hình nội dung bài học, đề bài, barem chấm điểm, quick tags và mẫu Zalo.</p>
          </div>
        </div>
      </div>

      {/* Tabs / Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Courses Section */}
        <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
          <h2 className="text-lg font-bold text-white flex items-center justify-between">
            <span>Danh sách Khóa học ({courses.length})</span>
            <span className="text-xs text-slate-400">data/config/courses_syllabus.json</span>
          </h2>
          <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
            {courses.map((course) => (
              <div key={course.courseCode} className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-orange-400">{course.courseCode}</span>
                  <span className="text-xs text-slate-500">{course.sessions.length} buổi học</span>
                </div>
                <div className="text-sm font-medium text-slate-200 mt-1">{course.courseName}</div>
                <div className="text-xs text-slate-400 mt-0.5">{course.description}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Rubrics Section */}
        <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
          <h2 className="text-lg font-bold text-white flex items-center justify-between">
            <span>Barem Chấm điểm Mẫu ({rubrics.length})</span>
            <span className="text-xs text-slate-400">data/config/grading_rubrics.json</span>
          </h2>
          <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
            {rubrics.map((rubric) => (
              <div key={rubric.rubricId} className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-cyan-400">{rubric.rubricId}</span>
                  <span className="text-xs text-slate-400">Thang {rubric.maxTotalScore} điểm</span>
                </div>
                <div className="text-sm font-medium text-slate-200 mt-1">{rubric.assignmentTitle}</div>
                <div className="text-xs text-slate-400 mt-1">{rubric.assignmentPrompt}</div>
                <div className="mt-2 text-xs text-slate-500">
                  {rubric.criteria.length} tiêu chí: {rubric.criteria.map((c) => c.name).join(" • ")}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Tags Section */}
        <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
          <h2 className="text-lg font-bold text-white flex items-center justify-between">
            <span>Bộ thẻ Quick Tags 1 Chạm</span>
            <span className="text-xs text-slate-400">data/config/quick_tags.json</span>
          </h2>
          <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
            {tagCategories.map((cat) => (
              <div key={cat.category} className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-sm font-semibold text-slate-300 mb-2">{cat.categoryName}</div>
                <div className="flex flex-wrap gap-1.5">
                  {cat.tags.map((t) => (
                    <span
                      key={t.id}
                      className={`text-xs px-2.5 py-1 rounded-md border ${
                        t.sentiment === "positive"
                          ? "bg-emerald-950/40 border-emerald-800 text-emerald-300"
                          : t.sentiment === "constructive"
                          ? "bg-amber-950/40 border-amber-800 text-amber-300"
                          : "bg-slate-800 border-slate-700 text-slate-300"
                      }`}
                    >
                      {t.label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Zalo Templates Section */}
        <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
          <h2 className="text-lg font-bold text-white flex items-center justify-between">
            <span>Mẫu Thông Báo Zalo ({templates.length})</span>
            <span className="text-xs text-slate-400">data/config/zalo_templates.json</span>
          </h2>
          <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
            {templates.map((tpl) => (
              <div key={tpl.id} className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-sm font-semibold text-emerald-400">{tpl.name}</div>
                <pre className="mt-2 text-xs text-slate-400 font-mono bg-slate-900 p-2.5 rounded border border-slate-850 whitespace-pre-wrap max-h-36 overflow-y-auto">
                  {tpl.template}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
