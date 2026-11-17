import { useCallback, useEffect, useRef, useState } from "react";

export interface UseMotionPlaybackOptions {
  durationInFrames: number;
  fps: number;
  playbackRate: number;
  inFrame?: number | null;
  outFrame?: number | null;
  loop?: boolean;
  onFrameUpdate?: (frame: number) => void;
  onPlayChange?: (playing: boolean) => void;
  onSeeked?: (frame: number) => void;
  onEnded?: () => void;
}

export interface MotionPlayerHandle {
  seekTo: (frame: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  getCurrentFrame: () => number;
  isPlaying: () => boolean;
  isMuted: () => boolean;
  mute: () => void;
  unmute: () => void;
  requestFullscreen: () => void;
}

export function clampFrameRange(
  frame: number,
  durationInFrames: number,
  inFrame?: number | null,
  outFrame?: number | null
): { clamped: number; minFrame: number; maxFrame: number } {
  const safeTotal = Math.max(1, Math.round(durationInFrames));
  const minFrame =
    typeof inFrame === "number" && Number.isFinite(inFrame)
      ? Math.max(0, Math.min(safeTotal - 1, Math.round(inFrame)))
      : 0;
  const maxFrame =
    typeof outFrame === "number" && Number.isFinite(outFrame)
      ? Math.max(minFrame, Math.min(safeTotal - 1, Math.round(outFrame)))
      : safeTotal - 1;
  const clamped = Math.max(minFrame, Math.min(maxFrame, Math.round(frame)));
  return { clamped, minFrame, maxFrame };
}

export function useMotionPlayback(opts: UseMotionPlaybackOptions) {
  const {
    durationInFrames,
    fps,
    playbackRate,
    inFrame,
    outFrame,
    loop = true,
    onFrameUpdate,
    onPlayChange,
    onSeeked,
    onEnded,
  } = opts;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);

  const frameFloatRef = useRef(0);
  const lastEmitFrameRef = useRef(0);
  const isPlayingRef = useRef(false);
  const lastTsRef = useRef<number | null>(null);
  const frameListenersRef = useRef<Set<(frame: number) => void>>(new Set());
  const timeListenersRef = useRef<Set<(timeSec: number) => void>>(new Set());
  const fpsRef = useRef(Math.max(1, fps));
  fpsRef.current = Math.max(1, fps);

  const callbacksRef = useRef({
    onFrameUpdate,
    onPlayChange,
    onSeeked,
    onEnded,
  });
  callbacksRef.current = { onFrameUpdate, onPlayChange, onSeeked, onEnded };

  const emitTime = useCallback((timeSec: number) => {
    timeListenersRef.current.forEach((listener) => listener(timeSec));
  }, []);

  const emitFrame = useCallback(
    (frame: number, exactTimeSec?: number) => {
      lastEmitFrameRef.current = frame;
      const tSec =
        typeof exactTimeSec === "number"
          ? exactTimeSec
          : frame / Math.max(1, fpsRef.current);
      emitTime(tSec);
      frameListenersRef.current.forEach((listener) => listener(frame));
      callbacksRef.current.onFrameUpdate?.(frame);
    },
    [emitTime]
  );

  const subscribeFrame = useCallback((listener: (frame: number) => void) => {
    frameListenersRef.current.add(listener);
    return () => {
      frameListenersRef.current.delete(listener);
    };
  }, []);

  const subscribeTime = useCallback((listener: (timeSec: number) => void) => {
    timeListenersRef.current.add(listener);
    return () => {
      timeListenersRef.current.delete(listener);
    };
  }, []);

  const setPlayingState = useCallback((next: boolean) => {
    isPlayingRef.current = next;
    setIsPlaying(next);
    callbacksRef.current.onPlayChange?.(next);
  }, []);

  const seekTo = useCallback(
    (target: number) => {
      const { clamped } = clampFrameRange(
        target,
        durationInFrames,
        inFrame,
        outFrame
      );
      frameFloatRef.current = clamped;
      emitFrame(clamped);
      callbacksRef.current.onSeeked?.(clamped);
    },
    [durationInFrames, inFrame, outFrame, emitFrame]
  );

  const play = useCallback(() => {
    const { minFrame, maxFrame } = clampFrameRange(
      frameFloatRef.current,
      durationInFrames,
      inFrame,
      outFrame
    );
    if (frameFloatRef.current >= maxFrame) {
      frameFloatRef.current = minFrame;
      emitFrame(minFrame);
    }
    lastTsRef.current = null;
    setPlayingState(true);
  }, [durationInFrames, inFrame, outFrame, emitFrame, setPlayingState]);

  const pause = useCallback(() => {
    lastTsRef.current = null;
    setPlayingState(false);
  }, [setPlayingState]);

  const toggle = useCallback(() => {
    if (isPlayingRef.current) {
      pause();
    } else {
      play();
    }
  }, [pause, play]);

  useEffect(() => {
    const { clamped } = clampFrameRange(
      frameFloatRef.current,
      durationInFrames,
      inFrame,
      outFrame
    );
    if (clamped !== lastEmitFrameRef.current) {
      frameFloatRef.current = clamped;
      emitFrame(clamped);
    }
  }, [durationInFrames, inFrame, outFrame, emitFrame]);

  useEffect(() => {
    if (!isPlaying) return;

    let rafId = 0;
    const safeFps = Math.max(1, fps);
    const rate = Math.max(0.1, playbackRate);

    const tick = (ts: number) => {
      if (!isPlayingRef.current) return;
      if (lastTsRef.current === null) {
        lastTsRef.current = ts;
      } else {
        const dtSec = Math.min(0.1, Math.max(0, (ts - lastTsRef.current) / 1000));
        lastTsRef.current = ts;
        const { minFrame, maxFrame } = clampFrameRange(
          frameFloatRef.current,
          durationInFrames,
          inFrame,
          outFrame
        );

        let nextFloat = frameFloatRef.current + dtSec * safeFps * rate;
        if (nextFloat > maxFrame) {
          if (loop) {
            const span = Math.max(1, maxFrame - minFrame + 1);
            nextFloat = minFrame + ((nextFloat - minFrame) % span);
          } else {
            frameFloatRef.current = maxFrame;
            emitFrame(maxFrame);
            setPlayingState(false);
            callbacksRef.current.onEnded?.();
            return;
          }
        }
        frameFloatRef.current = nextFloat;
        const exactTimeSec = nextFloat / safeFps;
        const rounded = Math.max(minFrame, Math.min(maxFrame, Math.floor(nextFloat)));
        if (rounded !== lastEmitFrameRef.current) {
          emitFrame(rounded, exactTimeSec);
        } else {
          emitTime(exactTimeSec);
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      lastTsRef.current = null;
    };
  }, [isPlaying, fps, playbackRate, durationInFrames, inFrame, outFrame, loop, emitFrame, emitTime, setPlayingState]);

  return {
    subscribeFrame,
    subscribeTime,
    isPlaying,
    isMuted,
    setIsMuted,
    volume,
    setVolume,
    seekTo,
    play,
    pause,
    toggle,
    getCurrentFrame: () => lastEmitFrameRef.current,
    getCurrentTimeSec: () => frameFloatRef.current / Math.max(1, fpsRef.current),
    getIsPlaying: () => isPlayingRef.current,
  };
}

