"use client";

import { motion, useReducedMotion } from "motion/react";
import { Ban, Check, FileText, Inbox, MailCheck, PenLine, TriangleAlert, X } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { Step, StepKey } from "@/lib/view-model";
import { Time } from "./time";

const ICON: Record<StepKey, typeof Inbox> = { received: Inbox, ingested: FileText, signed: PenLine, draft: MailCheck };

const STATE_WORD: Record<Step["state"], string> = {
  done: "Done",
  running: "In progress",
  attention: "Needs you",
  failed: "Failed",
  skipped: "Skipped",
  pending: "Not started",
};

const MARKER: Record<Step["state"], string> = {
  done: "border-success bg-success text-white",
  running: "border-primary bg-primary-soft text-primary animate-pulse-ring",
  attention: "border-warning-dot bg-warning-soft text-warning",
  failed: "border-danger bg-danger-soft text-danger",
  skipped: "border-border-strong bg-secondary text-muted-foreground",
  pending: "border-dashed border-border-strong bg-card text-subtle",
};

const BADGE: Record<Step["state"], string> = {
  done: "text-success",
  running: "text-primary",
  attention: "text-warning",
  failed: "text-danger",
  skipped: "text-muted-foreground",
  pending: "text-subtle",
};

function Marker({ step, size = "md" }: { step: Step; size?: "md" | "sm" }) {
  const Icon = step.state === "done" ? Check : step.state === "failed" ? X : step.state === "attention" ? TriangleAlert : step.state === "skipped" ? Ban : ICON[step.key];
  return (
    <span className={cn("relative z-10 grid shrink-0 place-items-center rounded-full border-[1.5px] transition-colors duration-200", size === "md" ? "size-8" : "size-7", MARKER[step.state])}>
      <Icon className={size === "md" ? "size-4" : "size-3.5"} strokeWidth={step.state === "done" ? 2.5 : 2} aria-hidden="true" />
    </span>
  );
}

function When({ step }: { step: Step }) {
  if (step.at) return <Time value={step.at} format="precise" className="tnum" />;
  return <span>{STATE_WORD[step.state]}</span>;
}

// The run's four steps. Horizontal from small screens up, vertical on phones. A step is only ever shown as
// done when it actually happened; the line between two steps fills once the first of them is done.
export function Stepper({ steps, className }: { steps: Step[]; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className={className}>
      <ol aria-label="Processing steps" className="hidden grid-cols-4 sm:grid">
        {steps.map((s, i) => (
          <li key={s.key} className="min-w-0 pr-3">
            <div className="flex items-center">
              <Marker step={s} />
              {i < steps.length - 1 && (
                <span aria-hidden="true" className="relative mx-2 h-0.5 flex-1 overflow-hidden rounded-full bg-border">
                  {s.state === "done" && (
                    <motion.span
                      className="absolute inset-0 origin-left rounded-full bg-success"
                      initial={reduce ? false : { scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.35, delay: reduce ? 0 : 0.08 * i, ease: [0.2, 0, 0, 1] }}
                    />
                  )}
                </span>
              )}
            </div>
            <div className="mt-2 min-w-0">
              <p className="text-meta text-muted-foreground">
                Step {i + 1} · <span className={cn("font-medium", BADGE[s.state])}>{STATE_WORD[s.state]}</span>
              </p>
              <p className={cn("truncate text-dense font-medium", s.state === "pending" ? "text-muted-foreground" : "text-foreground")}>{s.title}</p>
              <p className="text-meta text-muted-foreground">{s.at ? <When step={s} /> : null}</p>
              {s.detail && (
                <p className={cn("mt-0.5 line-clamp-2 text-meta", s.state === "failed" ? "text-danger" : s.state === "attention" ? "text-warning" : "text-muted-foreground")} title={s.detail}>
                  {s.detail}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>

      <ol aria-label="Processing steps" className="flex flex-col sm:hidden">
        {steps.map((s, i) => (
          <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
            {i < steps.length - 1 && (
              <span aria-hidden="true" className={cn("absolute top-7 bottom-0 left-[13px] w-0.5 rounded-full", s.state === "done" ? "bg-success" : "bg-border")} />
            )}
            <Marker step={s} size="sm" />
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-baseline gap-2">
                <span className={cn("text-dense font-medium", s.state === "pending" && "text-muted-foreground")}>{s.title}</span>
                <span className={cn("ml-auto shrink-0 text-meta", s.at ? "text-muted-foreground" : BADGE[s.state])}>
                  <When step={s} />
                </span>
              </div>
              {s.detail && <p className={cn("mt-0.5 text-meta", s.state === "failed" ? "text-danger" : s.state === "attention" ? "text-warning" : "text-muted-foreground")}>{s.detail}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
