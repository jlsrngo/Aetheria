import {
  AlertTriangle,
  CheckCircle2,
  Info,
  ShieldAlert,
} from "lucide-react";
import {
  centerNoticeActions,
  useCenterNotice,
  type CenterNoticeSeverity,
} from "../../hooks/useCenterNotice";
import { cn } from "../../lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

const SEVERITY_BADGE_CLASS: Record<CenterNoticeSeverity, string> = {
  error: "border-rose-500/50 bg-rose-500/15 text-rose-400",
  warning: "border-amber-500/50 bg-amber-500/15 text-amber-400",
  success:
    "border-[var(--border-strong)] bg-[var(--bg-panel)] text-[var(--text-primary)]",
  info: "border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-primary)]",
};

function renderSeverityIcon(severity: CenterNoticeSeverity) {
  switch (severity) {
    case "error":
      return <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />;
    case "warning":
      return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;
    case "success":
      return <CheckCircle2 className="w-4 h-4 text-[var(--text-primary)] shrink-0" />;
    case "info":
      return <Info className="w-4 h-4 text-[var(--text-primary)] shrink-0" />;
  }
}

export function CenterNoticeModal() {
  const notice = useCenterNotice();

  return (
    <Dialog
      open={Boolean(notice)}
      onOpenChange={(open) => {
        if (!open) centerNoticeActions.dismiss();
      }}
    >
      {notice && (
        <DialogContent
          data-testid="center-notice-modal"
          data-severity={notice.severity}
          onClose={() => centerNoticeActions.dismiss()}
          className="max-w-lg rounded-[var(--radius-panel)] select-text"
        >
          <DialogHeader className="pr-7">
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className={cn(
                  "w-7 h-7 rounded-[var(--radius-control)] border flex items-center justify-center shrink-0",
                  SEVERITY_BADGE_CLASS[notice.severity]
                )}
              >
                {renderSeverityIcon(notice.severity)}
              </span>
              <DialogTitle
                data-testid="center-notice-title"
                className="text-sm leading-snug"
              >
                {notice.title}
              </DialogTitle>
            </div>
          </DialogHeader>

          <div className="space-y-3">
            <DialogDescription
              data-testid="center-notice-message"
              className="mt-0 text-xs text-[var(--text-primary)] whitespace-pre-line break-words leading-relaxed"
            >
              {notice.message}
            </DialogDescription>

            {notice.details && notice.details.length > 0 && (
              <ul
                data-testid="center-notice-details"
                className="p-2.5 rounded-[var(--radius-card)] bg-[var(--bg-panel)] border border-[var(--border-color)] space-y-1.5 text-[11px] text-[var(--text-secondary)]"
              >
                {notice.details.map((item, idx) => (
                  <li
                    key={`${idx}-${item.slice(0, 24)}`}
                    className="flex items-start gap-2 break-words"
                  >
                    <span className="font-mono text-[var(--text-muted)] shrink-0">
                      •
                    </span>
                    <span className="break-words">{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <DialogFooter>
            <button
              type="button"
              data-testid="center-notice-close"
              onClick={() => centerNoticeActions.dismiss()}
              className="h-8 px-4 rounded-[var(--radius-control)] bg-[var(--text-primary)] text-[var(--bg-app)] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
            >
              {notice.actionLabel || "OK"}
            </button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
