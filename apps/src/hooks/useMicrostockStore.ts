import { useSyncExternalStore } from "react";
import { apiFetch } from "../lib/api";
import {
  ADOBE_MVP_PRESETS,
  isMicrostockChecklistComplete,
} from "../lib/microstockUtils";
import type {
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
  presetId: "adobe_1080p_16x9_30p",
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
    title: "Abstract Warm Geometric Motion Background Loop",
    keywords: [
      "abstract",
      "motion",
      "background",
      "geometric",
      "gradient",
      "minimal",
      "loop",
      "modern",
    ],
    categoryId: 10,
    categoryName: "Graphic Resources",
    editorialNotAllowedAck: true,
  },
  licenses: [],
  lastRender: null,
  lastPreflight: null,
  updatedAt: 0,
};

interface MicrostockStoreState {
  manifest: MicrostockManifest;
  activeCodec: "h264" | "prores";
  isPopoverOpen: boolean;
  isBusy: boolean;
  lastPackage: MicrostockPackageResult | null;
}

let state: MicrostockStoreState = {
  manifest: DEFAULT_MANIFEST,
  activeCodec: "h264",
  isPopoverOpen: false,
  isBusy: false,
  lastPackage: null,
};

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
    ADOBE_MVP_PRESETS.find((p) => p.id === presetId) ?? ADOBE_MVP_PRESETS[2];
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
    try {
      const res = await apiFetch(`${API_BASE}/manifest`);
      if (res.ok) {
        const json = (await res.json()) as { data?: MicrostockManifest };
        if (json.data) {
          state = {
            ...state,
            manifest: {
              ...DEFAULT_MANIFEST,
              ...json.data,
              metadata: {
                ...DEFAULT_MANIFEST.metadata,
                ...json.data.metadata,
                title:
                  json.data.metadata.title || DEFAULT_MANIFEST.metadata.title,
                keywords:
                  json.data.metadata.keywords?.length > 0
                    ? json.data.metadata.keywords
                    : DEFAULT_MANIFEST.metadata.keywords,
              },
            },
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
    const nextPresetId =
      presetId || state.manifest.presetId || "adobe_1080p_16x9_30p";

    state = {
      ...state,
      manifest: {
        ...state.manifest,
        enabled: nextEnabled,
        presetId: nextPresetId,
      },
      isPopoverOpen: nextEnabled ? true : false,
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
          presetId: nextPresetId,
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          data?: { manifest?: MicrostockManifest };
        };
        if (json.data?.manifest) {
          state = {
            ...state,
            manifest: {
              ...state.manifest,
              ...json.data.manifest,
              metadata: {
                ...state.manifest.metadata,
                ...json.data.manifest.metadata,
                title:
                  json.data.manifest.metadata.title ||
                  state.manifest.metadata.title,
                keywords:
                  json.data.manifest.metadata.keywords?.length > 0
                    ? json.data.manifest.metadata.keywords
                    : state.manifest.metadata.keywords,
              },
            },
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
          presetId,
        }),
      });
    } catch {
      // Keep local update
    }
  },

  async updateManifest(partial: Partial<MicrostockManifest>): Promise<void> {
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

    try {
      const res = await apiFetch(`${API_BASE}/manifest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: nextManifest.enabled,
          presetId: nextManifest.presetId,
          isLoop: nextManifest.isLoop,
          provenance: nextManifest.provenance,
          metadata: nextManifest.metadata,
          licenses: nextManifest.licenses,
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as { data?: MicrostockManifest };
        if (json.data) {
          state = { ...state, manifest: json.data };
          emit();
        }
      }
    } catch {
      // Keep optimistic state
    }
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
    message: string;
    preflight?: PreflightReport;
  }> {
    const { manifest } = state;
    if (
      manifest.provenance.aiDeclared === null ||
      !isMicrostockChecklistComplete(manifest.provenance.checklist)
    ) {
      state = { ...state, isPopoverOpen: true };
      emit();
      return {
        ok: false,
        message:
          "Complete Adobe Stock AI Disclosure (Yes/No) and all 4 compliance checks in the M popover before rendering.",
      };
    }

    const codec = input.codec ?? state.activeCodec;
    const totalFrames = Math.max(15, Math.round(input.durationSec * input.fps));
    const localJobId = `microstock-${Date.now().toString(36)}`;

    studioActions.upsertRenderJob({
      renderId: localJobId,
      compositionId: `${input.compositionId} [Adobe Stock]`,
      status: "rendering",
      percent: 10,
      renderedFrames: Math.round(totalFrames * 0.1),
      totalFrames,
      outputPath: "output/microstock/staging/",
      createdAt: Date.now(),
    });

    state = { ...state, isBusy: true };
    emit();

    try {
      const res = await apiFetch(`${API_BASE}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetId: manifest.presetId,
          codec,
          durationSec: Math.min(60, Math.max(5, input.durationSec)),
          fps: input.fps,
          width: input.width,
          height: input.height,
          isLoop: manifest.isLoop,
        }),
      });

      const json = (await res.json()) as {
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
        state = {
          ...state,
          isBusy: false,
          isPopoverOpen: true,
          manifest: {
            ...state.manifest,
            lastPreflight: failReport,
          },
        };
        emit();
        studioActions.upsertRenderJob({
          renderId: localJobId,
          compositionId: `${input.compositionId} [Adobe Stock]`,
          status: "error",
          percent: 100,
          renderedFrames: 0,
          totalFrames,
          outputPath: json.error || "Pre-render gate rejected",
          createdAt: Date.now(),
        });
        return {
          ok: false,
          message:
            failItems[0]?.message ||
            json.error ||
            "Adobe Stock pre-render gate rejected the composition.",
          preflight: failReport,
        };
      }

      const { render, preflight } = json.data;
      state = {
        ...state,
        isBusy: false,
        manifest: {
          ...state.manifest,
          lastRender: render,
          lastPreflight: preflight,
        },
      };
      emit();

      studioActions.upsertRenderJob({
        renderId: localJobId,
        compositionId: `${input.compositionId} [Adobe Stock]`,
        status: preflight.status === "fail" ? "error" : "done",
        percent: 100,
        renderedFrames: totalFrames,
        totalFrames,
        outputPath: render.readyPath || render.stagingPath,
        createdAt: Date.now(),
      });

      return {
        ok: preflight.status !== "fail",
        message:
          preflight.status === "fail"
            ? `Preflight failed (${preflight.items[0]?.code || "QC"})`
            : `Adobe Stock render ready (${render.readyPath || render.stagingPath})`,
        preflight,
      };
    } catch (err) {
      state = { ...state, isBusy: false };
      emit();
      return {
        ok: false,
        message: `Microstock render error: ${String(err)}`,
      };
    }
  },

  async buildPackage(slug?: string): Promise<{
    ok: boolean;
    message: string;
    result?: MicrostockPackageResult;
  }> {
    state = { ...state, isBusy: true };
    emit();
    try {
      const res = await apiFetch(`${API_BASE}/package`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const json = (await res.json()) as {
        error?: string;
        items?: PreflightItem[];
        data?: MicrostockPackageResult;
      };
      if (!res.ok || !json.data) {
        state = { ...state, isBusy: false, isPopoverOpen: true };
        emit();
        return {
          ok: false,
          message:
            json.items?.[0]?.message ||
            json.error ||
            "Failed to build Adobe Stock package.",
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
        message: `Adobe Stock package created: ${json.data.packageDir}`,
        result: json.data,
      };
    } catch (err) {
      state = { ...state, isBusy: false };
      emit();
      return {
        ok: false,
        message: `Package error: ${String(err)}`,
      };
    }
  },
};

if (typeof window !== "undefined") {
  setTimeout(() => {
    void microstockActions.syncManifest();
  }, 450);

  window.addEventListener("aetheria-folder-change", () => {
    void microstockActions.syncManifest();
  });
}

export function useMicrostockStore() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    ...snap,
    actions: microstockActions,
  };
}
