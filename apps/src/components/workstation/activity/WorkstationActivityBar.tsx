import { memo } from "react";
import {
  Clapperboard,
  FileCode2,
  Files,
  SlidersHorizontal,
  Layers,
  Download,
  Search,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import { useTheme } from "../../../lib/theme";

export type SidebarView =
  | "compositions"
  | "script"
  | "explorer"
  | "inspector"
  | "elements"
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
    view: "compositions",
    label: "Compositions (Scene)",
    icon: Clapperboard,
    neoOn: "bg-[#CCFF00]",
    neoOff: "bg-[#FFFDFB] hover:bg-[#CCFF00]",
  },
  {
    view: "script",
    label: "Scripts (LLM React Code)",
    icon: FileCode2,
    neoOn: "bg-sky-300",
    neoOff: "bg-[var(--bg-card)] hover:bg-sky-300",
  },
  {
    view: "explorer",
    label: "Assets & Explorer",
    icon: Files,
    neoOn: "bg-amber-200",
    neoOff: "bg-[var(--bg-card)] hover:bg-amber-200",
  },
  {
    view: "inspector",
    label: "Inspector & Properties",
    icon: SlidersHorizontal,
    neoOn: "bg-[#B388FF]",
    neoOff: "bg-[#FFFDFB] hover:bg-[#B388FF]",
  },
  {
    view: "elements",
    label: "Elements & Captions",
    icon: Layers,
    neoOn: "bg-[#FFD166]",
    neoOff: "bg-[#FFFDFB] hover:bg-[#FFD166]",
  },
  {
    view: "renders",
    label: "Render Queue (Jobs)",
    icon: Download,
    neoOn: "bg-[#FF9F43]",
    neoOff: "bg-[#FFFDFB] hover:bg-[#FF9F43]",
  },
  {
    view: "search",
    label: "Search",
    icon: Search,
    neoOn: "bg-[#67E8F9]",
    neoOff: "bg-[#FFFDFB] hover:bg-[#67E8F9]",
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
      <div className="flex flex-col items-center py-2 gap-1.5 w-full">
        {ITEMS.map(({ view, label, icon: Icon, neoOn, neoOff }) => {
          const active = !isCollapsed && activeView === view;
          return (
            <button
              key={view}
              type="button"
              onClick={() => onSelectView(view)}
              className={cn(
                "w-9 h-9 rounded-lg flex items-center justify-center transition-all cursor-pointer relative group",
                isNeobrutalism
                  ? cn(
                      "neo-icon-badge text-[#141413] border border-[#141413]",
                      active ? neoOn : neoOff
                    )
                  : active
                  ? "text-[var(--text-primary)] bg-[var(--bg-hover)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]/60"
              )}
              title={label}
              aria-label={label}
            >
              {!isNeobrutalism && active && (
                <span className="absolute left-0 top-2 bottom-2 w-0.5 bg-[var(--text-primary)] rounded-r" />
              )}
              <Icon className="w-4 h-4 stroke-[1.8]" />

              {view === "renders" && renderJobCount > 0 && (
                <span
                  className={cn(
                    "absolute -top-1 -right-1 min-w-[17px] h-[17px] px-0.5 rounded-full text-[10px] font-bold leading-none flex items-center justify-center text-center pointer-events-none select-none",
                    isNeobrutalism
                      ? "bg-[#FF9F43] text-[#141413] border border-[#141413]"
                      : "bg-[#0078d4] text-white"
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
              "w-9 h-9 rounded-lg flex items-center justify-center transition-all cursor-pointer relative group",
              isNeobrutalism
                ? cn(
                    "neo-icon-badge text-[#141413] border border-[#141413]",
                    microstockSelected ? "bg-amber-300" : "bg-[var(--bg-card)] hover:bg-amber-300"
                  )
                : microstockSelected
                ? "text-amber-400 bg-[var(--bg-hover)]"
                : "text-amber-400 hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]/60"
            )}
            title="Adobe Stock Microstock (M)"
            aria-label="Adobe Stock Microstock (M)"
          >
            {!isNeobrutalism && microstockSelected && (
              <span className="absolute left-0 top-2 bottom-2 w-0.5 bg-amber-400 rounded-r" />
            )}
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
