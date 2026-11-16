import React, { createContext, useCallback, useContext, useSyncExternalStore } from "react";

export type FrameListener = (frame: number) => void;
export type SubscribeFrameFn = (listener: FrameListener) => () => void;
export type TimeListener = (timeSec: number) => void;
export type SubscribeTimeFn = (listener: TimeListener) => () => void;

export interface MotionPlaybackConfig {
  getCurrentFrame: () => number;
  subscribeFrame: SubscribeFrameFn;
  getCurrentTimeSec?: () => number;
  subscribeTime?: SubscribeTimeFn;
  fps: number;
  durationInFrames: number;
  width: number;
  height: number;
  isPlaying: boolean;
  playbackRate: number;
  volume: number;
  isMuted: boolean;
}

const noopSubscribe: SubscribeFrameFn = () => () => {};

const DEFAULT_CONFIG: MotionPlaybackConfig = {
  getCurrentFrame: () => 0,
  subscribeFrame: noopSubscribe,
  getCurrentTimeSec: () => 0,
  subscribeTime: noopSubscribe,
  fps: 30,
  durationInFrames: 1,
  width: 1080,
  height: 1920,
  isPlaying: false,
  playbackRate: 1,
  volume: 1,
  isMuted: false,
};

const MotionContext = createContext<MotionPlaybackConfig>(DEFAULT_CONFIG);

export const MotionProvider: React.FC<{
  value: MotionPlaybackConfig;
  children: React.ReactNode;
}> = ({ value, children }) => (
  <MotionContext.Provider value={value}>{children}</MotionContext.Provider>
);

export function useMotionFrame(): number {
  const { subscribeFrame, getCurrentFrame } = useContext(MotionContext);
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeFrame(() => onStoreChange()),
    [subscribeFrame]
  );
  return useSyncExternalStore(subscribe, getCurrentFrame, getCurrentFrame);
}

export function useMotionFrameSubscription(): {
  subscribeFrame: SubscribeFrameFn;
  getCurrentFrame: () => number;
  subscribeTime?: SubscribeTimeFn;
  getCurrentTimeSec?: () => number;
} {
  const { subscribeFrame, getCurrentFrame, subscribeTime, getCurrentTimeSec } =
    useContext(MotionContext);
  return { subscribeFrame, getCurrentFrame, subscribeTime, getCurrentTimeSec };
}

export function useMotionConfig(): MotionPlaybackConfig {
  return useContext(MotionContext);
}

