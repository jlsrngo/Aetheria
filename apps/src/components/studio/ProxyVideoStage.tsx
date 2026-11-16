import React, { useCallback, useEffect, useRef } from "react";
import { useMotionConfig, useMotionFrameSubscription } from "./MotionContext";

export interface ProxyVideoStageProps {
  streamUrl: string;
}

/**
 * Hardware-decoded `<video>` stage for Rust-rendered Proxy MP4 preview.
 * Synchronizes playback, seek, rate, and audio mute/volume with `MotionContext`.
 */
export const ProxyVideoStage: React.FC<ProxyVideoStageProps> = ({ streamUrl }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { subscribeFrame, getCurrentFrame } = useMotionFrameSubscription();
  const { fps, isPlaying, playbackRate, volume, isMuted } = useMotionConfig();

  const latestRef = useRef({ fps, isPlaying, playbackRate, volume, isMuted });
  latestRef.current = { fps, isPlaying, playbackRate, volume, isMuted };

  const syncFrame = useCallback((frame: number) => {
    const el = videoRef.current;
    if (!el) return;
    const cfg = latestRef.current;
    const safeFps = Math.max(1, cfg.fps);
    const targetSec = Math.max(0, frame / safeFps);

    el.muted = cfg.isMuted || cfg.volume <= 0;
    el.volume = Math.max(0, Math.min(1, cfg.volume));
    el.playbackRate = Math.max(0.25, Math.min(4, cfg.playbackRate));

    if (el.readyState >= 1) {
      const drift = Math.abs(el.currentTime - targetSec);
      const tolerance = cfg.isPlaying && !el.paused ? 0.28 : 0.03;
      if (drift > tolerance) {
        try {
          el.currentTime = targetSec;
        } catch {
          // Ignore transient seek before metadata settles
        }
      }
    }

    if (cfg.isPlaying && el.paused && el.readyState >= 1) {
      void el.play().catch(() => {});
    } else if (!cfg.isPlaying && !el.paused) {
      el.pause();
    }
  }, []);

  useEffect(() => {
    syncFrame(getCurrentFrame());
    return subscribeFrame(syncFrame);
  }, [fps, isPlaying, playbackRate, volume, isMuted, syncFrame, subscribeFrame, getCurrentFrame]);

  return (
    <div className="w-full h-full bg-[#0A0A0C] flex items-center justify-center overflow-hidden select-none">
      <video
        ref={videoRef}
        data-testid="studio-proxy-video"
        src={streamUrl}
        playsInline
        preload="auto"
        onLoadedMetadata={() => syncFrame(getCurrentFrame())}
        onCanPlay={() => syncFrame(getCurrentFrame())}
        className="w-full h-full object-contain pointer-events-none"
      />
    </div>
  );
};
