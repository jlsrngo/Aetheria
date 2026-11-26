import { describe, expect, it } from "vitest";
import {
  collectTriggeredAudioEvents,
  normalizeRuntimeAudioEvents,
  normalizeRuntimeSfxKind,
} from "./runtimeSfxPlayer";

describe("runtimeSfxPlayer", () => {
  it("normalizes Indonesian/English SFX aliases and tuple/object payloads", () => {
    expect(normalizeRuntimeSfxKind("lipat")).toBe("fold");
    expect(normalizeRuntimeSfxKind("pintu")).toBe("door");
    expect(normalizeRuntimeSfxKind("notif")).toBe("notif");
    expect(normalizeRuntimeSfxKind("whoosh_lembut")).toBe("soft-whoosh");

    const parsed = normalizeRuntimeAudioEvents([
      [1.2, "thud", 0.9],
      { time: 0.4, type: "lipat", volume: 0.7 },
      [-1, "pop", 0.5], // ignored negative
    ]);
    expect(parsed).toEqual([
      { timeSec: 0.4, kind: "fold", gain: 0.7 },
      { timeSec: 1.2, kind: "thud", gain: 0.9 },
    ]);
  });

  it("triggers events strictly on forward playback windows with 0.10s per-kind cooldown", () => {
    const events = normalizeRuntimeAudioEvents([
      [0.10, "pop", 0.8],
      [0.14, "pop", 0.8], // within 0.10s cooldown -> skipped
      [0.15, "whoosh", 0.9], // different kind -> allowed
      [0.50, "thud", 1.0],
    ]);
    const lastByKind = new Map<string, number>();

    // Normal forward tick 0.0 -> 0.20 fires pop(0.10) + whoosh(0.15)
    const hit1 = collectTriggeredAudioEvents(events, 0.0, 0.20, lastByKind);
    expect(hit1.map((e) => `${e.kind}@${e.timeSec}`)).toEqual(["pop@0.1", "whoosh@0.15"]);

    // Backward scrub or big jump > 0.35s never fires
    expect(collectTriggeredAudioEvents(events, 0.6, 0.05, lastByKind)).toEqual([]);
    expect(collectTriggeredAudioEvents(events, 0.2, 0.9, lastByKind)).toEqual([]);

    // Forward tick across 0.50 fires thud
    const hit2 = collectTriggeredAudioEvents(events, 0.45, 0.55, lastByKind);
    expect(hit2.map((e) => e.kind)).toEqual(["thud"]);
  });
});
