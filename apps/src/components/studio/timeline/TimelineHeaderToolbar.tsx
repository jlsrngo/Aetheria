import React, { useState, useRef, useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  LayoutTemplate,
  Gauge,
  Volume1,
  Volume2,
  VolumeX,
  Download,
  Loader2,
  Check,
  ZoomIn,
  ZoomOut,
  Film,
  Smartphone,
  Square,
  Monitor,
} from "lucide-react";
import { cn } from "../../../lib/utils";

export interface TimelineHeaderToolbarProps {
  currentFrame: number;
  durationInFrames: number;
  fps: number;
  isPlaying: boolean;
  playbackRate: number;
  volume?: number;
  isMuted?: boolean;
  timelineZoom: number;
  activeRatio: string;
  isExporting: boolean;
  onTogglePlay: () => void;
  onStep: (delta: number) => void;
  onRatioChange: (ratio: string) => void;
  onFpsChange?: (fps: number) => void;
  onSpeedChange: (speed: 0.5 | 1 | 1.5 | 2) => void;
  onVolumeChange?: (volume: number) => void;
  onToggleMute?: () => void;
  onExport: () => void;
  onZoomChange: (zoom: number) => void;
  onMotionClick?: () => void;
  isMicrostockActive?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const TimelineHeaderToolbar: React.FC<TimelineHeaderToolbarProps> = ({
  currentFrame,
  durationInFrames,
  fps,
  isPlaying,
  playbackRate,
  volume = 1,
  isMuted = false,
  timelineZoom,
  activeRatio,
  isExporting,
  onTogglePlay,
  onStep,
  onRatioChange,
  onFpsChange,
  onSpeedChange,
  onVolumeChange,
  onToggleMute,
  onExport,
  onZoomChange,
  onMotionClick,
  isMicrostockActive = false,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(1000);

  const [isRatioOpen, setIsRatioOpen] = useState(false);
  const [isSpeedOpen, setIsSpeedOpen] = useState(false);
  const [isFpsOpen, setIsFpsOpen] = useState(false);

  const clampedVolume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
  const effectiveVolumePct = isMuted ? 0 : Math.round(clampedVolume * 100);

  const ratioRef = useRef<HTMLDivElement>(null);
  const speedRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isCompact = containerWidth < 680;
  const showVolumeSlider = containerWidth >= 880;
  const showZoomControl = containerWidth >= 980;
  const isWide = containerWidth >= 1120;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ratioRef.current && !ratioRef.current.contains(e.target as Node)) {
        setIsRatioOpen(false);
      }
      if (speedRef.current && !speedRef.current.contains(e.target as Node)) {
        setIsSpeedOpen(false);
      }
      if (fpsRef.current && !fpsRef.current.contains(e.target as Node)) {
        setIsFpsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsRatioOpen(false);
        setIsSpeedOpen(false);
        setIsFpsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const timeFormatted = (currentFrame / fps).toFixed(2);
  const totalDurationFormatted = (durationInFrames / fps).toFixed(2);

  const allRatioOptions = [
    {
      value: "9:16",
      label: "9:16 Vertical",
      sub: isMicrostockActive ? "1080×1920 / 2160×3840 (Adobe Stock)" : "1080×1920 (TikTok, Shorts)",
      icon: Smartphone,
    },
    {
      value: "1:1",
      label: "1:1 Square",
      sub: isMicrostockActive ? "2160×2160 / 1080×1080 (Adobe Stock)" : "1080×1080 (Feed, Carousel)",
      icon: Square,
    },
    {
      value: "16:9",
      label: "16:9 Landscape",
      sub: isMicrostockActive ? "1920×1080 / 3840×2160 (Adobe Stock)" : "1920×1080 (YouTube, Web)",
      icon: Monitor,
    },
    {
      value: "4:5",
      label: "4:5 Portrait",
      sub: "1080×1350 (IG Portrait)",
      icon: Smartphone,
    },
  ];
  const ratioOptions = isMicrostockActive
    ? allRatioOptions.filter((r) => r.value !== "4:5")
    : allRatioOptions;

  const speedOptions: (0.5 | 1 | 1.5 | 2)[] = [0.5, 1, 1.5, 2];
  const fpsOptions: number[] = [24, 25, 30, 50, 60];

  const circleBtnBase =
    "w-full h-full flex flex-col items-center justify-center rounded-[var(--radius-pill)] border transition-colors cursor-pointer select-none p-0.5";
  const circleBtnIdle =
    "bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]";
  const circleBtnActive =
    "bg-[var(--bg-hover)] border-[var(--btn-primary-bg)] text-[var(--text-primary)]";

  return (
    <div
      ref={containerRef}
      data-testid="timeline-header-toolbar"
      className={cn(
        "h-12 px-2.5 bg-[var(--bg-panel)] flex items-center justify-between gap-2 select-none shrink-0 relative z-40 w-full",
        !isCollapsed && "border-b border-[var(--border-color)]"
      )}
    >
      {/* LEFT: Playback Transport, Timecode, and Essential Format Selectors */}
      <div className="flex items-center gap-1.5 shrink-0 relative z-50">
        {/* Transport Pill */}
        <div className="h-9 px-1 rounded-[var(--radius-pill)] bg-[var(--bg-card)] border border-[var(--border-color)] flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => onStep(-1)}
            aria-label="Step Backward 1 Frame"
            title="Step Backward 1 Frame (Left Arrow)"
            className="w-7 h-7 rounded-[var(--radius-pill)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onTogglePlay}
            data-testid="timeline-play-toggle"
            data-state={isPlaying ? "playing" : "paused"}
            aria-label={isPlaying ? "Pause" : "Play Video"}
            title={isPlaying ? "Pause (Space)" : "Play Video (Space)"}
            className="w-7 h-7 rounded-[var(--radius-pill)] bg-[#cf6613] hover:bg-[#b8580f] text-white flex items-center justify-center transition-colors active:scale-95 cursor-pointer shrink-0"
          >
            <span
              data-testid="timeline-play-shape"
              aria-hidden="true"
              className={cn(
                "bg-current transition-all duration-150",
                isPlaying ? "w-3 h-3 rounded-full" : "w-2.5 h-2.5 rounded-[2px]"
              )}
            />
          </button>

          <button
            type="button"
            onClick={() => onStep(1)}
            aria-label="Step Forward 1 Frame"
            title="Step Forward 1 Frame (Right Arrow)"
            className="w-7 h-7 rounded-[var(--radius-pill)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors cursor-pointer"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Timecode Pill */}
        <div
          data-testid="timeline-timecode-badge"
          className={cn(
            "h-9 rounded-[var(--radius-pill)] bg-[var(--bg-card)] border border-[var(--border-color)] flex items-center gap-1 font-mono shrink-0 tabular-nums",
            isCompact ? "px-2.5 text-[10px]" : "px-3 text-[11px]"
          )}
        >
          <span className="text-[var(--text-primary)] font-semibold">
            {String(currentFrame).padStart(3, "0")}
          </span>
          <span className="text-[var(--text-muted)]">/</span>
          <span className="text-[var(--text-secondary)]">{durationInFrames}</span>
          {isWide && (
            <span className="text-[var(--text-muted)] text-[10px] ml-0.5">
              ({timeFormatted}s / {totalDurationFormatted}s)
            </span>
          )}
          {!isWide && !isCompact && (
            <span className="text-[var(--text-muted)] text-[10px] ml-0.5">
              ({timeFormatted}s)
            </span>
          )}
        </div>

        {/* Aspect Ratio Circle */}
        <div ref={ratioRef} className="relative shrink-0 w-9 h-9">
          <button
            type="button"
            data-testid="timeline-ratio-btn"
            onClick={() => {
              setIsRatioOpen((v) => !v);
              setIsSpeedOpen(false);
              setIsFpsOpen(false);
            }}
            title="Video Aspect Ratio"
            className={cn(circleBtnBase, isRatioOpen ? circleBtnActive : circleBtnIdle)}
          >
            <LayoutTemplate className="w-3 h-3 text-[var(--text-primary)]" />
            <span className="font-mono font-semibold text-[7.5px] leading-none mt-0.5">
              {activeRatio || "9:16"}
            </span>
          </button>

          {isRatioOpen && (
            <div className="absolute bottom-full left-0 mb-1.5 w-60 py-1.5 rounded-[var(--radius-panel)] bg-[var(--bg-panel)] border border-[var(--border-strong)] z-50">
              <div className="px-3 py-1 text-[10px] font-semibold text-[var(--text-muted)] border-b border-[var(--border-color)] mb-1">
                Aspect Ratio
              </div>
              {ratioOptions.map((opt) => {
                const isSelected = activeRatio === opt.value;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onRatioChange(opt.value);
                      setIsRatioOpen(false);
                    }}
                    className={cn(
                      "w-full px-3 py-1.5 flex items-center justify-between text-left transition-colors cursor-pointer",
                      isSelected
                        ? "bg-[var(--bg-hover)] text-[var(--text-primary)] font-semibold"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon
                        className={cn(
                          "w-3.5 h-3.5 shrink-0",
                          isSelected ? "text-[var(--btn-primary-bg)]" : "text-[var(--text-muted)]"
                        )}
                      />
                      <div>
                        <div className="text-[11px] leading-tight font-medium">{opt.label}</div>
                        <div className="text-[9px] text-[var(--text-muted)] font-mono">{opt.sub}</div>
                      </div>
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 text-[var(--btn-primary-bg)] shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Playback Speed Circle */}
        <div ref={speedRef} className="relative shrink-0 w-9 h-9">
          <button
            type="button"
            data-testid="timeline-speed-btn"
            onClick={() => {
              setIsSpeedOpen((v) => !v);
              setIsRatioOpen(false);
              setIsFpsOpen(false);
            }}
            title="Playback Speed"
            className={cn(circleBtnBase, isSpeedOpen ? circleBtnActive : circleBtnIdle)}
          >
            <Gauge className="w-3 h-3 text-[var(--text-primary)]" />
            <span className="font-mono font-semibold text-[7.5px] leading-none mt-0.5">
              {playbackRate}x
            </span>
          </button>

          {isSpeedOpen && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-36 py-1.5 rounded-[var(--radius-panel)] bg-[var(--bg-panel)] border border-[var(--border-strong)] z-50">
              <div className="px-3 py-1 text-[10px] font-semibold text-[var(--text-muted)] border-b border-[var(--border-color)] mb-1">
                Speed
              </div>
              {speedOptions.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => {
                    onSpeedChange(rate);
                    setIsSpeedOpen(false);
                  }}
                  className={cn(
                    "w-full px-3 py-1.5 flex items-center justify-between text-left text-xs transition-colors cursor-pointer",
                    playbackRate === rate
                      ? "bg-[var(--bg-hover)] text-[var(--text-primary)] font-semibold"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  )}
                >
                  <span className="font-mono">{rate}x Speed</span>
                  {playbackRate === rate && <Check className="w-3.5 h-3.5 text-[var(--btn-primary-bg)]" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Frame Rate Circle */}
        <div ref={fpsRef} className="relative shrink-0 w-9 h-9">
          <button
            type="button"
            data-testid="timeline-fps-btn"
            onClick={() => {
              setIsFpsOpen((v) => !v);
              setIsRatioOpen(false);
              setIsSpeedOpen(false);
            }}
            title="Composition Frame Rate (FPS)"
            className={cn(circleBtnBase, isFpsOpen ? circleBtnActive : circleBtnIdle)}
          >
            <Film className="w-3 h-3 text-[var(--text-primary)]" />
            <span className="font-mono font-semibold text-[7.5px] leading-none mt-0.5">
              {fps}f
            </span>
          </button>

          {isFpsOpen && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-36 py-1.5 rounded-[var(--radius-panel)] bg-[var(--bg-panel)] border border-[var(--border-strong)] z-50">
              <div className="px-3 py-1 text-[10px] font-semibold text-[var(--text-muted)] border-b border-[var(--border-color)] mb-1">
                Frame Rate
              </div>
              {fpsOptions.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => {
                    if (onFpsChange) onFpsChange(rate);
                    setIsFpsOpen(false);
                  }}
                  className={cn(
                    "w-full px-3 py-1.5 flex items-center justify-between text-left text-xs transition-colors cursor-pointer",
                    fps === rate
                      ? "bg-[var(--bg-hover)] text-[var(--text-primary)] font-semibold"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  )}
                >
                  <span className="font-mono">{rate} FPS</span>
                  {fps === rate && <Check className="w-3.5 h-3.5 text-[var(--btn-primary-bg)]" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Microstock Mode Toggle Circle */}
        <button
          type="button"
          data-testid="timeline-motion-logo-btn"
          data-active={isMicrostockActive ? "true" : "false"}
          aria-pressed={isMicrostockActive}
          onClick={onMotionClick}
          title={
            isMicrostockActive
              ? "Adobe Stock Microstock Mode: ACTIVE (16:9 Rec.709)"
              : "Switch Engine to Adobe Stock Microstock Mode (M)"
          }
          aria-label="Motion Logo"
          className={cn(
            "w-9 h-9 rounded-[var(--radius-pill)] border flex items-center justify-center transition-colors cursor-pointer shrink-0 select-none",
            isMicrostockActive
              ? "bg-[#cf6613] hover:bg-[#b8580f] border-[#e07b27] text-white"
              : "border-[var(--border-color)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          )}
        >
          <svg
            viewBox="0 0 24 24"
            className={cn(
              "w-4 h-4",
              isMicrostockActive ? "text-current" : "text-[var(--text-primary)]"
            )}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 19V5l8 9 8-9v14" />
          </svg>
        </button>
      </div>

      {/* RIGHT: Volume, Timeline Zoom, Export MP4, Collapse */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Volume Pill */}
        <div
          className={cn(
            "h-9 flex items-center gap-1.5 border bg-[var(--bg-card)] rounded-[var(--radius-pill)] shrink-0",
            showVolumeSlider ? "px-2.5" : "w-9 justify-center p-0",
            isMuted || effectiveVolumePct === 0
              ? "border-[var(--status-error-border)]"
              : "border-[var(--border-color)]"
          )}
        >
          <button
            type="button"
            onClick={() => onToggleMute?.()}
            aria-label={isMuted || effectiveVolumePct === 0 ? "Unmute Audio" : "Mute Audio"}
            title={isMuted || effectiveVolumePct === 0 ? "Unmute Audio" : "Mute Audio"}
            className={cn(
              "w-7 h-7 rounded-[var(--radius-pill)] flex items-center justify-center transition-colors cursor-pointer",
              isMuted || effectiveVolumePct === 0
                ? "text-[var(--status-error-bar)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            )}
          >
            {isMuted || effectiveVolumePct === 0 ? (
              <VolumeX className="w-3.5 h-3.5" />
            ) : effectiveVolumePct < 50 ? (
              <Volume1 className="w-3.5 h-3.5" />
            ) : (
              <Volume2 className="w-3.5 h-3.5" />
            )}
          </button>
          {showVolumeSlider && (
            <>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={effectiveVolumePct}
                aria-label="Audio volume percentage"
                onChange={(e) => {
                  const nextPct = Number(e.target.value);
                  onVolumeChange?.(Math.max(0, Math.min(1, nextPct / 100)));
                }}
                className="w-14 h-1 accent-[#cf6613] bg-[var(--bg-input)] rounded-[var(--radius-pill)] cursor-ew-resize outline-none"
                title={`Volume: ${effectiveVolumePct}%`}
              />
              <span className="font-mono text-[10px] w-7 text-right text-[var(--text-secondary)] tabular-nums">
                {effectiveVolumePct}%
              </span>
            </>
          )}
        </div>

        {/* Timeline Zoom Pill */}
        {!isCollapsed && showZoomControl && (
          <div className="h-9 px-2.5 flex items-center gap-1 border border-[var(--border-color)] bg-[var(--bg-card)] rounded-[var(--radius-pill)] text-[10px] font-mono shrink-0">
            <button
              type="button"
              onClick={() => onZoomChange(Math.max(-100, timelineZoom - 10))}
              aria-label="Zoom Out Timeline"
              className="w-6 h-6 rounded-[var(--radius-pill)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
              title="Zoom Out Timeline"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <input
              type="range"
              min={-100}
              max={100}
              step={5}
              value={timelineZoom}
              aria-label="Timeline zoom"
              onChange={(e) => onZoomChange(Number(e.target.value))}
              className="w-14 h-1 accent-[#cf6613] bg-[var(--bg-input)] rounded-[var(--radius-pill)] cursor-ew-resize outline-none"
              title={`Timeline Zoom: ${timelineZoom > 0 ? `+${timelineZoom}%` : `${timelineZoom}%`}`}
            />
            <button
              type="button"
              onClick={() => onZoomChange(Math.min(100, timelineZoom + 10))}
              aria-label="Zoom In Timeline"
              className="w-6 h-6 rounded-[var(--radius-pill)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
              title="Zoom In Timeline"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onZoomChange(0)}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-semibold px-1 cursor-pointer tabular-nums"
              title="Reset Zoom"
            >
              {timelineZoom > 0 ? `+${timelineZoom}%` : `${timelineZoom}%`}
            </button>
          </div>
        )}

        {/* Export MP4 Pill */}
        <button
          type="button"
          onClick={onExport}
          disabled={isExporting}
          aria-label="Export Video MP4"
          title="Render & Export Video MP4"
          className={cn(
            "h-9 rounded-[var(--radius-pill)] bg-[#cf6613] hover:bg-[#b8580f] active:scale-[0.98] border border-[#e07b27] text-white flex items-center justify-center font-semibold transition-colors cursor-pointer disabled:opacity-50 shrink-0",
            isCompact ? "w-9 p-0" : "px-4 text-xs gap-1.5"
          )}
        >
          {isExporting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5 stroke-[2.25]" />
          )}
          {!isCompact && <span>Export</span>}
        </button>

        {/* Collapse / Expand Timeline Circle */}
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={isCollapsed ? "Expand Timeline" : "Collapse Timeline"}
            title={isCollapsed ? "Expand Timeline" : "Collapse Timeline"}
            className="w-9 h-9 rounded-[var(--radius-pill)] border border-[var(--border-color)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer shrink-0 flex items-center justify-center"
          >
            {isCollapsed ? (
              <ChevronUp className="w-4 h-4 shrink-0" />
            ) : (
              <ChevronDown className="w-4 h-4 shrink-0" />
            )}
          </button>
        )}
      </div>
    </div>
  );
};
