"use client";

import React from "react";
import {
  CheckCircle2,
  Image as ImageIcon,
  Link2,
  Loader2,
  Rocket,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { SpckWorkflowController } from "./useSpckWorkflow";

export interface ToolsDrawerProps {
  workflow: SpckWorkflowController;
}

export function ToolsDrawer({ workflow }: ToolsDrawerProps) {
  const {
    totalStepsCount,
    rows,
    selectedSessionNumber,
    handleGenerateAiComments,
    handleGenerateSession14AllAi,
    generatingS14EvalAi,
    isAnyOperationBusy,
    generatingAi,
    isAppOrGameProduct,
    handleCaptureAppScreenshots,
    capturingScreenshots,
    isWebClassOrProduct,
    handleDeployWebToGithubPages,
    selectedClassId,
    deployingWeb,
    showOptionalTools,
    setShowOptionalTools,
    studentPortalRunning,
    showDemoPrepPanel,
    setShowDemoPrepPanel,
    generatedDemoSheetUrl,
    studentPortalSubmissions,
    students,
    studentPortalAutoDrive,
    handleTogglePortalAutoDrive,
    handleStartStudentPortal,
    togglingStudentPortal,
    handleStopStudentPortal,
    studentPortalTunnelProvider,
    studentPortalTunnelStatus,
    studentPortalPublicUrl,
    studentPortalShareUrl,
    studentPortalLanUrl,
    studentPortalLocalUrl,
    setBannerMessage,
    showPortalQr,
    setShowPortalQr,
    driveFolderUrl,
    setDriveFolderUrl,
    handleUploadToGoogleDrive,
    uploadingDrive,
    webRepoUrl,
    setWebRepoUrl,
    templateSheetUrl,
    setTemplateSheetUrl,
    demoDateInput,
    setDemoDateInput,
    handleCreateDemoScoringSheet,
    creatingDemoSheet,
    demoSheetTitle,
    demoScoreSourceInput,
    setDemoScoreSourceInput,
    handleImportDemoScores,
    importingDemoScores,
    session14Evals,
    setExpandedRowKeys,
    setRowActiveTab,
    autoRunToolsAfterScan,
  } = workflow;

  const s14VerifiedCount = (session14Evals || []).filter(
    (ev) => ev.status === "VERIFIED"
  ).length;
  const s14ReadyLetterCount = (session14Evals || []).filter(
    (ev) =>
      ev.learnedFromMindx?.trim() &&
      ev.suggestionsFromMindx?.trim() &&
      ev.futureDirection?.trim()
  ).length;

  const handleOpenAllTab2 = () => {
    const nextExpanded: Record<string, boolean> = {};
    rows.forEach((r, idx) => {
      const key = r.folderPath || r.assignedStudentId || String(idx);
      nextExpanded[key] = true;
      if (r.assignedStudentId) {
        setRowActiveTab(r.assignedStudentId, "eval14");
      }
    });
    setExpandedRowKeys((prev) => ({ ...prev, ...nextExpanded }));
  };

  return (
    <>
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 pb-3 border-b border-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          <span className="spck-pill-primary px-2.5 py-0.5 rounded-full text-xs font-bold">
            Bước 2 / {totalStepsCount}
          </span>
          <h2 className="text-sm sm:text-base font-extrabold text-white">
            Danh Sách Bài Làm &amp; Nhận Xét ({rows.length} học viên)
          </h2>
        </div>

        {/* Primary Preparation Actions & Collapsible Tool Toggles */}
        <div className="flex flex-wrap items-center gap-2">
          {selectedSessionNumber === 14 ? (
            <button
              type="button"
              onClick={() => handleGenerateSession14AllAi()}
              disabled={isAnyOperationBusy || rows.length === 0}
              className="spck-btn-primary flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg disabled:opacity-50 text-xs font-bold transition-colors cursor-pointer"
            >
              {generatingAi || generatingS14EvalAi ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>✨ AI soạn tất cả (SPCK + Thư 3 phần)</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleGenerateAiComments()}
              disabled={isAnyOperationBusy || rows.length === 0}
              className="spck-btn-primary flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg disabled:opacity-50 text-xs font-bold transition-colors cursor-pointer"
            >
              {generatingAi ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>AI Soạn Nhận Xét Cả Lớp</span>
            </button>
          )}

          {!autoRunToolsAfterScan && isAppOrGameProduct && (
            <button
              type="button"
              onClick={() => handleCaptureAppScreenshots()}
              disabled={isAnyOperationBusy || rows.length === 0}
              title="Tự động mở giao diện App (.ui) hoặc Website (.html) của học viên để chụp hình 16:9 và AI chọn Thumbnail"
              className="spck-pill-neutral flex items-center space-x-1.5 px-3 py-1.5 rounded-lg disabled:opacity-50 text-xs font-semibold transition-colors cursor-pointer"
            >
              {capturingScreenshots ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ImageIcon className="w-3.5 h-3.5" />
              )}
              <span>
                {isWebClassOrProduct ? "Chụp Giao Diện Web" : "Chụp Giao Diện App"}
              </span>
            </button>
          )}

          {!autoRunToolsAfterScan && isWebClassOrProduct && (
            <button
              type="button"
              onClick={() => handleDeployWebToGithubPages()}
              disabled={isAnyOperationBusy || !selectedClassId || rows.length === 0}
              title="Đẩy sản phẩm Web (.html) lên GitHub Pages và gắn Link chạy thử"
              className="spck-pill-neutral flex items-center space-x-1.5 px-3 py-1.5 rounded-lg disabled:opacity-50 text-xs font-semibold transition-colors cursor-pointer"
            >
              {deployingWeb ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Rocket className="w-3.5 h-3.5" />
              )}
              <span>Chạy Thử Web (GitHub Pages)</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowOptionalTools((v) => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              showOptionalTools || studentPortalRunning
                ? "spck-pill-primary"
                : "spck-pill-neutral"
            }`}
          >
            {showOptionalTools
              ? "Thu gọn Công cụ Drive & Thu bài ▴"
              : "Công cụ Drive & Cổng thu bài (Tùy chọn) ▾"}
          </button>

          <button
            type="button"
            onClick={() => setShowDemoPrepPanel((v) => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              showDemoPrepPanel || Boolean(generatedDemoSheetUrl)
                ? "spck-pill-primary"
                : "spck-pill-neutral"
            }`}
          >
            {showDemoPrepPanel
              ? "Thu gọn Chuẩn bị Demo ▴"
              : "Chuẩn bị Demo (Bảng chấm điểm) ▾"}
          </button>
        </div>
      </div>

      {/* Collapsible Panel A: Optional Drive, Student Upload Portal & Web/App Tools */}
      {(showOptionalTools || studentPortalRunning) && (
        <div className="spck-clean-subbar p-3.5 rounded-xl space-y-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300 uppercase">
              Công cụ tùy chọn: Cổng thu bài học sinh, Google Drive &amp; Cấu hình chạy thử
            </span>
          </div>

          {/* Student Direct SPCK Upload Portal */}
          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-700 space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="spck-pill-primary px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
                    Cổng Thu Bài Học Sinh
                  </span>
                  <span className="text-xs font-bold text-white">
                    Học Sinh Tự Nộp Sản Phẩm &rarr; Tự Lưu Máy Thầy &amp; Tự Động Lên Google Drive
                  </span>
                  {studentPortalRunning && (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 text-[11px] font-semibold">
                      ● Đang mở cho lớp {selectedClassId} (Đã nộp:{" "}
                      {studentPortalSubmissions.length}/{students.length || rows.length} HV)
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-300">
                  Bấm mở cổng để lấy <strong>Link nộp bài (hoặc Mã QR)</strong> gửi cho học sinh.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <label className="inline-flex items-center space-x-1.5 text-xs text-slate-200 cursor-pointer bg-slate-900/90 px-2.5 py-1.5 rounded-lg border border-slate-700">
                  <input
                    type="checkbox"
                    checked={studentPortalAutoDrive}
                    onChange={(e) => handleTogglePortalAutoDrive(e.target.checked)}
                    className="rounded border-slate-600"
                  />
                  <span>Tự động Up lên Drive khi HS nộp</span>
                </label>

                {!studentPortalRunning ? (
                  <button
                    type="button"
                    onClick={handleStartStudentPortal}
                    disabled={togglingStudentPortal || isAnyOperationBusy || !selectedClassId}
                    className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold text-xs transition-colors cursor-pointer"
                  >
                    {togglingStudentPortal ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Link2 className="w-3.5 h-3.5" />
                    )}
                    <span>Mở Link Cho Học Sinh Nộp Bài</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStopStudentPortal}
                    disabled={togglingStudentPortal}
                    className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/70 border border-rose-500/50 text-rose-200 font-semibold text-xs transition-colors cursor-pointer"
                  >
                    <span>Đóng Cổng Thu Bài</span>
                  </button>
                )}
              </div>
            </div>

            {studentPortalRunning && (
              <div className="pt-2.5 border-t border-slate-800/80 space-y-2.5">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
                  <div className="md:col-span-7">
                    <div className="text-[11px] text-slate-400 mb-1 flex items-center justify-between">
                      <span>
                        🌐 <strong>Link gửi học sinh ({studentPortalTunnelProvider}):</strong>
                      </span>
                      {studentPortalTunnelStatus === "STARTING" && (
                        <span className="text-amber-300 animate-pulse">
                          ⏳ Đang tạo Link Internet toàn cầu (~3-5 giây)...
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      readOnly
                      value={
                        studentPortalPublicUrl ||
                        studentPortalShareUrl ||
                        studentPortalLanUrl ||
                        studentPortalLocalUrl
                      }
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-emerald-600/60 text-emerald-300 text-xs font-mono"
                    />
                  </div>

                  <div className="md:col-span-5 flex flex-wrap items-center gap-2 pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        const urlToCopy =
                          studentPortalPublicUrl ||
                          studentPortalShareUrl ||
                          studentPortalLanUrl ||
                          studentPortalLocalUrl;
                        navigator.clipboard?.writeText(urlToCopy);
                        setBannerMessage({
                          type: "success",
                          text: `Đã copy Link nộp bài cho học sinh: ${urlToCopy}`,
                        });
                      }}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
                    >
                      📋 Copy Link Gửi Học Sinh
                    </button>

                    <a
                      href={studentPortalLocalUrl || studentPortalShareUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
                    >
                      Mở Xem Thử Trang HS
                    </a>

                    <button
                      type="button"
                      onClick={() => setShowPortalQr((v) => !v)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-xs font-semibold cursor-pointer"
                    >
                      {showPortalQr ? "Ẩn QR" : "📱 Hiện Mã QR"}
                    </button>
                  </div>
                </div>

                {studentPortalLanUrl && studentPortalPublicUrl && (
                  <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-3">
                    <span>
                      📶 Link dự phòng cùng Wi-Fi lớp học:{" "}
                      <code className="text-sky-300">{studentPortalLanUrl}</code>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(studentPortalLanUrl);
                        setBannerMessage({
                          type: "success",
                          text: `Đã copy Link Wi-Fi nội bộ lớp học: ${studentPortalLanUrl}`,
                        });
                      }}
                      className="underline text-sky-400 hover:text-sky-300 cursor-pointer"
                    >
                      Copy Link Wi-Fi
                    </button>
                  </div>
                )}

                {showPortalQr && (
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center space-x-4">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(
                        studentPortalPublicUrl ||
                          studentPortalShareUrl ||
                          studentPortalLanUrl
                      )}`}
                      alt="QR Nộp Bài SPCK"
                      className="w-28 h-28 rounded bg-white p-1.5 shrink-0"
                    />
                    <div className="text-xs text-slate-300 space-y-1">
                      <div className="font-bold text-white">
                        Mã QR Nộp Sản Phẩm Cuối Khóa — Lớp {selectedClassId}
                      </div>
                      <p className="text-slate-400">
                        Học sinh có thể quét mã QR hoặc mở đường dẫn thầy gửi trong nhóm Zalo để chọn tên và tải sản phẩm lên.
                      </p>
                    </div>
                  </div>
                )}

                {studentPortalSubmissions.length > 0 && (
                  <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800 space-y-1.5">
                    <div className="text-[11px] font-bold text-slate-300 uppercase">
                      📥 Trạng thái Học sinh nộp bài &amp; Tự động đẩy lên Google Drive:
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {studentPortalSubmissions.map((sub) => (
                        <div
                          key={sub.studentId}
                          className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-xs"
                        >
                          <span className="font-semibold text-white">
                            {sub.fullName}
                          </span>
                          <span className="text-slate-400">
                            ({sub.filesCount} file)
                          </span>
                          {sub.driveStatus === "UPLOADED" && sub.driveFolderUrl ? (
                            <a
                              href={sub.driveFolderUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-emerald-400 font-bold hover:underline"
                            >
                              ✅ Đã lên Drive
                            </a>
                          ) : sub.driveStatus === "UPLOADING" ||
                            sub.driveStatus === "QUEUED" ? (
                            <span className="text-amber-300 animate-pulse">
                              ⏳ Đang Up Drive...
                            </span>
                          ) : sub.driveStatus === "FAILED" ? (
                            <span
                              title={sub.driveError || ""}
                              className="text-rose-400"
                            >
                              ⚠️ Chờ Up Drive
                            </span>
                          ) : (
                            <span className="text-sky-300">✅ Đã lưu máy</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Google Drive Auto-Upload & Link Attachment Bar */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-8">
              <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">
                Link Google Drive Gốc (Tự tạo thư mục Lớp &rarr; Học viên &amp; gắn Link vào bài)
              </label>
              <input
                type="text"
                value={driveFolderUrl}
                onChange={(e) => setDriveFolderUrl(e.target.value)}
                disabled={isAnyOperationBusy}
                placeholder="https://drive.google.com/drive/folders/1Xl8OZ7i1bOKf7000xbUBYLPcxVb2qvRD"
                className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-sky-500"
              />
            </div>
            <div className="md:col-span-4">
              <button
                type="button"
                onClick={() => handleUploadToGoogleDrive()}
                disabled={isAnyOperationBusy || !selectedClassId || rows.length === 0}
                className="w-full flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                {uploadingDrive ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <UploadCloud className="w-4 h-4" />
                )}
                <span>Up Sản Phẩm Cả Lớp lên Drive &amp; Gắn Link</span>
              </button>
            </div>
          </div>

          {/* GitHub Pages Web Repo Config & Manual Re-run Tools */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-6">
              <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">
                Kho GitHub Pages Chạy Thử Web Live (Tự động đẩy sau khi Quét hoặc bấm chạy lại bên cạnh)
              </label>
              <input
                type="text"
                value={webRepoUrl}
                onChange={(e) => setWebRepoUrl(e.target.value)}
                disabled={isAnyOperationBusy}
                placeholder="https://github.com/Banhtalon/WEB_PRODUCT_SHOW.git"
                className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="md:col-span-6 flex flex-wrap items-center gap-2">
              {isAppOrGameProduct && (
                <button
                  type="button"
                  onClick={() => handleCaptureAppScreenshots()}
                  disabled={isAnyOperationBusy || rows.length === 0}
                  title="Chụp lại giao diện App (.ui) hoặc Website (.html) 16:9 cho cả lớp"
                  className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  {capturingScreenshots ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ImageIcon className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {isWebClassOrProduct ? "Chụp lại Giao Diện Web" : "Chụp lại Giao Diện App"}
                  </span>
                </button>
              )}
              {isWebClassOrProduct && (
                <button
                  type="button"
                  onClick={() => handleDeployWebToGithubPages()}
                  disabled={isAnyOperationBusy || !selectedClassId || rows.length === 0}
                  title="Đẩy lại sản phẩm Web (.html) lên GitHub Pages và gắn Link chạy thử"
                  className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  {deployingWeb ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Rocket className="w-3.5 h-3.5" />
                  )}
                  <span>Chạy Thử Web (GitHub Pages)</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Collapsible Panel B: Chuẩn bị Demo (Bảng chấm điểm Buổi 14 - cho phép tạo trước Buổi 14) */}
      {(showDemoPrepPanel || Boolean(generatedDemoSheetUrl)) && (
        <div className="spck-clean-subbar p-3.5 rounded-xl space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-6">
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                Link Google Sheet mẫu (Để trống dùng mẫu chuẩn)
              </label>
              <input
                type="text"
                value={templateSheetUrl}
                onChange={(e) => setTemplateSheetUrl(e.target.value)}
                disabled={isAnyOperationBusy}
                placeholder="Dán link Google Sheet mẫu hoặc để trống dùng mẫu chuẩn MindX"
                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                Ngày Demo (Buổi 14)
              </label>
              <input
                type="text"
                value={demoDateInput}
                onChange={(e) => setDemoDateInput(e.target.value)}
                disabled={isAnyOperationBusy}
                placeholder="YYYY-MM-DD"
                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="md:col-span-4">
              <button
                type="button"
                onClick={handleCreateDemoScoringSheet}
                disabled={isAnyOperationBusy || !selectedClassId}
                className="spck-btn-primary w-full flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-lg disabled:opacity-50 font-semibold text-xs transition-colors cursor-pointer"
              >
                {creatingDemoSheet ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                <span>
                  Tạo Google Trang Tính Chấm Demo ({students.length || rows.length} Tab HV)
                </span>
              </button>
            </div>
          </div>

          {generatedDemoSheetUrl && (
            <div className="spck-pill-success p-2.5 rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center space-x-2 truncate">
                <span className="font-bold">
                  📊 {demoSheetTitle}
                </span>
              </div>
              <div className="flex items-center space-x-2 shrink-0">
                <a
                  href={generatedDemoSheetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="spck-btn-success px-2.5 py-1 rounded font-semibold"
                >
                  Mở Google Sheet
                </a>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(generatedDemoSheetUrl);
                    setBannerMessage({
                      type: "success",
                      text: `Đã sao chép link Bảng chấm điểm Demo để gửi Giám khảo: ${generatedDemoSheetUrl}`,
                    });
                  }}
                  className="spck-pill-neutral px-2.5 py-1 rounded font-semibold cursor-pointer"
                >
                  Copy Link Cho Giám Khảo
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {selectedSessionNumber === 14 && selectedClassId && (
        <div
          data-testid="s14-step2-prep-bar"
          className="spck-clean-subbar px-3.5 py-2.5 rounded-xl flex flex-col xl:flex-row xl:items-center justify-between gap-2.5 text-xs"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="spck-pill-primary px-2 py-0.5 rounded font-bold">
              🏅 Buổi 14 • Điểm Demo &amp; Thư 3 phần
            </span>
            <span className="text-slate-300">
              Đã soạn Thư 3 phần:{" "}
              <strong className="text-white">{s14ReadyLetterCount}</strong>/
              {(session14Evals || []).length} • Đã lưu LMS:{" "}
              <strong className="text-emerald-400">{s14VerifiedCount}</strong>/
              {(session14Evals || []).length}
            </span>
            {rows.length > 0 && (
              <button
                type="button"
                data-testid="s14-open-all-tab2-btn"
                onClick={handleOpenAllTab2}
                className="spck-pill-neutral px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer"
              >
                🏅 Mở Tab 2 (Điểm Demo &amp; Thư 3 phần) trên danh sách học viên
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 flex-1 xl:max-w-xl">
            <span className="text-xs font-semibold text-slate-300 shrink-0">
              📊 Google Sheet BGK:
            </span>
            <input
              type="text"
              value={demoScoreSourceInput}
              onChange={(e) => setDemoScoreSourceInput(e.target.value)}
              disabled={isAnyOperationBusy}
              placeholder={
                generatedDemoSheetUrl ||
                "Để trống tự nhận Google Trang tính đã tạo hoặc dán link Google Sheet..."
              }
              className="flex-1 min-w-[200px] px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs font-mono disabled:opacity-60"
            />
            <button
              type="button"
              disabled={isAnyOperationBusy}
              onClick={() => handleImportDemoScores()}
              className="spck-btn-primary px-3 py-1 rounded-lg disabled:opacity-50 text-xs font-semibold cursor-pointer shrink-0"
            >
              {importingDemoScores
                ? "Đang đọc điểm..."
                : "📥 Đọc Điểm Demo từ Google Sheet"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
