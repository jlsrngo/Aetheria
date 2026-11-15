import React, { useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Package,
  Play,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import {
  ADOBE_ALLOWED_CODECS,
  ADOBE_MVP_PRESETS,
  groupPreflightItems,
  isMicrostockChecklistComplete,
  parseKeywordsInput,
  validateMicrostockSubmission,
} from "../../../lib/microstockUtils";
import type {
  MicrostockChecklist,
  MicrostockManifest,
  MicrostockPackageResult,
} from "../../../types/microstock";

export interface MicrostockToolbarPopoverProps {
  manifest: MicrostockManifest;
  activeCodec: "h264" | "prores";
  isBusy: boolean;
  lastPackage: MicrostockPackageResult | null;
  onClose: () => void;
  onToggleMode: (enabled: boolean, presetId?: string) => void;
  onSelectPreset: (presetId: string) => void;
  onSelectCodec: (codec: "h264" | "prores") => void;
  onUpdateManifest: (next: Partial<MicrostockManifest>) => void;
  onRunRenderAndPreflight: () => void;
  onBuildPackage: () => void;
}

export const MicrostockToolbarPopover: React.FC<MicrostockToolbarPopoverProps> = ({
  manifest,
  activeCodec,
  isBusy,
  lastPackage,
  onClose,
  onToggleMode,
  onSelectPreset,
  onSelectCodec,
  onUpdateManifest,
  onRunRenderAndPreflight,
  onBuildPackage,
}) => {
  const [keywordsText, setKeywordsText] = useState<string>(
    manifest.metadata.keywords.join(", ")
  );

  const checklist = manifest.provenance.checklist;
  const checklistDone = isMicrostockChecklistComplete(checklist);
  const aiDeclared = manifest.provenance.aiDeclared;

  const updateChecklistField = (key: keyof MicrostockChecklist, value: boolean) => {
    onUpdateManifest({
      provenance: {
        ...manifest.provenance,
        checklist: {
          ...checklist,
          [key]: value,
        },
      },
    });
  };

  const setAiDeclared = (val: boolean) => {
    onUpdateManifest({
      provenance: {
        ...manifest.provenance,
        aiDeclared: val,
      },
    });
  };

  const handleTitleChange = (title: string) => {
    onUpdateManifest({
      metadata: {
        ...manifest.metadata,
        title,
      },
    });
  };

  const handleKeywordsBlur = () => {
    const parsed = parseKeywordsInput(keywordsText);
    onUpdateManifest({
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

  return (
    <div
      data-testid="microstock-toolbar-popover"
      className="fixed bottom-14 left-1/2 -translate-x-1/2 w-[420px] max-w-[94vw] max-h-[78vh] overflow-y-auto rounded-[var(--radius-panel)] bg-[var(--bg-panel)] border border-[var(--border-strong)] shadow-2xl z-[120] p-3 text-left select-none space-y-2.5"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-6 h-6 rounded-full bg-[var(--bg-card)] border border-[var(--border-strong)] flex items-center justify-center font-mono font-bold text-[11px] text-[var(--text-primary)] shrink-0">
            M
          </span>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
              Adobe Stock Microstock Engine
            </div>
            <div className="text-[10px] text-[var(--text-secondary)] truncate">
              Deterministic Rec.709 • No Audio • Auto Metadata & CSV
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            data-testid="microstock-mode-switch-btn"
            onClick={() => onToggleMode(!manifest.enabled, manifest.presetId)}
            className={cn(
              "h-6 px-2.5 rounded-[var(--radius-pill)] text-[10px] font-mono font-semibold border transition-colors cursor-pointer",
              manifest.enabled
                ? "bg-[var(--text-primary)] text-[var(--bg-app)] border-[var(--text-primary)]"
                : "bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border-color)] hover:text-[var(--text-primary)]"
            )}
          >
            {manifest.enabled ? "ACTIVE (ON)" : "OFF"}
          </button>
          <button
            type="button"
            aria-label="Close Adobe Stock Settings"
            onClick={onClose}
            className="w-6 h-6 rounded-[var(--radius-control)] bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Preset & Codec Lock */}
      <div className="p-2 rounded-[var(--radius-card)] bg-[var(--bg-card)] border border-[var(--border-color)] space-y-2">
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
          onChange={(e) => onSelectPreset(e.target.value)}
          className="w-full h-7 px-2 rounded-[var(--radius-control)] bg-[var(--bg-input)] border border-[var(--border-color)] text-xs font-mono text-[var(--text-primary)] outline-none"
        >
          {ADOBE_MVP_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label} ({preset.width}×{preset.height})
            </option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-1.5">
          {ADOBE_ALLOWED_CODECS.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid={`microstock-codec-${item.id}`}
              onClick={() => onSelectCodec(item.id)}
              className={cn(
                "h-6 rounded-[var(--radius-control)] text-[10px] font-mono border transition-colors cursor-pointer",
                activeCodec === item.id
                  ? "bg-[var(--text-primary)] text-[var(--bg-app)] border-[var(--text-primary)] font-semibold"
                  : "bg-[var(--bg-input)] text-[var(--text-secondary)] border-[var(--border-color)] hover:text-[var(--text-primary)]"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <label className="flex items-center justify-between text-[11px] text-[var(--text-secondary)] cursor-pointer pt-0.5">
          <span>Seamless Loop Check (PSNR/SSIM Frame 0 vs End)</span>
          <input
            type="checkbox"
            data-testid="microstock-loop-checkbox"
            checked={manifest.isLoop}
            onChange={(e) => onUpdateManifest({ isLoop: e.target.checked })}
            className="rounded border-[var(--border-color)]"
          />
        </label>
      </div>

      {/* Generative AI Disclosure & 4-Point Compliance Gate */}
      <div className="p-2 rounded-[var(--radius-card)] bg-[var(--bg-card)] border border-[var(--border-color)] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">
            2. AI Disclosure & Contributor Gate
          </span>
          <span className="text-[10px] font-mono text-[var(--text-secondary)]">
            {aiDeclared !== null && checklistDone ? "Ready" : "Required"}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-[var(--text-primary)]">
            Created using Generative AI tools?
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="microstock-ai-yes"
              onClick={() => setAiDeclared(true)}
              className={cn(
                "h-6 px-2.5 rounded-[var(--radius-control)] text-[10px] font-mono border cursor-pointer",
                aiDeclared === true
                  ? "bg-[var(--text-primary)] text-[var(--bg-app)] border-[var(--text-primary)] font-semibold"
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
                "h-6 px-2.5 rounded-[var(--radius-control)] text-[10px] font-mono border cursor-pointer",
                aiDeclared === false
                  ? "bg-[var(--text-primary)] text-[var(--bg-app)] border-[var(--text-primary)] font-semibold"
                  : "bg-[var(--bg-input)] text-[var(--text-secondary)] border-[var(--border-color)]"
              )}
            >
              No (Code)
            </button>
          </div>
        </div>

        <div className="space-y-1 text-[11px] text-[var(--text-secondary)]">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              data-testid="microstock-check-upscaled"
              checked={checklist.notUpscaled}
              onChange={(e) => updateChecklistField("notUpscaled", e.target.checked)}
            />
            <span>Rendered natively at target resolution (never upscaled)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              data-testid="microstock-check-nologos"
              checked={checklist.noLogosWatermarksTextOrAudio}
              onChange={(e) =>
                updateChecklistField("noLogosWatermarksTextOrAudio", e.target.checked)
              }
            />
            <span>No text overlays, watermarks, brand logos, or audio tracks</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              data-testid="microstock-check-rights"
              checked={checklist.ownsFullRightsAndLicenses}
              onChange={(e) =>
                updateChecklistField("ownsFullRightsAndLicenses", e.target.checked)
              }
            />
            <span>Full commercial rights & SPDX licenses for all assets</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
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
            />
            <span>Original motion work (no external reference cloning)</span>
          </label>
        </div>
      </div>

      {/* Metadata Editor (Title <= 70, Keywords 5..49) */}
      <div className="p-2 rounded-[var(--radius-card)] bg-[var(--bg-card)] border border-[var(--border-color)] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">
            3. Adobe Stock Metadata & CSV
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
          placeholder="Descriptive title (max 70 chars, no brand names)..."
          className="w-full h-7 px-2 rounded-[var(--radius-control)] bg-[var(--bg-input)] border border-[var(--border-color)] text-xs text-[var(--text-primary)] outline-none"
        />

        <textarea
          aria-label="Adobe Stock Keywords"
          data-testid="microstock-keywords-input"
          rows={2}
          value={keywordsText}
          onChange={(e) => setKeywordsText(e.target.value)}
          onBlur={handleKeywordsBlur}
          placeholder="5–49 comma-separated keywords Ordered by importance..."
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

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          data-testid="microstock-render-btn"
          disabled={isBusy}
          onClick={onRunRenderAndPreflight}
          className="h-7 px-3 rounded-[var(--radius-control)] bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          {isBusy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5 fill-current" />
          )}
          <span>Render + Preflight</span>
        </button>

        <button
          type="button"
          data-testid="microstock-package-btn"
          disabled={isBusy}
          onClick={onBuildPackage}
          className="h-7 px-3 rounded-[var(--radius-control)] bg-[var(--text-primary)] text-[var(--bg-app)] text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          { lastPackage ? <Check className="w-3.5 h-3.5" /> : <Package className="w-3.5 h-3.5" /> }
          <span>Package CSV</span>
        </button>
      </div>
    </div>
  );
};
