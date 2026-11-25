import { memo } from "react";
import {
  FileCode2,
  Files,
  Download,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import { useTheme } from "../../../lib/theme";

export type SidebarView =
  | "explorer"
  | "script"
  | "renders"
  | "search"
  | "microstock";

interface WorkstationActivityBarProps {
  activeView: SidebarView;
  isCollapsed: boolean;
  onSelectView: (view: SidebarView) => void;
  renderJobCount?: number;
  isMicrostockActive?: boolean;
}

const ITEMS: {
  view: SidebarView;
  label: string;
  icon: LucideIcon;
  neoOn: string;
  neoOff: string;
}[] = [
  {
    view: "explorer",
    label: "Files & Assets",
    icon: Files,
    neoOn: "bg-[#CCFF00]",
    neoOff: "bg-[#FFFDFB] hover:bg-[#CCFF00]",
  },
  {
    view: "script",
    label: "Scripts & Story",
    icon: FileCode2,
    neoOn: "bg-sky-300",
    neoOff: "bg-[#FFFDFB] hover:bg-sky-300",
  },
  {
    view: "renders",
    label: "Render Queue",
    icon: Download,
    neoOn: "bg-[#FF9F43]",
    neoOff: "bg-[#FFFDFB] hover:bg-[#FF9F43]",
  },
];

export const WorkstationActivityBar = memo(function WorkstationActivityBar({
  activeView,
  isCollapsed,
  onSelectView,
  renderJobCount = 0,
  isMicrostockActive = false,
}: WorkstationActivityBarProps) {
  const { isNeobrutalism } = useTheme();
  const microstockSelected = !isCollapsed && activeView === "microstock";

  return (
    <aside
      className="w-12 h-full bg-[var(--bg-app)] border-r border-[var(--border-color)] flex flex-col justify-between shrink-0 select-none z-10"
      aria-label="Activity Bar"
    >
      <div className="flex flex-col items-center py-2.5 gap-2 w-full">
        {ITEMS.map(({ view, label, icon: Icon, neoOn, neoOff }) => {
          const active = !isCollapsed && activeView === view;
          return (
            <button
              key={view}
              type="button"
              data-testid={`activity-bar-${view}-btn`}
              onClick={() => onSelectView(view)}
              className={cn(
                "w-9 h-9 rounded-[var(--radius-pill)] flex items-center justify-center transition-colors cursor-pointer relative",
                isNeobrutalism
                  ? cn(
                      "neo-icon-badge text-[#141413] border border-[#141413]",
                      active ? neoOn : neoOff
                    )
                  : active
                  ? "text-[var(--text-primary)] bg-[var(--bg-hover)] border border-[var(--border-strong)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]/60 border border-transparent"
              )}
              title={label}
              aria-label={label}
            >
              <Icon className="w-4 h-4 stroke-[1.8]" />

              {view === "renders" && renderJobCount > 0 && (
                <span
                  className={cn(
                    "absolute -top-1 -right-1 min-w-[17px] h-[17px] px-0.5 rounded-[var(--radius-pill)] text-[10px] font-bold leading-none flex items-center justify-center text-center pointer-events-none select-none",
                    isNeobrutalism
                      ? "bg-[#FF9F43] text-[#141413] border border-[#141413]"
                      : "bg-[#cf6613] text-white"
                  )}
                >
                  <span className="inline-block transform -translate-y-[0.5px]">
                    {renderJobCount > 99 ? "99+" : renderJobCount}
                  </span>
                </span>
              )}
            </button>
          );
        })}

        {isMicrostockActive && (
          <button
            type="button"
            data-testid="activity-bar-microstock-btn"
            onClick={() => onSelectView("microstock")}
            className={cn(
              "w-9 h-9 rounded-[var(--radius-pill)] flex items-center justify-center transition-colors cursor-pointer relative",
              isNeobrutalism
                ? cn(
                    "neo-icon-badge text-[#141413] border border-[#141413]",
                    microstockSelected ? "bg-[#CCFF00]" : "bg-[#FFFDFB] hover:bg-[#CCFF00]"
                  )
                : microstockSelected
                ? "text-[var(--text-primary)] bg-[var(--bg-hover)] border border-[var(--border-strong)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]/60 border border-transparent"
            )}
            title="Adobe Stock Microstock (M)"
            aria-label="Adobe Stock Microstock (M)"
          >
            <svg
              viewBox="0 0 24 24"
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 19V5l8 9 8-9v14" />
            </svg>
          </button>
        )}
      </div>
    </aside>
  );
});
