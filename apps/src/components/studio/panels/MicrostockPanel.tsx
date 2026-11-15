import { useState, useEffect } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  FileSpreadsheet,
  GripHorizontal,
  Loader2,
  Package,
  PanelLeftClose,
  Play,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { useStudioStore } from "../../../hooks/useStudioStore";
import { useMicrostockStore } from "../../../hooks/useMicrostockStore";
import { centerNoticeActions } from "../../../hooks/useCenterNotice";
import { cn } from "../../../lib/utils";
import {
  ADOBE_ALLOWED_CODECS,
  ADOBE_MVP_PRESETS,
  groupPreflightItems,
  isMicrostockChecklistComplete,
  parseKeywordsInput,
  validateMicrostockSubmission,
} from "../../../lib/microstockUtils";
import type { MicrostockChecklist } from "../../../types/microstock";

interface MicrostockPanelProps {
  width?: number | string;
  onClose: () => void;
  isFloating?: boolean;
}

export function MicrostockPanel({
  width = "100%",
  onClose,
  isFloating = false,
}: MicrostockPanelProps) {
  const { activeComposition } = useStudioStore();
  const microstock = useMicrostockStore();
  const { manifest, activeCodec, isBusy, lastPackage, renderProgress, actions } =
    microstock;

  const [keywordsText, setKeywordsText] = useState<string>(
    manifest.metadata.keywords.join(", ")
  );

  useEffect(() => {
    setKeywordsText(manifest.metadata.keywords.join(", "));
  }, [manifest.metadata.keywords]);

  const checklist = manifest.provenance.checklist;
  const checklistDone = isMicrostockChecklistComplete(checklist);
  const aiDeclared = manifest.provenance.aiDeclared;

  const updateChecklistField = (key: keyof MicrostockChecklist, value: boolean) => {
    void actions.updateChecklistField(key, value);
  };

  const setAiDeclared = (val: boolean) => {
    void actions.setAiDeclared(val);
  };

  const handleTitleChange = (title: string) => {
    void actions.updateManifest({
      metadata: {
        ...manifest.metadata,
        title,
      },
    });
  };

  const handleKeywordsBlur = () => {
    const parsed = parseKeywordsInput(keywordsText);
    void actions.updateManifest({
      metadata: {
        ...manifest.metadata,
        keywords: parsed,
      },
    });
  };

  const validationIssues = validateMicrostockSubmission({
    filename: "stock_clip.mp4",
    title: manifest.metadata.title || "Pure Visual Motion Graphic Background",
    keywords:
      manifest.metadata.keywords.length >= 5
        ? manifest.metadata.keywords
        : [
            "abstract",
            "motion",
            "background",
            "gradient",
            "loop",
            "minimal",
          ],
    aiDeclared,
    checklist,
  });

  const preflight = manifest.lastPreflight;
  const groupedPreflight = preflight
    ? groupPreflightItems(preflight.items)
    : { fails: [], warns: [], infos: [] };

  const handleRunRenderAndPreflight = () => {
    void actions
      .runRenderAndPreflight({
        compositionId: activeComposition.id,
        width: activeComposition.width,
        height: activeComposition.height,
        fps: activeComposition.fps,
        durationSec: activeComposition.duration,
      })
      .then((res) => {
        centerNoticeActions.show({
          severity: res.ok
            ? "success"
            : res.title === "Compliance Gate Incomplete"
              ? "warning"
              : "error",
          title: res.title,
          message: res.message,
          details: res.details,
        });
      });
  };

  const handleBuildPackage = () => {
    void actions.buildPackage().then((res) => {
      centerNoticeActions.show({
        severity: res.ok ? "success" : "error",
        title: res.title,
        message: res.message,
        details: res.details,
      });
    });
  };

  return (
    <aside
      data-testid="microstock-sidebar-panel"
      className="bg-[var(--bg-panel)] text-[var(--text-primary)] border-r border-[var(--border-color)] flex flex-col shrink-0 select-none transition-colors duration-150 h-full"
      style={{ width }}
    >
      {/* Panel Header (Draggable via DetachablePanelShell) */}
      <div
        className="h-9 px-3 box-border border-b border-[var(--border-color)] flex items-center justify-between shrink-0"
        title="Drag header to detach into a floating resizable window"
      >
        <span className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5 min-w-0">
          <GripHorizontal className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
          <span className="w-4 h-4 rounded-full bg-amber-600 text-white flex items-center justify-center font-mono font-bold text-[9px] shrink-0">
            M
          </span>
          <span className="truncate">Adobe Stock Microstock</span>
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Adobe Stock Settings"
            className="w-6 h-6 rounded-[var(--radius-control)] bg-[var(--bg-panel)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] flex items-center justify-center transition-colors cursor-pointer"
            title={isFloating ? "Return to Sidebar" : "Close Panel (Ctrl+B)"}
          >
            {isFloating ? (
              <X className="w-3.5 h-3.5" strokeWidth={1.75} />
            ) : (
              <PanelLeftClose className="w-3.5 h-3.5" strokeWidth={1.75} />
            )}
          </button>
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-2.5 min-h-0">
        {/* 1. Preset & Codec Lock */}
        <div className="p-2.5 rounded-[var(--radius-card)] bg-[var(--bg-card)] border border-[var(--border-color)] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">
              1. Locked Format & Codec
            </span>
            <span className="text-[10px] font-mono text-[var(--text-secondary)]">
              bt709 • -an • 5–60s
            </span>
          </div>

          <select
            aria-label="Adobe Stock Preset"
            data-testid="microstock-preset-select"
            value={manifest.presetId}
            onChange={(e) => void actions.selectPreset(e.target.value)}
            className="w-full h-7 px-2 rounded-[var(--radius-control)] bg-[var(--bg-input)] border border-[var(--border-color)] text-[11px] font-mono text-[var(--text-primary)] outline-none"
          >
            {ADOBE_MVP_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>

          <div className="grid grid-cols-2 gap-1.5">
            {ADOBE_ALLOWED_CODECS.map((item) => (
              <button
                key={item.id}
                type="button"
                data-testid={`microstock-codec-${item.id}`}
                onClick={() => actions.setCodec(item.id)}
                className={cn(
                  "h-6 rounded-[var(--radius-control)] text-[10px] font-mono border transition-colors cursor-pointer",
                  activeCodec === item.id
                    ? "bg-amber-600 text-white border-amber-500 font-semibold"
                    : "bg-[var(--bg-input)] text-[var(--text-secondary)] border-[var(--border-color)] hover:text-[var(--text-primary)]"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <label className="flex items-center justify-between text-[11px] text-[var(--text-secondary)] cursor-pointer pt-0.5">
            <span>Seamless Loop Check (PSNR/SSIM)</span>
            <input
              type="checkbox"
              data-testid="microstock-loop-checkbox"
              checked={manifest.isLoop}
              onChange={(e) => void actions.updateManifest({ isLoop: e.target.checked })}
              className="rounded border-[var(--border-color)]"
            />
          </label>
        </div>

        {/* 2. Generative AI Disclosure & 4-Point Compliance Gate */}
        <div className="p-2.5 rounded-[var(--radius-card)] bg-[var(--bg-card)] border border-[var(--border-color)] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">
              2. AI Disclosure & Gate
            </span>
            <span className="text-[10px] font-mono text-[var(--text-secondary)]">
              {aiDeclared !== null && checklistDone ? "Ready" : "Required"}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--text-primary)]">
              Created with Generative AI?
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                data-testid="microstock-ai-yes"
                onClick={() => setAiDeclared(true)}
                className={cn(
                  "h-6 px-2 rounded-[var(--radius-control)] text-[10px] font-mono border cursor-pointer",
                  aiDeclared === true
                    ? "bg-amber-600 text-white border-amber-500 font-semibold"
                    : "bg-[var(--bg-input)] text-[var(--text-secondary)] border-[var(--border-color)]"
                )}
              >
                Yes (AI)
              </button>
              <button
                type="button"
                data-testid="microstock-ai-no"
                onClick={() => setAiDeclared(false)}
                className={cn(
                  "h-6 px-2 rounded-[var(--radius-control)] text-[10px] font-mono border cursor-pointer",
                  aiDeclared === false
                    ? "bg-amber-600 text-white border-amber-500 font-semibold"
                    : "bg-[var(--bg-input)] text-[var(--text-secondary)] border-[var(--border-color)]"
                )}
              >
                No (Code)
              </button>
            </div>
          </div>

          <div className="space-y-1.5 text-[11px] text-[var(--text-secondary)]">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                data-testid="microstock-check-upscaled"
                checked={checklist.notUpscaled}
                onChange={(e) => updateChecklistField("notUpscaled", e.target.checked)}
                className="mt-0.5 shrink-0"
              />
              <span>Rendered natively at target resolution (never upscaled)</span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                data-testid="microstock-check-nologos"
                checked={checklist.noLogosWatermarksTextOrAudio}
                onChange={(e) =>
                  updateChecklistField("noLogosWatermarksTextOrAudio", e.target.checked)
                }
                className="mt-0.5 shrink-0"
              />
              <span>No text overlays, watermarks, brand logos, or audio tracks</span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                data-testid="microstock-check-rights"
                checked={checklist.ownsFullRightsAndLicenses}
                onChange={(e) =>
                  updateChecklistField("ownsFullRightsAndLicenses", e.target.checked)
                }
                className="mt-0.5 shrink-0"
              />
              <span>Full commercial rights & SPDX licenses for all assets</span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                data-testid="microstock-check-noref"
                checked={checklist.notCopiedFromExternalReference}
                onChange={(e) =>
                  updateChecklistField(
                    "notCopiedFromExternalReference",
                    e.target.checked
                  )
                }
                className="mt-0.5 shrink-0"
              />
              <span>Original motion work (no external reference cloning)</span>
            </label>
          </div>
        </div>

        {/* 3. Metadata Editor (Title <= 70, Keywords 5..49) */}
        <div className="p-2.5 rounded-[var(--radius-card)] bg-[var(--bg-card)] border border-[var(--border-color)] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">
              3. Metadata & CSV
            </span>
            <span className="text-[10px] font-mono text-[var(--text-secondary)]">
              {[...manifest.metadata.title].length}/70 chars •{" "}
              {manifest.metadata.keywords.length} kw
            </span>
          </div>

          <input
            type="text"
            aria-label="Adobe Stock Title"
            data-testid="microstock-title-input"
            value={manifest.metadata.title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Descriptive title (max 70 chars)..."
            className="w-full h-7 px-2 rounded-[var(--radius-control)] bg-[var(--bg-input)] border border-[var(--border-color)] text-xs text-[var(--text-primary)] outline-none"
          />

          <textarea
            aria-label="Adobe Stock Keywords"
            data-testid="microstock-keywords-input"
            rows={3}
            value={keywordsText}
            onChange={(e) => setKeywordsText(e.target.value)}
            onBlur={handleKeywordsBlur}
            placeholder="5–49 comma-separated keywords ordered by importance..."
            className="w-full p-2 rounded-[var(--radius-control)] bg-[var(--bg-input)] border border-[var(--border-color)] text-[11px] font-mono text-[var(--text-primary)] outline-none resize-none"
          />
        </div>

        {/* Validation / Preflight Status */}
        {validationIssues.length > 0 && (
          <div
            data-testid="microstock-validation-banner"
            className="p-2 rounded-[var(--radius-card)] bg-[var(--bg-card)] border border-amber-400/50 text-[11px] text-amber-400 flex items-start gap-2"
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              {validationIssues.slice(0, 2).map((issue) => (
                <div key={issue.code}>
                  <span className="font-mono font-semibold">{issue.code}:</span>{" "}
                  {issue.message}
                </div>
              ))}
            </div>
          </div>
        )}

        {preflight && (
          <div
            data-testid="microstock-preflight-summary"
            className="p-2 rounded-[var(--radius-card)] bg-[var(--bg-card)] border border-[var(--border-color)] space-y-1 text-[11px]"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                {preflight.status === "fail" ? (
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                ) : preflight.status === "warn" ? (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5 text-[var(--text-primary)]" />
                )}
                Preflight: {preflight.status.toUpperCase()}
              </span>
              {typeof preflight.sourceVsEncodedSsim === "number" && (
                <span className="font-mono text-[10px] text-[var(--text-secondary)]">
                  SSIM {preflight.sourceVsEncodedSsim.toFixed(3)}
                </span>
              )}
            </div>
            {groupedPreflight.fails.map((f) => (
              <div key={f.code} className="text-rose-400 font-mono text-[10px]">
                [{f.code}] {f.message}
              </div>
            ))}
            {groupedPreflight.warns.map((w) => (
              <div key={w.code} className="text-amber-400 font-mono text-[10px]">
                [{w.code}] {w.message}
              </div>
            ))}
          </div>
        )}

        {lastPackage && (
          <div
            data-testid="microstock-package-summary"
            className="p-2 rounded-[var(--radius-card)] bg-[var(--bg-card)] border border-[var(--border-strong)] text-[10px] font-mono text-[var(--text-primary)] space-y-0.5"
          >
            <div className="flex items-center gap-1.5 font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Adobe Stock Package Ready</span>
            </div>
            <div className="text-[var(--text-secondary)] truncate">
              {lastPackage.packageDir}
            </div>
            <div className="text-[var(--text-secondary)] flex items-center gap-1">
              <FileSpreadsheet className="w-3 h-3" />
              <span>metadata.csv (Filename,Title,Keywords)</span>
            </div>
          </div>
        )}

        {renderProgress && (
          <div
            data-testid="microstock-render-progress"
            className={cn(
              "p-2 rounded-[var(--radius-card)] bg-[var(--bg-card)] border space-y-1.5 text-[11px]",
              renderProgress.status === "failed"
                ? "border-rose-500/50"
                : renderProgress.status === "completed"
                  ? "border-[var(--border-strong)]"
                  : "border-amber-500/40"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5 min-w-0">
                {renderProgress.status === "failed" ? (
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                ) : renderProgress.status === "completed" ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[var(--text-primary)] shrink-0" />
                ) : (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400 shrink-0" />
                )}
                <span className="truncate">{renderProgress.phaseLabel}</span>
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  data-testid="microstock-render-progress-pct"
                  className="font-mono text-[10px] text-[var(--text-secondary)]"
                >
                  {renderProgress.renderedFrames}/{renderProgress.totalFrames}f (
                  {Math.round(renderProgress.percent)}%)
                </span>
                {!isBusy && (
                  <button
                    type="button"
                    aria-label="Dismiss render progress"
                    onClick={() => actions.clearRenderProgress()}
                    className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            <div className="w-full h-2 rounded-[var(--radius-pill)] bg-[var(--bg-input)] overflow-hidden">
              <div
                data-testid="microstock-render-progress-bar"
                className={cn(
                  "h-full transition-all duration-200",
                  renderProgress.status === "failed"
                    ? "bg-rose-500"
                    : renderProgress.status === "completed"
                      ? "bg-[var(--text-primary)]"
                      : "bg-amber-500"
                )}
                style={{
                  width: `${Math.min(100, Math.max(0, renderProgress.percent))}%`,
                }}
              />
            </div>

            {renderProgress.outputPath && renderProgress.status === "completed" && (
              <div className="text-[10px] font-mono text-[var(--text-secondary)] truncate">
                {renderProgress.outputPath}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="grid grid-cols-2 gap-1.5 pt-1">
          <button
            type="button"
            data-testid="microstock-render-btn"
            disabled={isBusy}
            onClick={handleRunRenderAndPreflight}
            className="h-7 px-2 rounded-[var(--radius-control)] bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {isBusy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current shrink-0" />
            )}
            <span className="truncate">Render + Check</span>
          </button>

          <button
            type="button"
            data-testid="microstock-package-btn"
            disabled={isBusy}
            onClick={handleBuildPackage}
            className="h-7 px-2 rounded-[var(--radius-control)] bg-[var(--text-primary)] text-[var(--bg-app)] text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {lastPackage ? (
              <Check className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <Package className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="truncate">Package CSV</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
