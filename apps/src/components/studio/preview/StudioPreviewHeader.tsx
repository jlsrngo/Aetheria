import React from "react";
import {
  Film,
  Grid,
  Maximize2,
  Repeat,
  ShieldAlert,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import type { StudioCanvasSettings, StudioComposition } from "../../../types/studio";
import { StudioProjectSelector } from "./StudioProjectSelector";
import { StudioProxyControl } from "./StudioProxyControl";

export interface StudioPreviewHeaderProps {
  activeComposition: StudioComposition;
  canvas: StudioCanvasSettings;
  numericZoom: number;
  onUpdateCanvas: (partial: Partial<StudioCanvasSettings>) => void;
  onRequestFullscreen: () => void;
  onProjectChanged: () => void;
  onProxyStreamChange?: (streamUrl: string | null) => void;
}

export const StudioPreviewHeader: React.FC<StudioPreviewHeaderProps> = ({
  activeComposition,
  canvas,
  numericZoom,
  onUpdateCanvas,
  onRequestFullscreen,
  onProjectChanged,
  onProxyStreamChange,
}) => {
  const pillBtnBase =
    "h-7 px-2.5 rounded-[var(--radius-pill)] border flex items-center justify-center gap-1.5 text-[11px] font-medium cursor-pointer transition-colors shrink-0";
  const pillBtnIdle =
    "bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border-color)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]";
  const pillBtnActive = "bg-[#cf6613] text-white border-[#e07b27]";

  return (
    <div className="border-b border-[var(--border-color)] bg-[var(--bg-panel)] flex flex-col text-[11px] shrink-0">
      {/* Row 1: Studio identity, project switcher, proxy & format */}
      <div className="h-10 px-3 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)] shrink-0">
            <Film className="w-3.5 h-3.5 text-[var(--text-primary)] shrink-0" />
            <span>Studio</span>
          </span>
          <span className="text-[var(--text-dim)] shrink-0">/</span>
          <span className="font-medium text-[var(--text-secondary)] truncate">
            {activeComposition.name.replace(/\s*\(\d+:\d+\)/g, "")}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <StudioProjectSelector onProjectChanged={onProjectChanged} />
          <StudioProxyControl onProxyStreamChange={onProxyStreamChange} />
          <span className="h-7 px-2.5 rounded-[var(--radius-pill)] bg-[var(--bg-card)] border border-[var(--border-color)] font-mono text-[10px] text-[var(--text-secondary)] font-medium inline-flex items-center shrink-0 whitespace-nowrap">
            {activeComposition.width}×{activeComposition.height} · {activeComposition.ratio}
          </span>
        </div>
      </div>

      {/* Row 2: Minimal viewport controls (Left: Zoom, Center: Safe Zone & Grid, Right: Loop & Fullscreen) */}
      <div
        data-testid="studio-preview-controls-bar"
        className="h-10 px-3 bg-[var(--bg-panel-sub)] flex items-center justify-between gap-3 overflow-x-auto no-scrollbar"
      >
        {/* Left: Compact Zoom Pill */}
        <div className="h-7 px-1 rounded-[var(--radius-pill)] bg-[var(--bg-card)] border border-[var(--border-color)] flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() =>
              onUpdateCanvas({ zoom: canvas.zoom === "fit" ? 1 : "fit", panX: 0, panY: 0 })
            }
            className={cn(
              "h-5 px-2 rounded-[var(--radius-pill)] text-[10px] font-mono font-medium cursor-pointer transition-colors",
              canvas.zoom === "fit"
                ? "bg-[#cf6613] text-white"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            )}
            title="Toggle Fit to Screen"
          >
            Fit
          </button>

          <button
            type="button"
            onClick={() =>
              onUpdateCanvas({
                zoom: Math.max(0.25, Number((numericZoom * 0.8).toFixed(2))),
              })
            }
            aria-label="Zoom Out Canvas"
            className="w-6 h-5 rounded-[var(--radius-pill)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
            title="Zoom Out Canvas"
          >
            <ZoomOut className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() => onUpdateCanvas({ zoom: "fit", panX: 0, panY: 0 })}
            className="px-1.5 font-mono text-[10px] text-[var(--text-primary)] font-medium cursor-pointer tabular-nums"
            title="Reset Zoom to Fit"
          >
            {canvas.zoom === "fit" ? "Auto" : `${Math.round(numericZoom * 100)}%`}
          </button>

          <button
            type="button"
            onClick={() =>
              onUpdateCanvas({
                zoom: Math.min(10.0, Number((numericZoom * 1.25).toFixed(2))),
              })
            }
            aria-label="Zoom In Canvas"
            className="w-6 h-5 rounded-[var(--radius-pill)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
            title="Zoom In Canvas"
          >
            <ZoomIn className="w-3 h-3" />
          </button>
        </div>

        {/* Center: Social Safe Zone & Rule-of-Thirds Grid */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onUpdateCanvas({ showGuides: !canvas.showGuides })}
            aria-label="Toggle TikTok Safe Zone Guides"
            title="Toggle Safe Zone Guides"
            className={cn(pillBtnBase, canvas.showGuides ? pillBtnActive : pillBtnIdle)}
          >
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            <span>Safe Zone</span>
          </button>

          <button
            type="button"
            onClick={() => onUpdateCanvas({ showGrid: !canvas.showGrid })}
            aria-label="Toggle Rule of Thirds Grid"
            title="Toggle Composition Grid"
            className={cn(pillBtnBase, canvas.showGrid ? pillBtnActive : pillBtnIdle)}
          >
            <Grid className="w-3.5 h-3.5 shrink-0" />
            <span>Grid</span>
          </button>
        </div>

        {/* Right: Loop & Fullscreen */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onUpdateCanvas({ loop: !canvas.loop })}
            aria-label="Toggle Playback Loop"
            title="Toggle Playback Loop"
            className={cn(
              "w-7 h-7 rounded-[var(--radius-pill)] border flex items-center justify-center cursor-pointer transition-colors",
              canvas.loop ? pillBtnActive : pillBtnIdle
            )}
          >
            <Repeat className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onRequestFullscreen}
            aria-label="Fullscreen Preview"
            title="Fullscreen Preview"
            className={cn(
              "w-7 h-7 rounded-[var(--radius-pill)] border flex items-center justify-center cursor-pointer transition-colors",
              pillBtnIdle
            )}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
