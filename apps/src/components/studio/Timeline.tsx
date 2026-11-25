import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useStudioCurrentFrame, useStudioStore } from "../../hooks/useStudioStore";
import { useMicrostockStore } from "../../hooks/useMicrostockStore";
import { useTimelineFilmMeta } from "../../hooks/useTimelineFilmMeta";
import { useTimelineActions } from "../../hooks/useTimelineActions";
import { useTimelineInteractions } from "../../hooks/useTimelineInteractions";
import { type VideoLayerSpec } from "../../types/video";
import { ClipEditModal } from "./ClipEditModal";
import { TimelineHeaderToolbar } from "./timeline/TimelineHeaderToolbar";
import { TimelineTrackSidebar } from "./timeline/TimelineTrackSidebar";
import { TimelineClipLanes } from "./timeline/TimelineClipLanes";
import { buildDynamicHtmlSceneLayers } from "./timeline/timelineLayerUtils";

interface TimelineProps {
  compositionId: string;
  durationInFrames: number;
  fps: number;
  currentFrame?: number;
  isPlaying: boolean;
  onSeek: (frame: number) => void;
  onTogglePlay: () => void;
}

export const Timeline: React.FC<TimelineProps> = ({
  durationInFrames,
  fps,
  currentFrame: currentFrameProp,
  isPlaying,
  onSeek,
  onTogglePlay,
}) => {
  const storeFrame = useStudioCurrentFrame();
  const currentFrame = currentFrameProp ?? storeFrame;
  const {
    activeComposition,
    canvas,
    subtitleCues,
    renderJobs,
    actions,
  } = useStudioStore();
  const microstock = useMicrostockStore();

  const [isTimelineCollapsed, setIsTimelineCollapsed] = useState<boolean>(false);
  const [timelineZoom, setTimelineZoom] = useState<number>(0);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [modalLayer, setModalLayer] = useState<VideoLayerSpec | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const activeFilmMeta = useTimelineFilmMeta(activeComposition.id);
  const lastFrame = Math.max(0, durationInFrames - 1);
  const progress = lastFrame === 0 ? 0 : currentFrame / lastFrame;

  const baseLayers = useMemo(() => {
    const dynamicLayers = buildDynamicHtmlSceneLayers(activeFilmMeta, durationInFrames);
    return dynamicLayers ?? [];
  }, [activeFilmMeta, durationInFrames]);

  const timelineActions = useTimelineActions({
    activeComposition,
    canvas,
    renderJobs,
    actions,
    layers: baseLayers,
    durationInFrames,
    lastFrame,
    currentFrame,
    selectedLayerId,
    setSelectedLayerId,
  });

  const interactions = useTimelineInteractions({
    durationInFrames,
    lastFrame,
    currentFrame,
    timelineZoom,
    isSnapping: true,
    canvas,
    layers: baseLayers,
    layerStartFrame: activeComposition.props.layerStartFrame,
    layerDuration: activeComposition.props.layerDuration,
    onSeek,
    setSelectedLayerId,
    updateActiveProps: actions.updateActiveProps,
    onUndo: actions.undoProps,
    onRedo: actions.redoProps,
    onDuplicateLayer: timelineActions.handleDuplicateLayer,
    onSplitClip: timelineActions.handleSplitClip,
    onDeleteSelectedLayer: timelineActions.handleDeleteSelectedLayer,
  });

  // Merge local 60fps drag override so dragging never re-renders the player on every pixel
  const layers = useMemo(() => {
    if (!interactions.dragOverride) return baseLayers;
    const override = interactions.dragOverride;
    return baseLayers.map((l) =>
      l.id === override.id
        ? { ...l, from: override.from, durationInFrames: override.durationInFrames }
        : l
    );
  }, [baseLayers, interactions.dragOverride]);

  const step = (delta: number) =>
    onSeek(Math.min(lastFrame, Math.max(0, currentFrame + delta)));

  const inPercent =
    canvas.inFrame !== null && lastFrame > 0
      ? (canvas.inFrame / lastFrame) * 100
      : null;
  const outPercent =
    canvas.outFrame !== null && lastFrame > 0
      ? (canvas.outFrame / lastFrame) * 100
      : null;

  return (
    <section
      className="shrink-0 rounded-[var(--radius-panel)] border border-[var(--border-color)] bg-[var(--bg-panel)] flex flex-col select-none relative overflow-visible transition-all duration-150"
      style={{ height: isTimelineCollapsed ? "auto" : interactions.timelineHeight }}
    >
      {!isTimelineCollapsed && (
        <div
          onMouseDown={interactions.startResizeHeight}
          className="h-1 w-full cursor-row-resize hover:bg-[var(--btn-primary-bg)] transition-colors shrink-0 rounded-t-[var(--radius-panel)]"
          title="Drag to resize Timeline height"
        />
      )}

      <TimelineHeaderToolbar
        currentFrame={currentFrame}
        durationInFrames={durationInFrames}
        fps={fps}
        isPlaying={isPlaying}
        playbackRate={canvas.playbackRate}
        volume={canvas.volume ?? 1}
        isMuted={Boolean(canvas.isMuted || activeComposition.props.isMuted)}
        timelineZoom={timelineZoom}
        activeRatio={activeComposition.ratio}
        isExporting={timelineActions.isExporting}
        isCollapsed={isTimelineCollapsed}
        onToggleCollapse={() => setIsTimelineCollapsed((c) => !c)}
        onTogglePlay={onTogglePlay}
        onStep={step}
        onRatioChange={timelineActions.handleRatioChange}
        onFpsChange={(newFps) => {
          actions.updateActiveMetadata({ fps: newFps });
          toast.success(`Frame rate: ${newFps} FPS`);
        }}
        onSpeedChange={(speed) => {
          actions.updateCanvas({ playbackRate: speed });
          toast.info(`Playback speed: ${speed}x`);
        }}
        onVolumeChange={(nextVolume) => {
          actions.updateCanvas({
            volume: nextVolume,
            ...(nextVolume > 0 && canvas.isMuted ? { isMuted: false } : {}),
          });
          if (nextVolume > 0 && activeComposition.props.isMuted) {
            actions.updateActiveProps({ isMuted: false }, { recordHistory: false });
          }
        }}
        onToggleMute={() => {
          const nextMuted = !Boolean(canvas.isMuted || activeComposition.props.isMuted);
          actions.updateCanvas({ isMuted: nextMuted });
          if (activeComposition.props.isMuted) {
            actions.updateActiveProps({ isMuted: false }, { recordHistory: false });
          }
        }}
        isMicrostockActive={microstock.manifest.enabled}
        onMotionClick={() => {
          const next = !microstock.manifest.enabled;
          void microstock.actions.toggleMode(next).then(() => {
            if (!isMountedRef.current) return;
            if (next) {
              toast.success(
                "Adobe Stock Mode Active: 16:9 (1920×1080) Rec.709 • LLM Auto-Metadata"
              );
            } else {
              toast.info("Adobe Stock Mode Off: Returned to 9:16 (1080×1920)");
            }
          });
        }}
        onExport={() => {
          if (microstock.manifest.enabled) {
            void microstock.actions
              .runRenderAndPreflight({
                compositionId: activeComposition.id,
                width: activeComposition.width,
                height: activeComposition.height,
                fps: activeComposition.fps,
                durationSec: activeComposition.duration,
              })
              .then((res) => {
                if (!isMountedRef.current) return;
                if (res.ok) toast.success(res.message);
                else toast.error(res.message);
              });
          } else {
            void timelineActions.handleQuickExport();
          }
        }}
        onZoomChange={setTimelineZoom}
      />

      {!isTimelineCollapsed && (
        <div className="flex-1 flex min-h-0 overflow-hidden rounded-b-[var(--radius-panel)]">
          <TimelineTrackSidebar
            layers={layers}
            subtitles={subtitleCues}
            selectedLayerId={selectedLayerId}
            layerColors={activeComposition.props.layerColors}
            leftScrollRef={interactions.leftScrollRef}
            rightScrollRef={interactions.rightScrollRef}
            onSelectLayer={(layer) => {
              setSelectedLayerId(layer.id);
              onSeek(layer.from);
            }}
            onEditLayer={(layer) => {
              setSelectedLayerId(layer.id);
              setModalLayer(layer);
            }}
            onToggleVisibility={timelineActions.handleToggleLayerVisibility}
            onRemoveCustomLayer={timelineActions.handleRemoveCustomLayer}
          />

          <TimelineClipLanes
            layers={layers}
            subtitles={subtitleCues}
            selectedLayerId={selectedLayerId}
            layerColors={activeComposition.props.layerColors}
            durationInFrames={durationInFrames}
            lastFrame={lastFrame}
            fps={fps}
            progress={progress}
            zoomMultiplier={interactions.zoomMultiplier}
            rulerWidth={interactions.rulerWidth}
            inPercent={inPercent}
            outPercent={outPercent}
            rulerRef={interactions.rulerRef}
            leftScrollRef={interactions.leftScrollRef}
            rightScrollRef={interactions.rightScrollRef}
            setTimelineZoom={setTimelineZoom}
            onSeek={onSeek}
            onSeekFromClientX={interactions.seekFromClientX}
            onStartClipDrag={interactions.startClipDrag}
            onEditLayer={(layer) => {
              setSelectedLayerId(layer.id);
              setModalLayer(layer);
            }}
          />
        </div>
      )}

      {modalLayer && (
        <ClipEditModal
          isOpen={Boolean(modalLayer)}
          layer={modalLayer}
          onClose={() => setModalLayer(null)}
          onSaveContent={timelineActions.handleUpdateLayerContent}
          onSaveTiming={timelineActions.handleUpdateLayerTiming}
          onSaveColor={timelineActions.handleUpdateLayerColor}
          onToggleVisibility={timelineActions.handleToggleLayerVisibility}
          onDeleteCustom={timelineActions.handleRemoveCustomLayer}
          durationInFrames={durationInFrames}
          fps={fps}
        />
      )}
    </section>
  );
};
