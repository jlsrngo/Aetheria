import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Zap } from "lucide-react";
import { activeDirectory } from "../../../lib/api";
import {
  buildProxyPreview,
  fetchProxyPreviewStatus,
  resolveProxyVideoStreamUrl,
} from "../../../lib/studioProxyPreview";
import { cn } from "../../../lib/utils";

export interface StudioProxyControlProps {
  onProxyStreamChange?: (streamUrl: string | null) => void;
}

export const StudioProxyControl: React.FC<StudioProxyControlProps> = ({
  onProxyStreamChange,
}) => {
  const queryClient = useQueryClient();
  const dir = activeDirectory();
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [autoEnableOnReady, setAutoEnableOnReady] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const lastNotifiedUrlRef = useRef<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ["studio-proxy-preview", dir],
    queryFn: fetchProxyPreviewStatus,
    refetchInterval: (query) =>
      query.state.data?.state === "rendering" ? 800 : 4000,
  });

  const isRendering = status?.state === "rendering";
  const isReady = status?.state === "ready";
  const streamUrl = isReady ? resolveProxyVideoStreamUrl(status) : null;

  useEffect(() => {
    if (isReady && autoEnableOnReady) {
      setProxyEnabled(true);
      setAutoEnableOnReady(false);
    } else if (!isReady && status?.state && status.state !== "rendering") {
      setProxyEnabled(false);
    }
  }, [isReady, autoEnableOnReady, status?.state]);

  useEffect(() => {
    const effective = proxyEnabled && streamUrl ? streamUrl : null;
    if (lastNotifiedUrlRef.current !== effective) {
      lastNotifiedUrlRef.current = effective;
      onProxyStreamChange?.(effective);
    }
  }, [proxyEnabled, streamUrl, onProxyStreamChange]);

  const triggerBuild = async () => {
    setLocalError(null);
    setAutoEnableOnReady(true);
    try {
      const next = await buildProxyPreview();
      queryClient.setQueryData(["studio-proxy-preview", dir], next);
      await queryClient.invalidateQueries({ queryKey: ["studio-proxy-preview"] });
    } catch (err) {
      setAutoEnableOnReady(false);
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleMainClick = () => {
    if (isRendering) return;
    if (isReady) {
      setProxyEnabled((prev) => !prev);
      return;
    }
    void triggerBuild();
  };

  const errText = localError || (status?.state === "error" ? status.message : null);

  return (
    <div className="flex items-center gap-1 shrink-0" title={errText || status?.message}>
      <button
        type="button"
        data-testid="studio-proxy-preview-btn"
        data-proxy-state={status?.state ?? "idle"}
        data-proxy-msg={errText || status?.message || ""}
        disabled={isRendering}
        onClick={handleMainClick}
        aria-label={
          isRendering
            ? "Rendering Rust proxy MP4"
            : isReady
              ? proxyEnabled
                ? "Disable Rust proxy MP4 preview"
                : "Enable Rust proxy MP4 preview"
              : "Build Rust proxy MP4 preview"
        }
        className={cn(
          "h-7 px-2.5 rounded-[var(--radius-pill)] border text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer",
          isRendering
            ? "bg-[var(--bg-card)] border-[var(--btn-primary-bg)] text-[var(--btn-primary-bg)] cursor-wait"
            : isReady && proxyEnabled
              ? "bg-[var(--text-primary)] text-[var(--bg-app)] border-[var(--text-primary)] font-semibold"
              : errText
                ? "bg-[var(--status-error-bg)] border-[var(--status-error-border)] text-white"
                : "bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        )}
      >
        {isRendering ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin text-[var(--btn-primary-bg)]" />
            <span className="font-mono">Proxy {status?.progress ?? 0}%</span>
          </>
        ) : (
          <>
            <Zap className="w-3 h-3" />
            <span>
              {isReady
                ? proxyEnabled
                  ? status?.stale
                    ? "Proxy ON*"
                    : "Proxy ON"
                  : "Proxy Ready"
                : "Fast Proxy"}
            </span>
          </>
        )}
      </button>

      {isReady && !isRendering && (
        <button
          type="button"
          data-testid="studio-proxy-rebuild-btn"
          onClick={() => void triggerBuild()}
          aria-label="Rebuild Rust proxy MP4 preview"
          title={status?.stale ? "Source changed — rebuild proxy MP4" : "Rebuild proxy MP4"}
          className={cn(
            "h-7 w-7 flex items-center justify-center rounded-[var(--radius-pill)] bg-[var(--bg-card)] border cursor-pointer transition-colors",
            status?.stale
              ? "border-[var(--btn-primary-bg)] text-[var(--btn-primary-bg)]"
              : "border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          )}
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};
