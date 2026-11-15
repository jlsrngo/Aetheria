import { useSyncExternalStore } from "react";
import { apiFetch } from "../lib/api";
import {
  ADOBE_MVP_PRESETS,
  getMissingMicrostockGateItems,
  isMicrostockChecklistComplete,
} from "../lib/microstockUtils";
import type {
  MicrostockChecklist,
  MicrostockManifest,
  MicrostockPackageResult,
  MicrostockRenderRecord,
  PreflightItem,
  PreflightReport,
} from "../types/microstock";
import { studioActions } from "./useStudioStore";

const API_BASE = "/api/studio/microstock";

const DEFAULT_MANIFEST: MicrostockManifest = {
  schemaVersion: 1,
  projectFolder: "default-project",
  enabled: false,
  targetMarketplace: "adobe_stock",
  presetId: "1920x1080",
  isLoop: false,
  provenance: {
    aiDeclared: null,
    generator: "Aetheria Nexus Motion Engine",
    model: null,
    promptSummary: null,
    checklist: {
      notUpscaled: false,
      noLogosWatermarksTextOrAudio: false,
      ownsFullRightsAndLicenses: false,
      notCopiedFromExternalReference: false,
    },
  },
  metadata: {
    title: "",
    keywords: [],
    categoryId: 10,
    categoryName: "Graphic resources",
    editorialNotAllowedAck: true,
  },
  licenses: [],
  lastRender: null,
  lastPreflight: null,
  updatedAt: 0,
};

interface BackendManifestDto {
  schemaVersion?: number;
  enabled?: boolean;
  preset?: string;
  fps?: number;
  codec?: string;
  isLoop?: boolean;
  provenance?: {
    aiDeclared?: boolean | null;
  };
  checklist?: {
    noLogosOrBrands?: boolean;
    noArtistOrIpNames?: boolean;
    noIdentifiablePeopleOrProperty?: boolean;
    noThirdPartyFontsOrGraphicsWithoutLicense?: boolean;
  };
  metadata?: {
    title?: string;
    keywords?: string[];
    category?: string;
  };
}

function mapBackendManifestToFrontend(
  dto: BackendManifestDto,
  current: MicrostockManifest
): MicrostockManifest {
  const cl: MicrostockChecklist = dto.checklist
    ? {
        notUpscaled: Boolean(dto.checklist.noIdentifiablePeopleOrProperty),
        noLogosWatermarksTextOrAudio: Boolean(dto.checklist.noLogosOrBrands),
        ownsFullRightsAndLicenses: Boolean(
          dto.checklist.noThirdPartyFontsOrGraphicsWithoutLicense
        ),
        notCopiedFromExternalReference: Boolean(dto.checklist.noArtistOrIpNames),
      }
    : current.provenance.checklist;

  return {
    ...current,
    enabled: typeof dto.enabled === "boolean" ? dto.enabled : current.enabled,
    presetId: dto.preset || current.presetId || "1920x1080",
    isLoop: typeof dto.isLoop === "boolean" ? dto.isLoop : current.isLoop,
    provenance: {
      ...current.provenance,
      aiDeclared:
        dto.provenance && "aiDeclared" in dto.provenance
          ? (dto.provenance.aiDeclared ?? null)
          : current.provenance.aiDeclared,
      checklist: cl,
    },
    metadata: {
      ...current.metadata,
      title:
        dto.metadata && typeof dto.metadata.title === "string"
          ? dto.metadata.title
          : current.metadata.title,
      keywords:
        dto.metadata && Array.isArray(dto.metadata.keywords)
          ? dto.metadata.keywords
          : current.metadata.keywords,
      categoryName:
        dto.metadata && typeof dto.metadata.category === "string" && dto.metadata.category.trim().length > 0
          ? dto.metadata.category
          : current.metadata.categoryName,
    },
  };
}

export interface MicrostockRenderProgress {
  renderId: string;
  status: "preparing" | "rendering" | "preflight" | "completed" | "failed";
  percent: number;
  renderedFrames: number;
  totalFrames: number;
  phaseLabel: string;
  outputPath?: string | null;
  error?: string | null;
}

interface MicrostockStoreState {
  manifest: MicrostockManifest;
  activeCodec: "h264" | "prores";
  isPopoverOpen: boolean;
  isBusy: boolean;
  lastPackage: MicrostockPackageResult | null;
  renderProgress: MicrostockRenderProgress | null;
}

let state: MicrostockStoreState = {
  manifest: DEFAULT_MANIFEST,
  activeCodec: "h264",
  isPopoverOpen: false,
  isBusy: false,
  lastPackage: null,
  renderProgress: null,
};

let manifestMutationSeq = 0;
let manifestWriteQueue: Promise<void> = Promise.resolve();
let activeRenderPollTimer: ReturnType<typeof setInterval> | null = null;

function stopRenderProgressPolling() {
  if (activeRenderPollTimer !== null) {
    clearInterval(activeRenderPollTimer);
    activeRenderPollTimer = null;
  }
}

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): MicrostockStoreState {
  return state;
}

function applyPresetToStudioComposition(presetId: string) {
  const preset =
    ADOBE_MVP_PRESETS.find((p) => p.id === presetId) ?? ADOBE_MVP_PRESETS[0];
  studioActions.updateActiveMetadata({
    ratio: preset.ratio,
    width: preset.width,
    height: preset.height,
    fps: preset.fps,
    duration: preset.recommendedDurationSec,
  });
  studioActions.updateCanvas({ zoom: "fit", panX: 0, panY: 0 });
}

export const microstockActions = {
  setPopoverOpen(isPopoverOpen: boolean) {
    if (state.isPopoverOpen === isPopoverOpen) return;
    state = { ...state, isPopoverOpen };
    emit();
  },

  setCodec(activeCodec: "h264" | "prores") {
    if (state.activeCodec === activeCodec) return;
    state = { ...state, activeCodec };
    emit();
  },

  async syncManifest(): Promise<void> {
    const startSeq = manifestMutationSeq;
    try {
      const res = await apiFetch(`${API_BASE}/manifest`);
      if (res.ok && startSeq === manifestMutationSeq) {
        const json = (await res.json()) as { data?: BackendManifestDto };
        if (json.data && startSeq === manifestMutationSeq) {
          state = {
            ...state,
            manifest: mapBackendManifestToFrontend(json.data, state.manifest),
          };
          emit();
        }
      }
    } catch {
      // Engine may still be booting
    }
  },

  async toggleMode(
    overrideEnabled?: boolean,
    presetId?: string
  ): Promise<boolean> {
    const nextEnabled =
      typeof overrideEnabled === "boolean"
        ? overrideEnabled
        : !state.manifest.enabled;
    const nextPresetId = presetId || state.manifest.presetId || "1920x1080";

    state = {
      ...state,
      manifest: {
        ...state.manifest,
        enabled: nextEnabled,
        presetId: nextPresetId,
      },
      isPopoverOpen: false,
    };
    emit();

    if (nextEnabled) {
      applyPresetToStudioComposition(nextPresetId);
    } else {
      studioActions.updateActiveMetadata({
        ratio: "9:16",
        width: 1080,
        height: 1920,
        fps: 30,
      });
      studioActions.updateCanvas({ zoom: "fit", panX: 0, panY: 0 });
    }

    try {
      const res = await apiFetch(`${API_BASE}/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: nextEnabled,
          preset: nextPresetId,
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          data?: { manifest?: BackendManifestDto };
        };
        if (json.data?.manifest) {
          state = {
            ...state,
            manifest: mapBackendManifestToFrontend(
              json.data.manifest,
              state.manifest
            ),
          };
          emit();
        }
      }
    } catch {
      // Keep optimistic in-memory toggle
    }

    return nextEnabled;
  },

  async selectPreset(presetId: string): Promise<void> {
    state = {
      ...state,
      manifest: {
        ...state.manifest,
        presetId,
      },
    };
    emit();
    applyPresetToStudioComposition(presetId);

    try {
      await apiFetch(`${API_BASE}/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: state.manifest.enabled,
          preset: presetId,
        }),
      });
    } catch {
      // Keep local update
    }
  },

  clearRenderProgress() {
    if (!state.renderProgress) return;
    state = { ...state, renderProgress: null };
    emit();
  },

  async setAiDeclared(val: boolean): Promise<void> {
    await this.updateManifest({
      provenance: {
        ...state.manifest.provenance,
        aiDeclared: val,
      },
    });
  },

  async updateChecklistField(
    key: keyof MicrostockChecklist,
    value: boolean
  ): Promise<void> {
    await this.updateManifest({
      provenance: {
        ...state.manifest.provenance,
        checklist: {
          ...state.manifest.provenance.checklist,
          [key]: value,
        },
      },
    });
  },

  async updateManifest(partial: Partial<MicrostockManifest>): Promise<void> {
    manifestMutationSeq += 1;
    const mySeq = manifestMutationSeq;
    const nextManifest: MicrostockManifest = {
      ...state.manifest,
      ...partial,
      provenance: partial.provenance
        ? { ...state.manifest.provenance, ...partial.provenance }
        : state.manifest.provenance,
      metadata: partial.metadata
        ? { ...state.manifest.metadata, ...partial.metadata }
        : state.manifest.metadata,
    };
    state = {
      ...state,
      manifest: nextManifest,
    };
    emit();

    const cl = nextManifest.provenance.checklist;
    const payloadBody = JSON.stringify({
      enabled: nextManifest.enabled,
      preset: nextManifest.presetId,
      codec: state.activeCodec,
      isLoop: nextManifest.isLoop,
      aiDeclaredPresent: true,
      aiDeclared: nextManifest.provenance.aiDeclared,
      checklist: {
        noLogosOrBrands: cl.noLogosWatermarksTextOrAudio,
        noArtistOrIpNames: cl.notCopiedFromExternalReference,
        noIdentifiablePeopleOrProperty: cl.notUpscaled,
        noThirdPartyFontsOrGraphicsWithoutLicense:
          cl.ownsFullRightsAndLicenses,
      },
      metadata: {
        title: nextManifest.metadata.title,
        keywords: nextManifest.metadata.keywords,
        category:
          nextManifest.metadata.categoryName || "Graphic Resources",
      },
    });

    const persistTask = manifestWriteQueue.then(async () => {
      try {
        const res = await apiFetch(`${API_BASE}/manifest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payloadBody,
        });
        if (res.ok && mySeq === manifestMutationSeq) {
          const json = (await res.json()) as { data?: BackendManifestDto };
          if (json.data && mySeq === manifestMutationSeq) {
            state = {
              ...state,
              manifest: mapBackendManifestToFrontend(json.data, state.manifest),
            };
            emit();
          }
        }
      } catch {
        // Keep optimistic state
      }
    });
    manifestWriteQueue = persistTask;
    await persistTask;
  },

  async runRenderAndPreflight(input: {
    compositionId: string;
    width: number;
    height: number;
    fps: number;
    durationSec: number;
    codec?: "h264" | "prores";
  }): Promise<{
    ok: boolean;
    title: string;
    message: string;
    details?: string[];
    preflight?: PreflightReport;
  }> {
    const { manifest } = state;
    const missingItems = getMissingMicrostockGateItems(
      manifest.provenance.aiDeclared,
      manifest.provenance.checklist
    );
    if (
      manifest.provenance.aiDeclared === null ||
      !isMicrostockChecklistComplete(manifest.provenance.checklist)
    ) {
      state = { ...state, isPopoverOpen: true };
      emit();
      return {
        ok: false,
        title: "Compliance Gate Incomplete",
        message:
          "Complete Generative AI disclosure (Yes/No) and confirm all 4 Adobe Stock contributor checks in section 2 before rendering.",
        details: missingItems,
      };
    }

    // Ensure pending manifest checkbox/metadata writes are flushed before backend reads manifest.json
    await manifestWriteQueue;

    const codec = input.codec ?? state.activeCodec;
    const totalFrames = Math.max(15, Math.round(input.durationSec * input.fps));
    const renderId = `msrnd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

    studioActions.upsertRenderJob({
      renderId,
      compositionId: `${input.compositionId} [Adobe Stock]`,
      status: "rendering",
      percent: 0,
      renderedFrames: 0,
      totalFrames,
      outputPath: "output/microstock/staging/",
      createdAt: Date.now(),
    });

    state = {
      ...state,
      isBusy: true,
      renderProgress: {
        renderId,
        status: "preparing",
        percent: 0,
        renderedFrames: 0,
        totalFrames,
        phaseLabel: "Preparing headless render...",
      },
    };
    emit();

    stopRenderProgressPolling();
    let pollInFlight = false;
    let pollStopped = false;
    activeRenderPollTimer = setInterval(() => {
      if (pollInFlight || pollStopped) return;
      pollInFlight = true;
      void (async () => {
        try {
          const progRes = await apiFetch(
            `/api/render-progress?renderId=${encodeURIComponent(renderId)}`
          );
          if (!progRes.ok || pollStopped) return;
          const prog = (await progRes.json()) as {
            status?: string;
            percent?: number;
            renderedFrames?: number;
            totalFrames?: number;
            outputPath?: string | null;
            error?: string | null;
          };
          if (pollStopped || prog.status === "not_found") return;

          const framesDone =
            typeof prog.renderedFrames === "number"
              ? prog.renderedFrames
              : state.renderProgress?.renderedFrames ?? 0;
          const framesTotal =
            typeof prog.totalFrames === "number" && prog.totalFrames > 0
              ? prog.totalFrames
              : totalFrames;
          const rawPct =
            typeof prog.percent === "number" ? prog.percent : 0;
          const inPreflightPhase =
            prog.status === "completed" ||
            (framesTotal > 0 && framesDone >= framesTotal);
          const nextStatus: MicrostockRenderProgress["status"] =
            prog.status === "failed"
              ? "failed"
              : inPreflightPhase
                ? "preflight"
                : "rendering";
          const nextPct = inPreflightPhase
            ? Math.min(99, Math.max(rawPct, 95))
            : Math.min(95, Math.max(0, rawPct));
          const phaseLabel =
            nextStatus === "failed"
              ? prog.error || "Render failed"
              : inPreflightPhase
                ? "Running FFmpeg & SSIM preflight..."
                : `Rendering frame ${framesDone}/${framesTotal}...`;

          state = {
            ...state,
            renderProgress: {
              renderId,
              status: nextStatus,
              percent: nextPct,
              renderedFrames: framesDone,
              totalFrames: framesTotal,
              phaseLabel,
              outputPath: prog.outputPath,
              error: prog.error,
            },
          };
          emit();

          studioActions.upsertRenderJob({
            renderId,
            compositionId: `${input.compositionId} [Adobe Stock]`,
            status: nextStatus === "failed" ? "error" : "rendering",
            percent: nextPct,
            renderedFrames: framesDone,
            totalFrames: framesTotal,
            outputPath: prog.outputPath || "output/microstock/staging/",
            createdAt: Date.now(),
          });
        } catch {
          // Ignore transient polling errors while render is running
        } finally {
          pollInFlight = false;
        }
      })();
    }, 300);

    try {
      const res = await apiFetch(`${API_BASE}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renderId,
          presetId: manifest.presetId,
          codec,
          durationSec: Math.min(60, Math.max(5, input.durationSec)),
          fps: input.fps,
          width: input.width,
          height: input.height,
        }),
      });

      pollStopped = true;
      stopRenderProgressPolling();

      const json = (await res.json()) as {
        message?: string;
        error?: string;
        items?: PreflightItem[];
        data?: {
          render?: MicrostockRenderRecord;
          preflight?: PreflightReport;
        };
      };

      if (!res.ok || !json.data?.render || !json.data?.preflight) {
        const failItems = json.items ?? [];
        const failReport: PreflightReport = {
          status: "fail",
          checkedAt: Date.now(),
          items: failItems,
        };
        const errMsg =
          failItems[0]?.message ||
          json.message ||
          json.error ||
          "Adobe Stock pre-render gate rejected the composition.";
        state = {
          ...state,
          isBusy: false,
          isPopoverOpen: true,
          manifest: {
            ...state.manifest,
            lastPreflight: failReport,
          },
          renderProgress: {
            renderId,
            status: "failed",
            percent: state.renderProgress?.percent ?? 0,
            renderedFrames: state.renderProgress?.renderedFrames ?? 0,
            totalFrames,
            phaseLabel: "Render blocked by Adobe Stock preflight",
            error: errMsg,
          },
        };
        emit();
        studioActions.upsertRenderJob({
          renderId,
          compositionId: `${input.compositionId} [Adobe Stock]`,
          status: "error",
          percent: 100,
          renderedFrames: 0,
          totalFrames,
          outputPath: json.message || json.error || "Pre-render gate rejected",
          createdAt: Date.now(),
        });
        return {
          ok: false,
          title: "Adobe Stock Render Blocked",
          message: errMsg,
          details: failItems.map((item) => `[${item.code}] ${item.message}`),
          preflight: failReport,
        };
      }

      const { render, preflight } = json.data;
      const preflightFailed = preflight.status === "fail";
      state = {
        ...state,
        isBusy: false,
        manifest: {
          ...state.manifest,
          lastRender: render,
          lastPreflight: preflight,
        },
        renderProgress: {
          renderId,
          status: preflightFailed ? "failed" : "completed",
          percent: 100,
          renderedFrames: totalFrames,
          totalFrames,
          phaseLabel: preflightFailed
            ? "Preflight check failed"
            : "Render & preflight complete",
          outputPath: preflight.promotedPath || render.stagingPath,
          error: preflightFailed
            ? preflight.items.find((i) => i.severity === "fail")?.message ||
              "Preflight QC failed"
            : null,
        },
      };
      emit();

      studioActions.upsertRenderJob({
        renderId,
        compositionId: `${input.compositionId} [Adobe Stock]`,
        status: preflightFailed ? "error" : "done",
        percent: 100,
        renderedFrames: totalFrames,
        totalFrames,
        outputPath: preflight.promotedPath || render.stagingPath,
        createdAt: Date.now(),
      });

      const issueDetails = preflight.items
        .filter((i) => i.severity === "fail" || i.severity === "warn")
        .map((i) => `[${i.code}] ${i.message}`);

      return {
        ok: !preflightFailed,
        title: preflightFailed
          ? "Post-Render Preflight Failed"
          : "Adobe Stock Render Complete",
        message: preflightFailed
          ? `Preflight rejected rendered clip (${preflight.items[0]?.code || "QC"}).`
          : `Rendered & verified cleanly:\n${preflight.promotedPath || render.stagingPath}`,
        details: issueDetails.length > 0 ? issueDetails : undefined,
        preflight,
      };
    } catch (err) {
      pollStopped = true;
      stopRenderProgressPolling();
      const errMsg = `Microstock render error: ${String(err)}`;
      state = {
        ...state,
        isBusy: false,
        renderProgress: {
          renderId,
          status: "failed",
          percent: state.renderProgress?.percent ?? 0,
          renderedFrames: state.renderProgress?.renderedFrames ?? 0,
          totalFrames,
          phaseLabel: "Render request failed",
          error: errMsg,
        },
      };
      emit();
      return {
        ok: false,
        title: "Render Failed",
        message: errMsg,
      };
    } finally {
      pollStopped = true;
      stopRenderProgressPolling();
    }
  },

  async buildPackage(slug?: string): Promise<{
    ok: boolean;
    title: string;
    message: string;
    details?: string[];
    result?: MicrostockPackageResult;
  }> {
    await manifestWriteQueue;
    state = { ...state, isBusy: true };
    emit();
    try {
      const res = await apiFetch(`${API_BASE}/package`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: slug,
          metadata: {
            title: state.manifest.metadata.title,
            keywords: state.manifest.metadata.keywords,
            category:
              state.manifest.metadata.categoryName || "Graphic Resources",
          },
        }),
      });
      const json = (await res.json()) as {
        message?: string;
        error?: string;
        items?: PreflightItem[];
        data?: MicrostockPackageResult;
      };
      if (!res.ok || !json.data) {
        const msg =
          json.items?.[0]?.message ||
          json.message ||
          json.error ||
          "Failed to build Adobe Stock package.";
        state = { ...state, isBusy: false, isPopoverOpen: true };
        emit();
        return {
          ok: false,
          title: "Adobe Stock Packaging Failed",
          message: msg,
          details: json.items?.map((i) => `[${i.code}] ${i.message}`),
        };
      }
      state = {
        ...state,
        isBusy: false,
        lastPackage: json.data,
      };
      emit();
      return {
        ok: true,
        title: "Adobe Stock Package Ready",
        message: `Created upload package with video + metadata.csv:\n${json.data.packageDir}`,
        details: [
          `Video: ${json.data.videoFile}`,
          `CSV: ${json.data.csvPath}`,
        ],
        result: json.data,
      };
    } catch (err) {
      state = { ...state, isBusy: false };
      emit();
      return {
        ok: false,
        title: "Package Error",
        message: `Package error: ${String(err)}`,
      };
    }
  },
};

if (typeof window !== "undefined") {
  setTimeout(() => {
    void microstockActions.syncManifest();
  }, 450);

  const syncIfManifestPath = (rawPath: unknown) => {
    if (typeof rawPath !== "string") return;
    const normalized = rawPath.replace(/\\/g, "/").toLowerCase();
    if (normalized.endsWith("manifest.json")) {
      void microstockActions.syncManifest();
    }
  };

  window.addEventListener("aetheria-folder-change", () => {
    void microstockActions.syncManifest();
  });

  window.addEventListener("aetheria-film-updated", () => {
    void microstockActions.syncManifest();
  });

  window.addEventListener("aetheria:session-idle", () => {
    void microstockActions.syncManifest();
  });

  window.addEventListener("focus", () => {
    void microstockActions.syncManifest();
  });

  window.addEventListener("aetheria:sse-file-edited", (event: Event) => {
    const detail = (event as CustomEvent<{ file?: string }>).detail;
    syncIfManifestPath(detail?.file);
  });

  window.addEventListener("aetheria:file.edited", (event: Event) => {
    const detail = (event as CustomEvent<{ file?: string }>).detail;
    syncIfManifestPath(detail?.file);
  });
}

export function useMicrostockStore() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    ...snap,
    actions: microstockActions,
  };
}
