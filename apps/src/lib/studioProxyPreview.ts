import { activeDirectory, apiFetch } from "./api";
import { resolveWorkspaceAssetUrl } from "../components/studio/htmlStageBundle";

export interface ProxyPreviewStatus {
  state: "idle" | "rendering" | "ready" | "error";
  progress: number;
  message: string;
  streamPath: string | null;
  updatedAtMs: number;
  stale: boolean;
}

function buildDirQuery(): string {
  const dir = activeDirectory();
  return dir ? `?directory=${encodeURIComponent(dir)}` : "";
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const json = (await res.json()) as { data?: T; error?: string };
  if (!res.ok || json.error) {
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  if (json.data === undefined) {
    throw new Error("Missing data in Studio proxy preview response");
  }
  return json.data;
}

export async function fetchProxyPreviewStatus(): Promise<ProxyPreviewStatus> {
  const res = await apiFetch(`/api/studio/proxy-preview${buildDirQuery()}`);
  return parseJsonOrThrow<ProxyPreviewStatus>(res);
}

export async function buildProxyPreview(): Promise<ProxyPreviewStatus> {
  const res = await apiFetch(`/api/studio/proxy-preview/build${buildDirQuery()}`, {
    method: "POST",
    body: JSON.stringify({ directory: activeDirectory() || undefined }),
  });
  return parseJsonOrThrow<ProxyPreviewStatus>(res);
}

export function resolveProxyVideoStreamUrl(status: ProxyPreviewStatus | null | undefined): string | null {
  if (!status || status.state !== "ready" || !status.streamPath) {
    return null;
  }
  const base = resolveWorkspaceAssetUrl(status.streamPath);
  if (!base) return null;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}v=${status.updatedAtMs || 1}`;
}
