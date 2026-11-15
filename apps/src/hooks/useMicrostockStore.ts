import { useSyncExternalStore } from "react";
import { apiFetch } from "../lib/api";
import {
  ADOBE_MVP_PRESETS,
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
      title: dto.metadata?.title || current.metadata.title,
      keywords:
        dto.metadata?.keywords && dto.metadata.keywords.length > 0
          ? dto.metadata.keywords
          : current.metadata.keywords,
      categoryName: dto.metadata?.category || current.metadata.categoryName,
    },
  };
}

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
    try {
      const res = await apiFetch(`${API_BASE}/manifest`);
      if (res.ok) {
        const json = (await res.json()) as { data?: BackendManifestDto };
        if (json.data) {
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

    const cl = nextManifest.provenance.checklist;
    try {
      const res = await apiFetch(`${API_BASE}/manifest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as { data?: BackendManifestDto };
        if (json.data) {
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
        }),
      });

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
          outputPath: json.message || json.error || "Pre-render gate rejected",
          createdAt: Date.now(),
        });
        return {
          ok: false,
          message:
            failItems[0]?.message ||
            json.message ||
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
        outputPath: preflight.promotedPath || render.stagingPath,
        createdAt: Date.now(),
      });

      return {
        ok: preflight.status !== "fail",
        message:
          preflight.status === "fail"
            ? `Preflight failed (${preflight.items[0]?.code || "QC"})`
            : `Adobe Stock render ready (${preflight.promotedPath || render.stagingPath})`,
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
        state = { ...state, isBusy: false, isPopoverOpen: true };
        emit();
        return {
          ok: false,
          message:
            json.items?.[0]?.message ||
            json.message ||
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
