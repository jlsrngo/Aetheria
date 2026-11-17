import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMotionConfig, useMotionFrameSubscription } from "./MotionContext";
import { type HtmlFilmScene } from "./htmlStageBundle";
import {
  getEngineMediaAuthToken,
  initEngineMediaAuth,
  isEngineMediaAuthSettled,
  subscribeEngineMediaAuth,
} from "../../lib/api";
import {
  appendAudioRevision,
  computeAudioTargetSeconds,
  computeEffectiveAudioVolume,
  formatAudioErrorMessage,
  isAudioAssetFile,
  isAudioTrackFinished,
  resolveSceneAudioTracks,
  shouldResyncAudioTime,
} from "./sceneAudioUtils";

export interface SceneAudioSyncProps {
  scenes: HtmlFilmScene[];
  activeDir: string | null;
  onAudioError?: (error: string | null) => void;
}

/**
 * Synchronizes native HTMLAudioElement scene narration tracks with the custom motion clock.
 */
export const SceneAudioSync: React.FC<SceneAudioSyncProps> = ({
  scenes,
  activeDir,
  onAudioError,
}) => {
  const authToken = useSyncExternalStore(
    subscribeEngineMediaAuth,
    getEngineMediaAuthToken,
    () => null
  );
  const authSettled = useSyncExternalStore(
    subscribeEngineMediaAuth,
    isEngineMediaAuthSettled,
    () => true
  );

  const [audioRevision, setAudioRevision] = useState(0);

  useEffect(() => {
    void initEngineMediaAuth();
  }, []);

  useEffect(() => {
    const handleAudioEdited = (e: Event) => {
      const detail = (e as CustomEvent<{ file?: string }>).detail;
      if (isAudioAssetFile(detail?.file)) {
        setAudioRevision((r) => r + 1);
      }
    };
    window.addEventListener("aetheria:file.edited", handleAudioEdited);
    window.addEventListener("aetheria:sse-file-edited", handleAudioEdited);
    return () => {
      window.removeEventListener("aetheria:file.edited", handleAudioEdited);
      window.removeEventListener("aetheria:sse-file-edited", handleAudioEdited);
    };
  }, []);

  const resolvedTracks = useMemo(() => {
    // Re-resolve track URLs once Tauri runtimeAuthToken arrives or an audio asset file changes.
    void authToken;
    return resolveSceneAudioTracks(scenes, activeDir, authSettled).map((track) => ({
      ...track,
      src: appendAudioRevision(track.src, audioRevision),
    }));
  }, [scenes, activeDir, authSettled, authToken, audioRevision]);

  useEffect(() => {
    if (resolvedTracks.length === 0) {
      onAudioError?.(null);
    }
  }, [resolvedTracks.length, onAudioError]);

  if (resolvedTracks.length === 0) return null;

  return (
    <SceneAudioSyncTracks
      resolvedTracks={resolvedTracks}
      onAudioError={onAudioError}
    />
  );
};

interface SceneAudioSyncTracksProps {
  resolvedTracks: ReturnType<typeof resolveSceneAudioTracks>;
  onAudioError?: (error: string | null) => void;
}

const SceneAudioSyncTracks: React.FC<SceneAudioSyncTracksProps> = ({
  resolvedTracks,
  onAudioError,
}) => {
  const { subscribeFrame, getCurrentFrame } = useMotionFrameSubscription();
  const { fps, isPlaying, playbackRate, volume, isMuted } = useMotionConfig();
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const failedTracksRef = useRef<Map<string, string>>(new Map());

  const latestClockRef = useRef({
    frame: getCurrentFrame(),
    fps,
    isPlaying,
    playbackRate,
    volume,
    isMuted,
  });
  latestClockRef.current = {
    frame: getCurrentFrame(),
    fps,
    isPlaying,
    playbackRate,
    volume,
    isMuted,
  };

  const emitFirstTrackError = useCallback(() => {
    const first = failedTracksRef.current.values().next();
    onAudioError?.(first.done ? null : first.value);
  }, [onAudioError]);

  useEffect(() => {
    failedTracksRef.current.clear();
    onAudioError?.(null);
  }, [resolvedTracks, onAudioError]);

  const syncSingleElement = useCallback(
    (scene: HtmlFilmScene, el: HTMLAudioElement, volumeScale = 1, keyId = scene.id, labelPath = scene.audio) => {
      const clock = latestClockRef.current;
      const effectiveVolume = computeEffectiveAudioVolume(
        clock.volume,
        clock.isMuted,
        volumeScale
      );
      el.muted = clock.isMuted || effectiveVolume <= 0;
      el.volume = effectiveVolume;
      el.playbackRate = Math.max(0.25, Math.min(4, clock.playbackRate));

      const endFrame = scene.startFrame + scene.durationFrames;
      const inRange = clock.frame >= scene.startFrame && clock.frame < endFrame;
      if (!inRange) {
        if (!el.paused) el.pause();
        return;
      }

      const targetSec = computeAudioTargetSeconds(clock.frame, scene.startFrame, clock.fps);
      if (isAudioTrackFinished(targetSec, el.duration)) {
        if (!el.paused) el.pause();
        return;
      }

      if (el.readyState < 1) {
        // Wait for loadedmetadata/canplay so play() never starts from 0s before seeking.
        return;
      }

      if (shouldResyncAudioTime(el.currentTime, targetSec, clock.isPlaying, el.paused)) {
        try {
          el.currentTime = targetSec;
        } catch {
          // Audio metadata may still be loading; onLoadedMetadata will resync
        }
      }

      if (clock.isPlaying && el.paused) {
        void el.play().catch((err: unknown) => {
          const errName = err instanceof DOMException ? err.name : err instanceof Error ? err.name : undefined;
          if (errName === "AbortError") return;
          const msg = formatAudioErrorMessage(labelPath, el.error?.code, errName);
          console.error("[SceneAudioSync] play failed:", msg, err);
          failedTracksRef.current.set(keyId, msg);
          emitFirstTrackError();
        });
      } else if (!clock.isPlaying && !el.paused) {
        el.pause();
      }
    },
    [emitFirstTrackError]
  );

  const syncAllTracks = useCallback(
    (nextFrame: number) => {
      latestClockRef.current.frame = nextFrame;
      for (const track of resolvedTracks) {
        const keyId = track.trackKey || `${track.scene.id}:${track.kind || "voice"}`;
        const el = audioRefs.current.get(keyId);
        if (el) {
          syncSingleElement(
            track.scene,
            el,
            track.volumeScale ?? 1,
            keyId,
            track.kind === "sfx" ? track.scene.sfx : track.scene.audio
          );
        }
      }
    },
    [resolvedTracks, syncSingleElement]
  );

  useEffect(() => {
    syncAllTracks(getCurrentFrame());
    return subscribeFrame(syncAllTracks);
  }, [fps, isPlaying, playbackRate, volume, isMuted, syncAllTracks, subscribeFrame, getCurrentFrame]);

  useEffect(() => {
    const map = audioRefs.current;
    return () => {
      for (const el of map.values()) {
        el.pause();
      }
    };
  }, []);

  if (resolvedTracks.length === 0) return null;

  return (
    <div style={{ display: "none" }} aria-hidden="true">
      {resolvedTracks.map((track) => {
        const { scene, src } = track;
        const keyId = track.trackKey || `${scene.id}:${track.kind || "voice"}`;
        const labelPath = track.kind === "sfx" ? scene.sfx : scene.audio;
        return (
          <audio
            key={`${keyId}-${src}`}
            preload="auto"
            src={src}
            onLoadedMetadata={(e) => {
              syncSingleElement(scene, e.currentTarget, track.volumeScale ?? 1, keyId, labelPath);
            }}
            onCanPlay={(e) => {
              if (failedTracksRef.current.delete(keyId)) {
                emitFirstTrackError();
              }
              syncSingleElement(scene, e.currentTarget, track.volumeScale ?? 1, keyId, labelPath);
            }}
            onError={(e) => {
              const msg = formatAudioErrorMessage(labelPath, e.currentTarget.error?.code);
              console.error("[SceneAudioSync] media error:", msg);
              failedTracksRef.current.set(keyId, msg);
              emitFirstTrackError();
            }}
            ref={(el) => {
              if (el) {
                audioRefs.current.set(keyId, el);
              } else {
                audioRefs.current.delete(keyId);
              }
            }}
          />
        );
      })}
    </div>
  );
};
