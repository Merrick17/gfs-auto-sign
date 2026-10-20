import { Ban, Check, X } from "@/components/icons";
import type { Step, StatusView, Tone } from "@/lib/view-model";
import { cn } from "@/lib/utils";
import { Time } from "./time";

const DOT: Record<Tone, string> = {
  neutral: "bg-subtle",
  running: "bg-primary animate-pulse-ring",
  success: "bg-success",
  warning: "bg-warning-dot",
  danger: "bg-danger",
  muted: "bg-border-strong",
};

const TEXT: Record<Tone, string> = {
  neutral: "text-foreground",
  running: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  muted: "text-muted-foreground",
};

export function StatusLabel({ status, className }: { status: StatusView; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-dense font-medium", TEXT[status.tone], className)}>
      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", DOT[status.tone])} />
      {status.label}
    </span>
  );
}

function Marker({ state }: { state: Step["state"] }) {
  const base = "relative z-10 grid size-4 shrink-0 place-items-center rounded-full";
  switch (state) {
    case "done":
      return (
        <span className={cn(base, "bg-success text-white")}>
          <Check className="size-2.5" strokeWidth={3} aria-hidden="true" />
        </span>
      );
    case "running":
      return (
        <span className={cn(base, "border-2 border-primary bg-card")}>
          <span className="size-1.5 rounded-full bg-primary animate-pulse-ring" />
        </span>
      );
    case "attention":
      return <span className={cn(base, "bg-warning-dot text-[10px] font-bold text-white")}>!</span>;
    case "failed":
      return (
        <span className={cn(base, "bg-danger text-white")}>
          <X className="size-2.5" strokeWidth={3} aria-hidden="true" />
        </span>
      );
    case "skipped":
      return (
        <span className={cn(base, "bg-secondary text-muted-foreground")}>
          <Ban className="size-2.5" strokeWidth={2.5} aria-hidden="true" />
        </span>
      );
    default:
      return <span className={cn(base, "border border-border-strong bg-card")} />;
  }
}

const STATE_WORD: Record<Step["state"], string> = {
  done: "Done",
  running: "In progress",
  attention: "Needs you",
  failed: "Failed",
  skipped: "Skipped",
  pending: "Not started",
};

// The four steps of one run, top to bottom. Steps that haven't happened are shown as not started, never as done.
export function Timeline({ steps, className }: { steps: Step[]; className?: string }) {
  return (
    <ol className={cn("flex flex-col", className)} aria-label="Processing steps">
      {steps.map((s, i) => (
        <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
          {i < steps.length - 1 && (
            <span aria-hidden="true" className={cn("absolute top-4 bottom-0 left-[7.5px] w-px", s.state === "done" ? "bg-success/40" : "bg-border")} />
          )}
          <span className="pt-0.5">
            <Marker state={s.state} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className={cn("text-dense font-medium", s.state === "pending" && "text-muted-foreground")}>{s.title}</span>
              <span className="sr-only">: {STATE_WORD[s.state]}</span>
              <span className="ml-auto shrink-0 text-meta text-muted-foreground tnum">
                {s.at ? <Time value={s.at} format="precise" /> : s.state === "running" ? "Running…" : null}
              </span>
            </div>
            {s.detail && (
              <p
                className={cn(
                  "mt-0.5 text-meta break-words",
                  s.state === "failed" ? "text-danger" : s.state === "attention" ? "text-warning" : "text-muted-foreground",
                )}
              >
                {s.detail}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
