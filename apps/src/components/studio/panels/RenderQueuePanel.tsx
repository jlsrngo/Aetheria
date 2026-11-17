import { useEffect, useState } from "react";
import {
  Clapperboard,
  PanelLeftClose,
  GripHorizontal,
  X,
  Cpu,
  Play,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useStudioStore } from "../../../hooks/useStudioStore";
import { useMicrostockStore } from "../../../hooks/useMicrostockStore";
import { ADOBE_ALLOWED_CODECS } from "../../../lib/microstockUtils";
import { executeMediaRenderJob } from "../../../lib/studioRenderJob";
import { apiFetch, API_BASE } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import type { StudioGpuTelemetry, StudioRenderJob } from "../../../types/studio";

interface RenderQueuePanelProps {
  width?: number | string;
  onClose: () => void;
  isFloating?: boolean;
}

export function RenderQueuePanel({
  width = "100%",
  onClose,
  isFloating = false,
}: RenderQueuePanelProps) {
  const {
    activeComposition,
    durationInFrames,
    canvas,
    renderJobs,
    gpuTelemetry,
    actions,
  } = useStudioStore();
  const microstock = useMicrostockStore();
  const [codec, setCodec] = useState<"h264" | "h265" | "vp9" | "gif">("h264");
  const [outputName, setOutputName] = useState<string>("");
  const [telemetryError, setTelemetryError] = useState<string | null>(null);

  // Fetch GPU telemetry on mount
  useEffect(() => {
    let cancelled = false;
    const loadTelemetry = async () => {
      try {
        const res = await apiFetch(`${API_BASE}/studio/gpu-telemetry`);
        if (res.ok && !cancelled) {
          const json = (await res.json()) as {
            success?: boolean;
            data?: StudioGpuTelemetry;
          };
          if (json.data) {
            setTelemetryError(null);
            actions.setGpuTelemetry(json.data);
          }
        } else if (!cancelled) {
          setTelemetryError(`Telemetry unavailable (HTTP ${res.status})`);
        }
      } catch (err) {
        if (!cancelled) {
          setTelemetryError(
            err instanceof Error ? err.message : "Failed to reach GPU telemetry endpoint"
          );
        }
      }
    };
    void loadTelemetry();
    return () => {
      cancelled = true;
    };
  }, [actions]);

  // Poll active render progress from backend
  useEffect(() => {
    const hasActive = renderJobs.some(
      (j) => j.status === "rendering" || j.status === "pending"
    );
    if (!hasActive) return;

    let consecutivePollFailures = 0;
    const timer = setInterval(async () => {
      try {
        const res = await apiFetch(`${API_BASE}/render-progress`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        consecutivePollFailures = 0;
        const json = (await res.json()) as {
          success?: boolean;
          data?: StudioRenderJob[];
        };
        if (Array.isArray(json.data) && json.data.length > 0) {
          for (const job of json.data) {
            actions.upsertRenderJob(job);
          }
        }
      } catch {
        consecutivePollFailures += 1;
        if (consecutivePollFailures >= 5) {
          clearInterval(timer);
          const msg = "Lost connection to engine render worker while polling render progress";
          for (const activeJob of renderJobs) {
            if (activeJob.status === "rendering" || activeJob.status === "pending") {
              actions.upsertRenderJob({
                ...activeJob,
                status: "error",
                error: msg,
              });
            }
          }
          toast.error(msg);
        }
      }
    }, 1200);

    return () => clearInterval(timer);
  }, [renderJobs, actions]);

  const handleStartRender = async () => {
    if (microstock.manifest.enabled) {
      const res = await microstock.actions.runRenderAndPreflight({
        compositionId: activeComposition.id,
        width: activeComposition.width,
        height: activeComposition.height,
        fps: activeComposition.fps,
        durationSec: activeComposition.duration,
        codec: microstock.activeCodec,
      });
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
      return;
    }

    await executeMediaRenderJob({
      composition: activeComposition,
      canvas,
      durationInFrames,
      codec,
      outputName,
      startMessage: `Started rendering "${activeComposition.name}"`,
      failureToastPrefix: "Render failed",
      actions,
    });
  };

  return (
    <aside
      className="bg-[var(--bg-panel)] text-[var(--text-primary)] border-r border-[var(--border-color)] flex flex-col shrink-0 select-none transition-colors duration-150"
      style={{ width }}
    >
      {/* Header */}
      <div
        className="h-9 px-3 box-border border-b border-[var(--border-color)] flex items-center justify-between shrink-0"
        title="Drag header to detach into a floating resizable window"
      >
        <span className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5 min-w-0">
          <GripHorizontal className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
          <Clapperboard className="w-3.5 h-3.5 text-rose-400 shrink-0" strokeWidth={2} />
          <span className="truncate">Render Queue</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 rounded-md bg-[var(--bg-panel)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] flex items-center justify-center transition-colors cursor-pointer shrink-0"
          title={isFloating ? "Return to Sidebar" : "Close Panel (Ctrl+B)"}
        >
          {isFloating ? (
            <X className="w-3.5 h-3.5" strokeWidth={1.75} />
          ) : (
            <PanelLeftClose className="w-3.5 h-3.5" strokeWidth={1.75} />
          )}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-3 min-h-0">
        {/* 1. Hardware Encoder Telemetry */}
        <div className="p-2.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-amber-400" />
              Render Engine
            </span>
            <span
              className={cn(
                "px-2 py-0.5 rounded-full text-[9px] font-mono font-semibold border shrink-0 whitespace-nowrap",
                gpuTelemetry?.hardwareAccelerated
                  ? "bg-[var(--btn-primary-bg)] border-[var(--btn-primary-border)] text-[var(--btn-primary-text)]"
                  : "bg-[var(--bg-input)] border-[var(--border-color)] text-[var(--text-secondary)]"
              )}
            >
              {gpuTelemetry?.encoder || "h264_nvenc / libx264"}
            </span>
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] truncate">
            {telemetryError
              ? telemetryError
              : gpuTelemetry?.gpuName || "Local Nexus Renderer (Zero Cloud Cost)"}
          </div>
        </div>

        {/* 2. Export Configuration */}
        <div className="p-2.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Export Settings
            </span>
            <span className="text-[10px] font-mono text-[var(--text-secondary)]">
              {activeComposition.ratio} • {durationInFrames}f
            </span>
          </div>

          <div>
            <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">
              Output Filename
            </label>
            <input
              type="text"
              value={outputName}
              onChange={(e) => setOutputName(e.target.value)}
              placeholder={`${activeComposition.id}.mp4`}
              className="w-full h-7 px-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--border-strong)]"
            />
          </div>

          <div>
            <label className="text-[10px] text-[var(--text-muted)] block mb-1">
              Codec / Format {microstock.manifest.enabled ? "(Adobe Stock Locked)" : ""}
            </label>
            {microstock.manifest.enabled ? (
              <div className="grid grid-cols-2 gap-1">
                {ADOBE_ALLOWED_CODECS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`render-queue-codec-${item.id}`}
                    onClick={() => microstock.actions.setCodec(item.id)}
                    className={cn(
                      "h-6 rounded-md text-[10px] font-mono border transition-colors cursor-pointer",
                      microstock.activeCodec === item.id
                        ? "bg-[var(--btn-action-bg)] border-[var(--btn-action-border)] text-white font-semibold"
                        : "bg-[var(--bg-input)] border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-1">
                {(
                  [
                    { id: "h264", label: "H.264" },
                    { id: "h265", label: "H.265" },
                    { id: "vp9", label: "WebM" },
                    { id: "gif", label: "GIF" },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setCodec(item.id)}
                    className={cn(
                      "h-6 rounded-md text-[10px] font-mono border transition-colors cursor-pointer",
                      codec === item.id
                        ? "bg-[var(--btn-action-bg)] border-[var(--btn-action-border)] text-white font-semibold"
                        : "bg-[var(--bg-input)] border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void handleStartRender()}
              className="h-7 px-3.5 rounded-lg bg-[var(--btn-action-bg)] hover:bg-[var(--btn-action-hover)] border border-[var(--btn-action-border)] text-white text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap cursor-pointer transition-colors"
            >
              <Play className="w-3.5 h-3.5 fill-current shrink-0" />
              <span>
                Render Video (
                {(microstock.manifest.enabled
                  ? microstock.activeCodec
                  : codec
                ).toUpperCase()}
                )
              </span>
            </button>
          </div>
        </div>

        {/* 3. Render Queue List */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Render Jobs ({renderJobs.length})
            </span>
            {renderJobs.length > 0 && (
              <button
                type="button"
                onClick={() => actions.setRenderJobs([])}
                className="text-[10px] text-[var(--text-muted)] hover:text-rose-400 flex items-center gap-0.5 cursor-pointer"
                title="Clear Queue"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>

          {renderJobs.length === 0 ? (
            <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] text-center text-[11px] text-[var(--text-muted)]">
              No render jobs queued yet. Click{" "}
              <span className="text-[var(--text-primary)] font-medium">
                Render Video
              </span>{" "}
              above to export an MP4.
            </div>
          ) : (
            <div className="space-y-1.5">
              {renderJobs.map((job) => (
                <div
                  key={job.renderId}
                  className="p-2.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                      {job.compositionId}
                    </span>
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded-full text-[9px] font-mono font-semibold flex items-center gap-1 shrink-0 whitespace-nowrap border",
                        job.status === "done"
                          ? "bg-[var(--status-done-bg)] border-[var(--status-done-border)] text-white"
                          : job.status === "error"
                          ? "bg-[var(--status-error-bg)] border-[var(--status-error-border)] text-white"
                          : "bg-[var(--btn-primary-bg)] border-[var(--btn-primary-border)] text-[var(--btn-primary-text)]"
                      )}
                    >
                      {job.status === "done" ? (
                        <CheckCircle2 className="w-2.5 h-2.5" />
                      ) : job.status === "error" ? (
                        <AlertCircle className="w-2.5 h-2.5" />
                      ) : (
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      )}
                      {job.status.toUpperCase()}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full h-1.5 rounded-full bg-[var(--bg-input)] overflow-hidden">
                    <div
                      className={cn(
                        "h-full transition-all duration-300",
                        job.status === "done"
                          ? "bg-[var(--status-done-bar)]"
                          : job.status === "error"
                          ? "bg-[var(--status-error-bar)]"
                          : "bg-[var(--status-warn-bar)]"
                      )}
                      style={{ width: `${Math.min(100, Math.max(0, job.percent))}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)]">
                    <span className="truncate max-w-[130px]">
                      {job.outputPath || "out/video.mp4"}
                    </span>
                    <span>
                      {job.renderedFrames}/{job.totalFrames}f ({Math.round(job.percent)}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

