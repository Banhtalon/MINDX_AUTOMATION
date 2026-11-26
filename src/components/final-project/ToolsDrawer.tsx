"use client";

import React, { useMemo, useState } from "react";
import {
  Award,
  CheckCircle2,
  FolderSearch,
  Image as ImageIcon,
  Link2,
  Loader2,
  RefreshCw,
  Rocket,
  Settings2,
  UploadCloud,
  Video,
  Wrench,
} from "lucide-react";
import { Session14Panel } from "./Session14Panel";
import {
  DEFAULT_SPCK_THUMBNAIL_DRIVE_URL_UI,
  buildDefaultSession14ClassSummaryText,
  formatAwardBadgeMeta,
  resolveStudentAwardLabel,
  SpckWorkflowController,
} from "./useSpckWorkflow";

export interface ToolsDrawerProps {
  workflow: SpckWorkflowController;
}

export function ToolsDrawer({ workflow }: ToolsDrawerProps) {
  const {
    rows,
    selectedSessionNumber,
    isAnyOperationBusy,
    isAppOrGameProduct,
    handleCaptureAppScreenshots,
    capturingScreenshots,
    isWebClassOrProduct,
    handleDeployWebToGithubPages,
    selectedClassId,
    deployingWeb,
    showOptionalTools,
    setShowOptionalTools,
    showAdvancedTools,
    setShowAdvancedTools,
    studentPortalRunning,
    generatedDemoSheetUrl,
    studentPortalSubmissions,
    students,
    studentPortalAutoDrive,
    handleTogglePortalAutoDrive,
    handleStartStudentPortal,
    togglingStudentPortal,
    handleStopStudentPortal,
    handleMainStep1Sync,
    mainSyncRunning,
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
    thumbnailDriveFolderUrl,
    setThumbnailDriveFolderUrl,
    syncingDriveThumbnails,
    handleSyncDriveThumbnails,
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
    handleToggleAutoRunToolsAfterScan,
    handleInitStudentFolders,
    handleScanFolder,
    scanning,
    folderPathInput,
    isSpckExemptClass,
    isRoboticsClass,
    youtubeImportInput,
    setYoutubeImportInput,
    handleImportYoutubeProducts,
    importingYoutube,
    youtubeImportReport,
    session14ClassSummaryText,
    showSession14SummaryBox,
    setShowSession14SummaryBox,
    handleUpdateSession14ClassSummaryText,
    handlePersistSession14ClassSummary,
    handleResetSession14ClassSummary,
    session14AwardMap,
    activeStudentIdSet,
  } = workflow;

  const [enableAiDemoPreScore, setEnableAiDemoPreScore] = useState<boolean>(true);
  const isDemoExemptClass = /(?:^|[-_\s])(PTB|CSB)(?:\d|$|[-_\s])/i.test(
    String(selectedClassId || "")
  );

  const s14VerifiedCount = (session14Evals || []).filter(
    (ev) => ev.status === "VERIFIED"
  ).length;
  const s14ReadyLetterCount = (session14Evals || []).filter(
    (ev) =>
      ev.learnedFromMindx?.trim() &&
      ev.suggestionsFromMindx?.trim() &&
      ev.futureDirection?.trim()
  ).length;

  const activeRosterCount = useMemo(
    () => (students || []).filter((s) => s && s.isActive !== 0).length,
    [students]
  );

  const awardPillsSummary = useMemo(() => {
    if (selectedSessionNumber !== 14) return [];
    const items: Array<{ studentId: string; fullName: string; label: string }> =
      [];
    for (const ev of session14Evals || []) {
      if (activeStudentIdSet.size > 0 && !activeStudentIdSet.has(ev.studentId)) {
        continue;
      }
      const label = resolveStudentAwardLabel(ev, session14AwardMap);
      if (label) {
        items.push({
          studentId: ev.studentId,
          fullName: ev.fullName || ev.studentId,
          label,
        });
      }
    }
    return items;
  }, [selectedSessionNumber, session14Evals, session14AwardMap, activeStudentIdSet]);

  const shouldRenderSummaryBox =
    selectedSessionNumber === 14 &&
    Boolean(selectedClassId) &&
    (showSession14SummaryBox ||
      Boolean(session14ClassSummaryText.trim()) ||
      awardPillsSummary.length > 0);

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
      {/* Thanh tiêu đề Bảng học viên + 2 Ngăn phụ gọn gàng */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 pb-3 border-b border-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm sm:text-base font-extrabold text-white">
            Danh Sách Học Viên &amp; Bài Làm ({rows.length || activeRosterCount}{" "}
            học viên)
          </h2>
          {selectedSessionNumber === 14 && session14Evals.length > 0 && (
            <span className="px-2.5 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-[11px] text-slate-300">
              Thư 3 phần:{" "}
              <strong className="text-white">{s14ReadyLetterCount}</strong>/
              {session14Evals.length} • LMS Cột 2:{" "}
              <strong className="text-emerald-400">{s14VerifiedCount}</strong>/
              {session14Evals.length}
            </span>
          )}
          {selectedSessionNumber === 14 && selectedClassId && (
            <button
              type="button"
              onClick={() => setShowSession14SummaryBox((v) => !v)}
              className="spck-pill-neutral px-2.5 py-1 rounded-md text-[11px] font-semibold cursor-pointer"
            >
              {shouldRenderSummaryBox
                ? "🏆 Ẩn Summary Vinh danh ▴"
                : "🏆 Hiện Summary Vinh danh ▾"}
            </button>
          )}
        </div>

        {/* 2 Ngăn phụ gọn gàng: Ngăn 1 (Công cụ trong lớp học) & Ngăn 2 (Tùy chọn nâng cao) */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="spck-classroom-tools-toggle"
            onClick={() => setShowOptionalTools((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              showOptionalTools || studentPortalRunning
                ? "spck-pill-primary"
                : "spck-pill-neutral"
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>
              {showOptionalTools
                ? "🧰 Công cụ trong lớp học ▴"
                : "🧰 Công cụ trong lớp học ▾"}
            </span>
            <span className="sr-only"> (Công cụ Drive &amp; Cổng thu bài)</span>
            {studentPortalRunning && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-emerald-500/25 border border-emerald-400/50 text-emerald-200 text-[10px] font-bold">
                ● Cổng mở ({studentPortalSubmissions.length})
              </span>
            )}
          </button>

          <button
            type="button"
            data-testid="spck-advanced-tools-toggle"
            onClick={() => setShowAdvancedTools((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              showAdvancedTools ? "spck-pill-primary" : "spck-pill-neutral"
            }`}
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span>
              {showAdvancedTools
                ? "⚙️ Tùy chọn nâng cao ▴"
                : "⚙️ Tùy chọn nâng cao ▾"}
            </span>
          </button>
        </div>
      </div>

      {isSpckExemptClass && (
        <div className="neo-details-bar rounded-xl px-3.5 py-2 text-xs font-bold">
          ℹ️ Lớp <strong>{selectedClassId}</strong> (<strong>PTB / CSB</strong>) miễn nộp SPCK &amp; Demo BGK — Buổi 14 chạy 3 bước để đẩy [ĐNL], Thư 3 phần &amp; Teaching 100%.
        </div>
      )}

      {/* =================================================================== */}
      {/* NGĂN 1: 🧰 CÔNG CỤ TRONG LỚP HỌC                                     */}
      {/* (Mở Cổng thu bài HS • Tạo Link Bảng chấm Giám khảo • Playlist YT)   */}
      {/* =================================================================== */}
      {showOptionalTools && (
        <div
          data-testid="spck-classroom-tools-drawer"
          className="spck-clean-subbar p-3.5 rounded-xl space-y-3.5"
        >
          {/* 1A. Cổng thu bài trực tuyến cho học sinh */}
          <div className="p-3 rounded-xl bg-slate-950/75 border border-slate-700 space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="spck-pill-primary px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
                  Cổng Thu Bài Học Sinh
                </span>
                <span className="text-xs font-bold text-white">
                  Mở Link / QR cho học sinh nộp bài trực tiếp
                </span>
                {studentPortalRunning && (
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 text-[11px] font-semibold">
                    ● Đang mở {selectedClassId} ({studentPortalSubmissions.length}/
                    {activeRosterCount || rows.length} HV)
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <label className="inline-flex items-center space-x-1.5 text-xs text-slate-300 cursor-pointer bg-slate-900/90 px-2.5 py-1.5 rounded-lg border border-slate-700">
                  <input
                    type="checkbox"
                    data-testid="spck-portal-auto-drive-checkbox"
                    checked={studentPortalAutoDrive}
                    onChange={(e) => handleTogglePortalAutoDrive(e.target.checked)}
                    className="rounded border-slate-600"
                  />
                  <span>Tự động Up Drive khi HS nộp</span>
                </label>

                {!studentPortalRunning ? (
                  <button
                    type="button"
                    data-testid="spck-open-portal-btn"
                    onClick={handleStartStudentPortal}
                    disabled={
                      togglingStudentPortal ||
                      isAnyOperationBusy ||
                      !selectedClassId ||
                      isSpckExemptClass
                    }
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
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid="spck-close-portal-and-sync-btn"
                      onClick={() => void handleMainStep1Sync()}
                      disabled={togglingStudentPortal || mainSyncRunning}
                      className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-extrabold text-xs transition-colors cursor-pointer shadow-sm"
                    >
                      {mainSyncRunning ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      <span>🛑 Đóng cổng &amp; Đồng bộ bài làm</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleStopStudentPortal}
                      disabled={togglingStudentPortal}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/70 border border-rose-500/50 text-rose-200 font-semibold text-xs transition-colors cursor-pointer"
                    >
                      <span>Đóng Cổng Thu Bài</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {studentPortalRunning && (
              <div className="pt-2.5 border-t border-slate-800/80 space-y-2.5">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
                  <div className="md:col-span-7">
                    <div className="text-[11px] text-slate-400 mb-1 flex items-center justify-between">
                      <span>
                        🌐{" "}
                        <strong>
                          Link gửi học sinh ({studentPortalTunnelProvider || "Local"}):
                        </strong>
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
                      Xem Thử
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
                        Học sinh quét mã QR hoặc mở link thầy gửi để chọn tên và tải sản phẩm lên.
                      </p>
                    </div>
                  </div>
                )}

                {studentPortalSubmissions.length > 0 && (
                  <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800 space-y-1.5">
                    <div className="text-[11px] font-bold text-slate-300 uppercase">
                      📥 Học sinh đã nộp ({studentPortalSubmissions.length}):
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
                              ✅ Drive
                            </a>
                          ) : sub.driveStatus === "UPLOADING" ||
                            sub.driveStatus === "QUEUED" ? (
                            <span className="text-amber-300 animate-pulse">
                              ⏳ Đang Up Drive...
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

          {/* 1B. Tạo Link Bảng chấm điểm gửi Giám khảo */}
          <div className="p-3 rounded-xl bg-slate-950/75 border border-slate-700 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-white">
                📋 Tạo Bảng chấm điểm Giám khảo (Google Sheets)
              </span>
              {generatedDemoSheetUrl && (
                <div className="flex items-center gap-2">
                  <a
                    href={generatedDemoSheetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="spck-btn-success px-2.5 py-1 rounded-md text-xs font-bold"
                  >
                    Mở Bảng BGK
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(generatedDemoSheetUrl);
                      setBannerMessage({
                        type: "success",
                        text: `Đã sao chép link Bảng chấm điểm Demo gửi Giám khảo: ${generatedDemoSheetUrl}`,
                      });
                    }}
                    className="spck-pill-neutral px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer"
                  >
                    Copy Link BGK
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end">
              <div className="md:col-span-5">
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Link Google Sheet mẫu (Để trống dùng mẫu chuẩn MindX)
                </label>
                <input
                  type="text"
                  value={templateSheetUrl}
                  onChange={(e) => setTemplateSheetUrl(e.target.value)}
                  disabled={isAnyOperationBusy}
                  placeholder="Để trống tự chọn đúng mẫu khóa học..."
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Ngày Demo (Tùy chọn)
                </label>
                <input
                  type="text"
                  value={demoDateInput}
                  onChange={(e) => setDemoDateInput(e.target.value)}
                  disabled={isAnyOperationBusy}
                  placeholder="YYYY-MM-DD"
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="md:col-span-4">
                <button
                  type="button"
                  onClick={() => handleCreateDemoScoringSheet(enableAiDemoPreScore)}
                  disabled={
                    isAnyOperationBusy ||
                    !selectedClassId ||
                    (isDemoExemptClass && !templateSheetUrl.trim())
                  }
                  className="spck-btn-primary w-full flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-lg disabled:opacity-50 font-semibold text-xs transition-colors cursor-pointer"
                >
                  {creatingDemoSheet ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {generatedDemoSheetUrl
                      ? "Làm mới Link Chấm Giám Khảo"
                      : `Tạo Link Chấm Giám Khảo (${activeRosterCount || rows.length} HV)`}
                  </span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={enableAiDemoPreScore}
                  onChange={(e) => setEnableAiDemoPreScore(e.target.checked)}
                  disabled={
                    isAnyOperationBusy ||
                    (isDemoExemptClass && !templateSheetUrl.trim())
                  }
                  className="rounded border-slate-600 bg-slate-950 text-blue-500"
                />
                <span>
                  ✨ Nhờ AI chấm nháp tiêu chí sản phẩm &amp; gợi ý câu hỏi BGK (Cột G)
                </span>
              </label>
              {generatedDemoSheetUrl && (
                <span className="text-[11px] text-emerald-300 truncate max-w-md">
                  📊 {demoSheetTitle}
                </span>
              )}
            </div>
          </div>

          {/* 1C. Nhập Playlist YouTube Robotics / Video thuyết trình */}
          <div className="p-3 rounded-xl bg-slate-950/75 border border-slate-700 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs font-bold text-white">
              <span className="flex items-center gap-1.5">
                <Video className="w-4 h-4 text-sky-400" />
                <span>
                  🎬 Nhập Playlist YouTube Robotics / Video thuyết trình
                  {isRoboticsClass ? " (Khuyến nghị cho lớp Robotics)" : ""}
                </span>
              </span>
            </div>
            <textarea
              value={youtubeImportInput}
              onChange={(e) => setYoutubeImportInput(e.target.value)}
              disabled={isAnyOperationBusy}
              rows={2}
              placeholder={
                "Dán link Playlist YouTube của lớp (https://www.youtube.com/playlist?list=PL...) hoặc từng dòng: Tên HV - Link YouTube"
              }
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-blue-500 disabled:opacity-60"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-slate-400">
                Tự khớp tên học viên trong tiêu đề video, gắn link YouTube và trích{" "}
                <strong>2 ảnh thuyết trình</strong>.
              </p>
              <button
                type="button"
                onClick={() => handleImportYoutubeProducts()}
                disabled={
                  isAnyOperationBusy ||
                  !selectedClassId ||
                  !youtubeImportInput.trim()
                }
                className="spck-btn-primary shrink-0 flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg disabled:opacity-50 font-semibold text-xs transition-colors cursor-pointer"
              >
                {importingYoutube ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Video className="w-3.5 h-3.5" />
                )}
                <span>Nhập YouTube &amp; Lấy 2 Ảnh</span>
              </button>
            </div>

            {youtubeImportReport && (
              <div className="rounded-lg border border-slate-700 bg-slate-950/80 p-2 space-y-1.5">
                {youtubeImportReport.playlists.map((pl, idx) => (
                  <p key={idx} className="text-[11px] text-slate-300">
                    Playlist{" "}
                    <strong className="text-white">
                      {pl.playlistTitle || "(không tên)"}
                    </strong>
                    :{" "}
                    {pl.error ? (
                      <span className="text-rose-300">{pl.error}</span>
                    ) : (
                      <span>{pl.videoCount} video</span>
                    )}
                  </p>
                ))}
                {youtubeImportReport.studentsWithoutVideo.length > 0 && (
                  <p className="text-[11px] text-amber-300">
                    Học viên chưa có video:{" "}
                    {youtubeImportReport.studentsWithoutVideo
                      .map((s) => s.fullName)
                      .join(", ")}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* NGĂN 2: ⚙️ TÙY CHỌN NÂNG CAO (Chạy thủ công / thử lại từng phần)    */}
      {/* =================================================================== */}
      {showAdvancedTools && (
        <div
          data-testid="spck-advanced-tools-drawer"
          className="spck-clean-subbar p-3.5 rounded-xl space-y-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <span className="text-xs font-bold text-slate-200 uppercase">
              ⚙️ Tùy chọn nâng cao &amp; Thử lại thủ công từng công cụ lẻ
            </span>
            <label className="inline-flex items-center space-x-1.5 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                data-testid="s5b-auto-run-tools-checkbox"
                checked={autoRunToolsAfterScan}
                disabled={isAnyOperationBusy}
                onChange={(e) =>
                  handleToggleAutoRunToolsAfterScan(e.target.checked)
                }
                className="rounded border-slate-600 cursor-pointer"
              />
              <span>⚡ Tự chạy công cụ chuẩn bị sau khi Quét lẻ</span>
            </label>
          </div>

          {/* Hàng nút thủ công rời rạc: Tạo thư mục HV, Quét lẻ, Chụp 16:9 lẻ */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="s5b-init-student-folders-btn"
              onClick={() => handleInitStudentFolders()}
              disabled={
                isAnyOperationBusy || !selectedClassId || !folderPathInput.trim()
              }
              className="spck-pill-neutral inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg disabled:opacity-50 font-semibold text-xs cursor-pointer"
            >
              <span>📁 Tạo thư mục HV</span>
            </button>

            <button
              type="button"
              onClick={() => handleScanFolder()}
              disabled={isAnyOperationBusy || !selectedClassId}
              className="spck-pill-neutral inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg disabled:opacity-50 font-semibold text-xs cursor-pointer"
            >
              {scanning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FolderSearch className="w-3.5 h-3.5" />
              )}
              <span>Quét lại thư mục lẻ</span>
            </button>

            {isAppOrGameProduct && (
              <button
                type="button"
                onClick={() => handleCaptureAppScreenshots()}
                disabled={isAnyOperationBusy || rows.length === 0}
                className="spck-pill-neutral inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg disabled:opacity-50 font-semibold text-xs cursor-pointer"
              >
                {capturingScreenshots ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ImageIcon className="w-3.5 h-3.5" />
                )}
                <span>
                  {isWebClassOrProduct
                    ? "📸 Chụp giao diện Web lẻ"
                    : "📸 Chụp giao diện App lẻ"}
                </span>
              </button>
            )}
          </div>

          {/* Cấu hình & chạy lẻ Ảnh bìa Học viên từ Google Drive */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-8">
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="block text-[11px] font-semibold text-slate-400 uppercase">
                  Link Google Drive Ảnh Học Viên (Tự ghép Thumbnail • Thiếu dùng Logo MindX)
                </label>
                <a
                  href={
                    (thumbnailDriveFolderUrl || "").trim() ||
                    DEFAULT_SPCK_THUMBNAIL_DRIVE_URL_UI
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-semibold text-sky-400 hover:underline shrink-0"
                >
                  Mở folder ↗
                </a>
              </div>
              <input
                type="text"
                data-testid="spck-thumb-drive-url-input"
                value={thumbnailDriveFolderUrl}
                onChange={(e) => setThumbnailDriveFolderUrl(e.target.value)}
                disabled={isAnyOperationBusy}
                placeholder="https://drive.google.com/drive/folders/..."
                className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div className="md:col-span-4">
              <button
                type="button"
                data-testid="spck-sync-drive-thumbs-btn"
                onClick={() =>
                  handleSyncDriveThumbnails(undefined, {
                    forceRedownload: true,
                    seedMissingActiveStudents: isRoboticsClass,
                  })
                }
                disabled={
                  isAnyOperationBusy ||
                  !selectedClassId ||
                  isSpckExemptClass
                }
                className="w-full flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                {syncingDriveThumbnails ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ImageIcon className="w-3.5 h-3.5" />
                )}
                <span>Quét Ảnh Thumbnail Drive lẻ</span>
              </button>
            </div>
          </div>

          {/* Cấu hình & chạy lẻ Google Drive + GitHub Pages */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-8">
              <label className="block text-[11px] font-semibold text-slate-400 uppercase mb-1">
                Link Google Drive Gốc (Đóng gói .zip từng học viên)
              </label>
              <input
                type="text"
                value={driveFolderUrl}
                onChange={(e) => setDriveFolderUrl(e.target.value)}
                disabled={isAnyOperationBusy}
                placeholder="https://drive.google.com/drive/folders/..."
                className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-sky-500"
              />
            </div>
            <div className="md:col-span-4">
              <button
                type="button"
                onClick={() => handleUploadToGoogleDrive()}
                disabled={
                  isAnyOperationBusy || !selectedClassId || rows.length === 0
                }
                className="w-full flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-lg bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                {uploadingDrive ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <UploadCloud className="w-3.5 h-3.5" />
                )}
                <span>Up Google Drive lẻ</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-8">
              <label className="block text-[11px] font-semibold text-slate-400 uppercase mb-1">
                Kho GitHub Pages Chạy Thử Web Live
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
            <div className="md:col-span-4">
              <button
                type="button"
                onClick={() => handleDeployWebToGithubPages()}
                disabled={
                  isAnyOperationBusy ||
                  !selectedClassId ||
                  rows.length === 0 ||
                  !isWebClassOrProduct
                }
                className="w-full flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-lg bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                {deployingWeb ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Rocket className="w-3.5 h-3.5" />
                )}
                <span>Chạy thử Web lẻ (GitHub Pages)</span>
              </button>
            </div>
          </div>

          {/* Tùy chọn nâng cao riêng cho Buổi 14: Đọc lại điểm BGK lẻ & Đẩy riêng Thư 3 phần */}
          {selectedSessionNumber === 14 && selectedClassId && (
            <div className="space-y-3 pt-2 border-t border-slate-800">
              <div
                data-testid="s14-step2-prep-bar"
                className="flex flex-col xl:flex-row xl:items-center justify-between gap-2.5 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {rows.length > 0 && (
                    <button
                      type="button"
                      data-testid="s14-open-all-tab2-btn"
                      onClick={handleOpenAllTab2}
                      className="spck-pill-neutral px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer"
                    >
                      🏅 Mở tất cả Tab 2 (Điểm Demo &amp; Thư 3 phần) trên bảng
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 flex-1 xl:max-w-xl">
                  <input
                    type="text"
                    value={demoScoreSourceInput}
                    onChange={(e) => setDemoScoreSourceInput(e.target.value)}
                    disabled={isAnyOperationBusy}
                    placeholder={
                      generatedDemoSheetUrl ||
                      "Dán link Google Sheet BGK hoặc đường dẫn .xlsx..."
                    }
                    className="flex-1 min-w-[200px] px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono disabled:opacity-60"
                  />
                  <button
                    type="button"
                    disabled={isAnyOperationBusy}
                    onClick={() => void handleImportDemoScores()}
                    className="spck-btn-primary px-3 py-1.5 rounded-lg disabled:opacity-50 text-xs font-semibold cursor-pointer shrink-0"
                  >
                    {importingDemoScores
                      ? "Đang đọc điểm..."
                      : "📥 Đọc lại điểm BGK lẻ"}
                  </button>
                </div>
              </div>

              <Session14Panel workflow={workflow} />
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* KHUNG XEM TRƯỚC / CHỈNH SỬA NHANH BÀI VINH DANH NHẤT – NHÌ – BA      */}
      {/* (`Summary` đầu trang Buổi 14 — ngay trên đầu bảng học viên!)         */}
      {/* =================================================================== */}
      {shouldRenderSummaryBox && (
        <div
          data-testid="s14-class-summary-box"
          className="spck-summary-honor-card rounded-xl p-3.5 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="spck-award-gold inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-extrabold">
                <Award className="w-3.5 h-3.5" />
                <span>
                  Bài Tổng kết &amp; Vinh danh Nhất – Nhì – Ba (Ô Summary đầu trang Buổi 14)
                </span>
              </span>
              <span className="spck-pill-success px-2 py-0.5 rounded-full text-[11px] font-semibold">
                ✓ Tự động điền lên LMS khi bấm &ldquo;3. Duyệt &amp; Nộp tất cả&rdquo;
              </span>
            </div>

            <button
              type="button"
              disabled={isAnyOperationBusy}
              onClick={() => void handleResetSession14ClassSummary()}
              className="spck-pill-neutral px-2.5 py-1 rounded-md text-[11px] font-semibold cursor-pointer disabled:opacity-50"
            >
              🔄 Tạo lại mẫu vinh danh từ điểm BGK
            </button>
          </div>

          {awardPillsSummary.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {awardPillsSummary.map((item) => {
                const badge = formatAwardBadgeMeta(item.label);
                if (!badge) return null;
                const pillTone =
                  badge.tone === "gold"
                    ? "spck-award-gold"
                    : badge.tone === "silver"
                    ? "spck-award-silver"
                    : badge.tone === "bronze"
                    ? "spck-award-bronze"
                    : "spck-award-indigo";
                return (
                  <span
                    key={item.studentId}
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${pillTone}`}
                  >
                    <span>{badge.icon}</span>
                    <span>{badge.shortText}:</span>
                    <strong className="font-bold">{item.fullName}</strong>
                  </span>
                );
              })}
            </div>
          )}

          <textarea
            data-testid="s14-class-summary-textarea"
            value={session14ClassSummaryText}
            onChange={(e) =>
              handleUpdateSession14ClassSummaryText(e.target.value)
            }
            onBlur={() => void handlePersistSession14ClassSummary()}
            disabled={isAnyOperationBusy}
            rows={4}
            placeholder="Nội dung tổng kết buổi bảo vệ cuối khóa & vinh danh Giải Nhất / Nhì / Ba (tự động tạo từ bảng điểm BGK, thầy có thể sửa nhanh tại đây)..."
            className="w-full px-3 py-2 rounded-lg bg-slate-950/90 border border-slate-700 text-slate-100 text-xs leading-relaxed focus:outline-none focus:border-amber-500 disabled:opacity-60"
          />
        </div>
      )}
    </>
  );
}
