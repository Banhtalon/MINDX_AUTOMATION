export default function HomeworkGraderPage() {
  return (
    <div className="p-8 rounded-xl bg-slate-900 border border-slate-800">
      <div className="flex items-center space-x-3 mb-4">
        <span className="text-3xl">📊</span>
        <div>
          <h1 className="text-2xl font-bold text-white">Màn hình 2: Bảng điểm Báo cáo & Tự chấm Bài tập</h1>
          <p className="text-sm text-slate-400">Không gian làm việc cho Giai đoạn 4 & 5: Luồng Cào điểm & Tự chấm bài theo Barem.</p>
        </div>
      </div>
      <div className="p-4 rounded-lg bg-slate-850 border border-slate-750 text-slate-300 text-sm">
        Sẽ được triển khai toàn diện tại Giai đoạn 4 và Giai đoạn 5 theo <code>@MINDX_AUTOMATION_PLAN.md</code>.
      </div>
    </div>
  );
}
