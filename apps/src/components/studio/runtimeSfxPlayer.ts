/**
 * Real-time Web Audio playback for declarative `window.__audioEvents` in Studio Preview.
 * Mirrors `core/voicebox/sfx_engine.py` catalog + 0.10s per-kind cooldown deduplication so
 * live playback matches the rendered MP4 SFX timeline 1:1.
 */

export interface RuntimeAudioEvent {
  timeSec: number;
  kind: string;
  gain: number;
}

const SFX_ALIASES: Record<string, string> = {
  pop: "pop",
  tick: "tick",
  tik: "tick",
  typewriter: "tick",
  click: "tick",
  ding: "ding",
  chime: "ding",
  bell: "ding",
  question: "question",
  tanya: "question",
  sparkle: "sparkle",
  kilau: "sparkle",
  star: "sparkle",
  heart: "sparkle",
  idea: "sparkle",
  zzz: "zzz",
  sleep: "zzz",
  boing: "boing",
  hop: "boing",
  jump: "boing",
  footstep: "footstep",
  langkah: "footstep",
  step: "footstep",
  step_a: "footstep",
  whoosh: "whoosh",
  swipe: "whoosh",
  whip: "whoosh",
  "soft-whoosh": "soft-whoosh",
  soft_whoosh: "soft-whoosh",
  whoosh_lembut: "soft-whoosh",
  thud: "thud",
  impact: "thud",
  hit: "thud",
  punch: "thud",
  burst: "burst",
  seru: "burst",
  exclaim: "burst",
  alarm: "alarm",
  flash: "flash",
  kilat: "flash",
  iris: "iris",
  riser: "riser",
  fold: "fold",
  lipat: "fold",
  paper: "fold",
  kertas: "fold",
  door: "door",
  pintu: "door",
  notif: "notif",
  notification: "notif",
};

export function normalizeRuntimeSfxKind(raw: string): string {
  const key = String(raw || "pop").trim().toLowerCase();
  if (key in SFX_ALIASES) return SFX_ALIASES[key];
  for (const [alias, canon] of Object.entries(SFX_ALIASES)) {
    if (key.includes(alias)) return canon;
  }
  return "pop";
}

export function normalizeRuntimeAudioEvents(raw: unknown): RuntimeAudioEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: RuntimeAudioEvent[] = [];
  for (const item of raw) {
    if (Array.isArray(item) && item.length >= 2) {
      const t = Number(item[0]);
      if (!Number.isFinite(t) || t < 0) continue;
      const kind = normalizeRuntimeSfxKind(String(item[1]));
      const g = item.length >= 3 ? Number(item[2]) : 0.8;
      out.push({ timeSec: t, kind, gain: Math.max(0.05, Math.min(1.5, Number.isFinite(g) ? g : 0.8)) });
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const t = Number(obj.time ?? obj.t ?? 0);
      if (!Number.isFinite(t) || t < 0) continue;
      const kind = normalizeRuntimeSfxKind(String(obj.kind ?? obj.type ?? "pop"));
      const g = Number(obj.gain ?? obj.volume ?? 0.8);
      out.push({ timeSec: t, kind, gain: Math.max(0.05, Math.min(1.5, Number.isFinite(g) ? g : 0.8)) });
    }
  }
  out.sort((a, b) => a.timeSec - b.timeSec);
  return out;
}

/**
 * Pure event selector for frame-stepped playback. Only fires on normal forward playback
 * deltas `(0, 0.35s]` (skips backward scrubs or large jumps) and enforces 0.10s per-kind cooldown.
 */
export function collectTriggeredAudioEvents(
  events: readonly RuntimeAudioEvent[],
  prevTimeSec: number,
  nextTimeSec: number,
  lastByKind: Map<string, number>,
): RuntimeAudioEvent[] {
  if (events.length === 0) return [];
  const delta = nextTimeSec - prevTimeSec;
  if (delta <= 0 || delta > 0.35) return [];

  const triggered: RuntimeAudioEvent[] = [];
  for (const ev of events) {
    if (ev.timeSec < prevTimeSec) continue;
    if (ev.timeSec > nextTimeSec) break;
    const prevKindT = lastByKind.get(ev.kind) ?? -9;
    if (ev.timeSec - prevKindT < 0.1) continue;
    lastByKind.set(ev.kind, ev.timeSec);
    triggered.push(ev);
  }
  return triggered;
}

let sharedAudioCtx: AudioContext | null = null;
let sharedNoiseBuffer: AudioBuffer | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new Ctor();
  }
  if (sharedAudioCtx.state === "suspended") {
    void sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (sharedNoiseBuffer && sharedNoiseBuffer.sampleRate === ctx.sampleRate) {
    return sharedNoiseBuffer;
  }
  const len = Math.floor(ctx.sampleRate * 1.0);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let seed = 1337;
  for (let i = 0; i < len; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 0x80000000) - 1;
  }
  sharedNoiseBuffer = buf;
  return buf;
}

function scheduleSweep(
  ctx: AudioContext,
  now: number,
  f0: number,
  f1: number,
  dur: number,
  vol: number,
  type: OscillatorType = "sine",
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, f0), now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, vol), now + Math.min(0.006, dur * 0.2));
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + dur + 0.01);
}

function scheduleFilteredNoise(
  ctx: AudioContext,
  now: number,
  fStart: number,
  fEnd: number,
  q: number,
  dur: number,
  vol: number,
) {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.setValueAtTime(q, now);
  filter.frequency.setValueAtTime(Math.max(40, fStart), now);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, fEnd), now + dur);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, vol), now + dur * 0.35);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start(now);
  src.stop(now + dur + 0.02);
}

/** Plays a single runtime SFX event via Web Audio API matching the cinematic DSP catalog. */
export function playRuntimeSfxEvent(kind: string, eventGain: number, masterVolume: number): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  const vol = Math.max(0, Math.min(0.85, eventGain * masterVolume * 0.45));
  if (vol <= 0.002) return;

  const now = ctx.currentTime;
  const k = normalizeRuntimeSfxKind(kind);

  switch (k) {
    case "pop":
      scheduleSweep(ctx, now, 460, 1680, 0.09, vol * 0.8);
      scheduleFilteredNoise(ctx, now, 2200, 4200, 2.0, 0.018, vol * 0.3);
      break;
    case "tick":
      scheduleSweep(ctx, now, 2650, 1450, 0.035, vol * 0.5);
      scheduleFilteredNoise(ctx, now, 3200, 1800, 3.0, 0.02, vol * 0.4);
      break;
    case "whoosh":
      scheduleFilteredNoise(ctx, now, 260, 1400, 1.2, 0.34, vol * 0.9);
      scheduleFilteredNoise(ctx, now, 1600, 4800, 1.8, 0.28, vol * 0.45);
      break;
    case "soft-whoosh":
      scheduleFilteredNoise(ctx, now, 220, 780, 1.0, 0.52, vol * 0.65);
      break;
    case "thud":
      scheduleSweep(ctx, now, 135, 38, 0.28, vol * 1.0);
      scheduleSweep(ctx, now, 240, 88, 0.09, vol * 0.45);
      scheduleFilteredNoise(ctx, now, 1400, 600, 1.4, 0.04, vol * 0.45);
      break;
    case "ding":
      scheduleSweep(ctx, now, 1318.5, 1318.5, 0.5, vol * 0.55);
      scheduleSweep(ctx, now, 2637, 2637, 0.24, vol * 0.22);
      break;
    case "sparkle":
      [1318.5, 1568, 2093, 2637].forEach((freq, idx) => {
        scheduleSweep(ctx, now + idx * 0.065, freq, freq * 1.003, 0.3, vol * 0.35);
      });
      break;
    case "notif":
      scheduleSweep(ctx, now, 1046.5, 1046.5, 0.14, vol * 0.5);
      scheduleSweep(ctx, now + 0.12, 1568, 1568, 0.28, vol * 0.55);
      break;
    case "fold":
      scheduleFilteredNoise(ctx, now, 1200, 3600, 1.6, 0.14, vol * 0.65);
      scheduleSweep(ctx, now, 420, 960, 0.12, vol * 0.25);
      break;
    case "door":
      scheduleSweep(ctx, now, 310, 165, 0.18, vol * 0.55);
      scheduleFilteredNoise(ctx, now, 450, 1100, 1.4, 0.12, vol * 0.45);
      break;
    case "boing":
      scheduleSweep(ctx, now, 180, 440, 0.22, vol * 0.65);
      scheduleSweep(ctx, now + 0.14, 420, 260, 0.22, vol * 0.45);
      break;
    case "footstep":
      scheduleSweep(ctx, now, 130, 75, 0.06, vol * 0.45);
      scheduleFilteredNoise(ctx, now, 500, 950, 1.5, 0.04, vol * 0.35);
      break;
    case "burst":
      scheduleSweep(ctx, now, 420, 150, 0.2, vol * 0.7);
      scheduleSweep(ctx, now, 950, 1550, 0.09, vol * 0.3);
      break;
    case "flash":
      scheduleSweep(ctx, now, 340, 2600, 0.2, vol * 0.45);
      scheduleFilteredNoise(ctx, now, 2800, 7200, 1.5, 0.16, vol * 0.4);
      break;
    case "riser":
      scheduleFilteredNoise(ctx, now, 280, 5600, 1.8, 0.72, vol * 0.65);
      scheduleSweep(ctx, now, 65, 220, 0.72, vol * 0.3);
      break;
    case "question":
      scheduleSweep(ctx, now, 400, 520, 0.12, vol * 0.5);
      scheduleSweep(ctx, now + 0.11, 520, 720, 0.18, vol * 0.55);
      break;
    default:
      scheduleSweep(ctx, now, 500, 1600, 0.09, vol * 0.65);
      break;
  }
}
