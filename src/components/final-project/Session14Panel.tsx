"use client";

import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Sparkles, UploadCloud, Wrench } from "lucide-react";
import { SpckWorkflowController } from "./useSpckWorkflow";

export interface Session14PanelProps {
  workflow: SpckWorkflowController;
}

export function Session14Panel({ workflow }: Session14PanelProps) {
  const {
    selectedSessionNumber,
    selectedClassId,
    isAnyOperationBusy,
    handleGenerateSession14EvalAi,
    generatingS14EvalAi,
    handleApproveAndUploadSession14Eval,
    uploadingS14EvalLms,
    session14Evals,
    session14ComboStatus,
  } = workflow;

  const [isManualPanelOpen, setIsManualPanelOpen] = useState(false);

  const hasEvalFailures =
    (session14ComboStatus?.evalFailedCount || 0) > 0 ||
    (session14ComboStatus?.evalRetryStudentIds?.length || 0) > 0 ||
    (session14Evals || []).some((ev) => ev.status === "FAILED");

  useEffect(() => {
    if (hasEvalFailures) {
      setIsManualPanelOpen(true);
    }
  }, [hasEvalFailures]);

  if (selectedSessionNumber !== 14 || !selectedClassId) {
    return null;
  }

  return (
    <div
      data-testid="s14-manual-parts-panel"
      className="spck-clean-subbar px-4 py-2.5 rounded-xl space-y-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Wrench className="w-3.5 h-3.5 text-slate-400" />
          <h2 className="text-xs font-bold text-slate-300">
            Tùy chọn nâng cao Buổi 14: Sửa hoặc thử lại từng phần (Đánh giá &amp; Thư 3 phần)
          </h2>
        </div>

        <button
          type="button"
          data-testid="s14-manual-parts-toggle"
          onClick={() => setIsManualPanelOpen((prev) => !prev)}
          className="spck-pill-neutral px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
        >
          {isManualPanelOpen ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              <span>Ẩn thao tác từng phần</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              <span>🛠️ Sửa hoặc thử lại từng phần</span>
            </>
          )}
        </button>
      </div>

      {isManualPanelOpen && (
        <div className="pt-2.5 border-t border-slate-800 space-y-2.5">
          <p className="text-xs text-slate-400">
            Nút nộp chính ở <strong>Bước 3</strong> đã gộp cả Sản phẩm SPCK (Cột 3) và Đánh giá tổng kết &amp; Điểm Demo (Cột 2). Chỉ dùng các nút dưới đây khi cần soạn lại hoặc đẩy riêng phần Đánh giá Buổi 14.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isAnyOperationBusy}
              onClick={() => handleGenerateSession14EvalAi()}
              className="spck-btn-primary px-3.5 py-1.5 rounded-lg disabled:opacity-50 text-xs font-bold flex items-center space-x-1.5 cursor-pointer"
            >
              {generatingS14EvalAi ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>✨ AI Soạn Thư Tổng Kết 3 Phần (Cả lớp)</span>
            </button>

            <button
              type="button"
              disabled={isAnyOperationBusy}
              onClick={() => handleApproveAndUploadSession14Eval()}
              className="spck-btn-success px-4 py-1.5 rounded-lg disabled:opacity-50 text-xs font-bold flex items-center space-x-1.5 cursor-pointer"
            >
              {uploadingS14EvalLms ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <UploadCloud className="w-3.5 h-3.5" />
              )}
              <span>🚀 Duyệt &amp; Đẩy Đánh Giá Buổi 14 Lên LMS</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
