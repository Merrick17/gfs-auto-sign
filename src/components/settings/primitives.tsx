import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type Tint = "outlook" | "signature" | "rules" | "people" | "ai";

const TINT: Record<Tint, string> = {
  outlook: "bg-tint-outlook-soft text-tint-outlook",
  signature: "bg-tint-signature-soft text-tint-signature",
  rules: "bg-tint-rules-soft text-tint-rules",
  people: "bg-tint-people-soft text-tint-people",
  ai: "bg-tint-ai-soft text-tint-ai",
};

// Soft tinted tile that gives each settings area its own recognisable icon.
export function IconTile({ icon: Icon, tint, className }: { icon: LucideIcon; tint: Tint; className?: string }) {
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg", TINT[tint], className)}>
      <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}

export function SectionHeader({ icon, tint, title, description, action }: { icon: LucideIcon; tint: Tint; title: string; description: string; action?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start gap-4">
      <IconTile icon={icon} tint={tint} />
      <div className="min-w-0 flex-1">
        <h2 className="text-xl font-semibold text-balance">{title}</h2>
        <p className="mt-0.5 max-w-prose text-pretty text-muted-foreground">{description}</p>
      </div>
      {action}
    </header>
  );
}

export function Panel({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("rounded-xl border bg-card p-5 shadow-xs", className)} {...props} />;
}

export type Health = "connected" | "connecting" | "attention" | "disconnected";

const HEALTH: Record<Health, { label: string; dot: string; text: string }> = {
  connected: { label: "Connected", dot: "bg-success", text: "text-success" },
  connecting: { label: "Connecting", dot: "bg-info animate-pulse motion-reduce:animate-none", text: "text-info" },
  attention: { label: "Needs attention", dot: "bg-warning", text: "text-warning" },
  disconnected: { label: "Disconnected", dot: "bg-muted-foreground/50", text: "text-muted-foreground" },
};

// Status is always a word plus a dot, never colour alone.
export function HealthPill({ state, label }: { state: Health; label?: string }) {
  const h = HEALTH[state];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium", h.text)}>
      <span className={cn("size-2 rounded-full", h.dot)} aria-hidden="true" />
      {label ?? h.label}
    </span>
  );
}
