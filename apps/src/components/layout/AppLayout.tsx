import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { ErrorBoundary } from "../common/ErrorBoundary";
import { AppHeader } from "./AppHeader";
import { AppFooter } from "./AppFooter";
import { useAppNetworkStatus } from "./hooks/useAppNetworkStatus";
import { useActiveFolderSync } from "./hooks/useActiveFolderSync";

const UnifiedWorkstationPage = lazy(() =>
  import("../../pages/UnifiedWorkstationPage").then((m) => ({
    default: m.UnifiedWorkstationPage,
  }))
);

const StockVaultPage = lazy(() =>
  import("../../pages/StockVaultPage").then((m) => ({ default: m.StockVaultPage }))
);
const SchedulePage = lazy(() =>
  import("../../pages/SchedulePage").then((m) => ({ default: m.SchedulePage }))
);
const AnalyticsPage = lazy(() =>
  import("../../pages/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage }))
);
const SettingsPage = lazy(() =>
  import("../../pages/SettingsPage").then((m) => ({ default: m.SettingsPage }))
);

export function AppLayout() {
  const location = useLocation();
  const [routeResetKey, setRouteResetKey] = useState(0);
  const { isOnline } = useAppNetworkStatus();
  const {
    activeFolder,
    handleOpenFolder,
    handleCloseFolder,
  } = useActiveFolderSync();

  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        console.info("[AETHERIA_UI_PAINTED]");
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  const isStudioRoute =
    location.pathname === "/" || location.pathname.startsWith("/workspace");

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[var(--bg-app)] text-[var(--text-primary)] select-none">
      {/* 1. Header Bar: brand, menus, window controls */}
      <AppHeader
        activeFolder={activeFolder}
        onOpenFolder={handleOpenFolder}
        onCloseFolder={handleCloseFolder}
      />

      {/* 2. Main Keep-Alive Container */}
      <main className="flex-1 min-h-0 w-full overflow-hidden flex flex-col relative bg-[var(--bg-app)]">
        <div
          className={cn(
            "w-full h-full flex flex-col flex-1",
            !isStudioRoute && "hidden"
          )}
        >
          <ErrorBoundary
            key={`studio-route-${routeResetKey}`}
            fullScreen={false}
            fallbackTitle="Workstation view encountered an error"
            onReset={() => setRouteResetKey((k) => k + 1)}
          >
            <Suspense fallback={<div className="w-full h-full flex-1 bg-[var(--bg-app)]" />}>
              <UnifiedWorkstationPage />
            </Suspense>
          </ErrorBoundary>
        </div>

        <ErrorBoundary
          key={`page-route-${location.pathname}-${routeResetKey}`}
          fullScreen={false}
          fallbackTitle="Page failed to load"
          onReset={() => setRouteResetKey((k) => k + 1)}
        >
          <Suspense fallback={<div className="w-full h-full flex-1 bg-[var(--bg-app)]" />}>
            {location.pathname === "/stock" && (
            <div className="w-full h-full flex flex-col flex-1">
              <StockVaultPage />
            </div>
          )}
          {location.pathname === "/schedule" && (
            <div className="w-full h-full flex flex-col flex-1">
              <SchedulePage />
            </div>
          )}
          {location.pathname === "/analytics" && (
            <div className="w-full h-full flex flex-col flex-1">
              <AnalyticsPage />
            </div>
          )}
            {location.pathname === "/settings" && (
              <div className="w-full h-full flex flex-col flex-1">
                <SettingsPage />
              </div>
            )}
          </Suspense>
        </ErrorBoundary>
      </main>

      {/* 3. Footer Bar (Edge-to-edge status bar matching technical blueprint) */}
      <AppFooter
        activeFolder={activeFolder}
        isOnline={isOnline}
        onOpenFolder={handleOpenFolder}
      />
    </div>
  );
}
