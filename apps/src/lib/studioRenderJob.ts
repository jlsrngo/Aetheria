import { toast } from "sonner";
import { apiFetch, API_BASE } from "./api";
import type {
  StudioCanvasSettings,
  StudioComposition,
  StudioRenderJob,
} from "../types/studio";

export interface MediaRenderJobParams {
  composition: StudioComposition;
  canvas: StudioCanvasSettings;
  durationInFrames: number;
  codec: "h264" | "h265" | "vp9" | "gif";
  outputName?: string;
  startMessage: string;
  failureToastPrefix: string;
  actions: {
    upsertRenderJob: (job: StudioRenderJob) => void;
    replaceRenderJob: (oldRenderId: string, nextJob: StudioRenderJob) => void;
  };
  fetchImpl?: typeof apiFetch;
  notify?: {
    info: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export type MediaRenderJobResult =
  | { ok: true; renderId: string; outputPath: string }
  | { ok: false; error: string };

/**
 * Shared media render dispatcher used by RenderQueuePanel and Timeline quick export.
 */
export async function executeMediaRenderJob({
  composition,
  canvas,
  durationInFrames,
  codec,
  outputName,
  startMessage,
  failureToastPrefix,
  actions,
  fetchImpl = apiFetch,
  notify = toast,
}: MediaRenderJobParams): Promise<MediaRenderJobResult> {
  const ext = codec === "vp9" ? "webm" : codec === "gif" ? "gif" : "mp4";
  const cleanName =
    outputName?.trim() || `${composition.id}-${Date.now().toString().slice(-4)}.${ext}`;
  const localRenderId = `render-${Date.now()}`;

  const initialJob: StudioRenderJob = {
    renderId: localRenderId,
    compositionId: composition.id,
    status: "rendering",
    percent: 5,
    renderedFrames: Math.max(1, Math.round(durationInFrames * 0.05)),
    totalFrames: durationInFrames,
    outputPath: `out/${cleanName}`,
    createdAt: Date.now(),
  };

  actions.upsertRenderJob(initialJob);
  notify.info(startMessage.replace("{outputName}", cleanName));

  try {
    const res = await fetchImpl(`${API_BASE}/render-media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        compositionId: composition.id,
        inputProps: composition.props,
        outputName: cleanName,
        ratio: composition.ratio,
        codec,
        inFrame: canvas.inFrame,
        outFrame: canvas.outFrame,
      }),
    });

    if (res.ok) {
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { renderId?: string; outputPath?: string };
      };
      if (json.data?.renderId) {
        const outputPath = json.data.outputPath || initialJob.outputPath || `out/${cleanName}`;
        actions.replaceRenderJob(localRenderId, {
          ...initialJob,
          renderId: json.data.renderId,
          outputPath,
        });
        return { ok: true, renderId: json.data.renderId, outputPath };
      }
      throw new Error(json.error || "Render worker did not return a valid renderId");
    }
    throw new Error(`Render request failed with status ${res.status}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Engine render worker is unavailable";
    actions.upsertRenderJob({
      ...initialJob,
      status: "error",
      percent: 0,
      error: msg,
    });
    notify.error(`${failureToastPrefix}: ${msg}`);
    return { ok: false, error: msg };
  }
}
