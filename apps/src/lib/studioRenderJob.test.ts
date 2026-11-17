import { describe, expect, it, vi } from "vitest";
import { executeMediaRenderJob } from "./studioRenderJob";
import type { StudioComposition, StudioRenderJob } from "../types/studio";

function makeComposition(): StudioComposition {
  return {
    id: "comp-test",
    name: "Test Comp",
    folder: "comp-test",
    ratio: "9:16",
    duration: 5,
    fps: 30,
    width: 1080,
    height: 1920,
    props: {} as StudioComposition["props"],
  };
}

describe("executeMediaRenderJob", () => {
  it("replaces optimistic local render job with server renderId while preserving other jobs", async () => {
    const jobs: StudioRenderJob[] = [
      {
        renderId: "existing-job",
        compositionId: "other",
        status: "done",
        percent: 100,
        renderedFrames: 30,
        totalFrames: 30,
        createdAt: 1,
      },
    ];
    const upsertRenderJob = vi.fn((job: StudioRenderJob) => {
      const idx = jobs.findIndex((j) => j.renderId === job.renderId);
      if (idx >= 0) jobs[idx] = job;
      else jobs.unshift(job);
    });
    const replaceRenderJob = vi.fn((oldId: string, nextJob: StudioRenderJob) => {
      const filtered = jobs.filter((j) => j.renderId !== oldId);
      filtered.unshift(nextJob);
      jobs.splice(0, jobs.length, ...filtered);
    });
    const notify = { info: vi.fn(), error: vi.fn() };
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ success: true, data: { renderId: "srv-42", outputPath: "out/custom.mp4" } }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;

    const result = await executeMediaRenderJob({
      composition: makeComposition(),
      canvas: {
        zoom: "fit",
        showGuides: false,
        showRulers: false,
        showGrid: false,
        gridCols: 3,
        gridRows: 3,
        showCheckerboard: false,
        showTimeline: true,
        loop: true,
        playbackRate: 1,
        inFrame: null,
        outFrame: null,
      },
      durationInFrames: 150,
      codec: "h264",
      outputName: "custom.mp4",
      startMessage: "Exporting {outputName}",
      failureToastPrefix: "Export failed",
      actions: { upsertRenderJob, replaceRenderJob },
      fetchImpl: fetchImpl as never,
      notify,
    });

    expect(result).toEqual({ ok: true, renderId: "srv-42", outputPath: "out/custom.mp4" });
    expect(jobs.some((j) => j.renderId === "existing-job")).toBe(true);
    expect(jobs.some((j) => j.renderId === "srv-42")).toBe(true);
    expect(notify.error).not.toHaveBeenCalled();
  });

  it("marks job as error and surfaces failure toast when backend returns HTTP 500", async () => {
    const upsertRenderJob = vi.fn();
    const replaceRenderJob = vi.fn();
    const notify = { info: vi.fn(), error: vi.fn() };
    const fetchImpl = vi.fn(async () => new Response("err", { status: 500 })) as unknown as typeof fetch;

    const result = await executeMediaRenderJob({
      composition: makeComposition(),
      canvas: {
        zoom: "fit",
        showGuides: false,
        showRulers: false,
        showGrid: false,
        gridCols: 3,
        gridRows: 3,
        showCheckerboard: false,
        showTimeline: true,
        loop: true,
        playbackRate: 1,
        inFrame: null,
        outFrame: null,
      },
      durationInFrames: 150,
      codec: "h264",
      startMessage: "Exporting",
      failureToastPrefix: "Export failed",
      actions: { upsertRenderJob, replaceRenderJob },
      fetchImpl: fetchImpl as never,
      notify,
    });

    expect(result.ok).toBe(false);
    expect(upsertRenderJob).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error", percent: 0, error: "Render request failed with status 500" })
    );
    expect(notify.error).toHaveBeenCalledWith("Export failed: Render request failed with status 500");
    expect(replaceRenderJob).not.toHaveBeenCalled();
  });
});
