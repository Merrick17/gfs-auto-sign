"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { checkMailAction } from "@/actions";
import { Activity, Ban, CircleAlert, Cloud, Inbox, LoaderCircle, MailCheck, RefreshCw, Settings, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { Folder } from "@/lib/mailbox-folders";
import { cn } from "@/lib/utils";
import { Brand, type BrandAssets } from "./brand";
import { useShellState } from "./shell-state";

export type ShellStatus = { state: "connected" | "connecting" | "attention" | "disconnected"; label: string };

const FOLDER_NAV: { folder: Folder; label: string; icon: typeof Inbox }[] = [
  { folder: "all", label: "Inbox", icon: Inbox },
  { folder: "attention", label: "Needs attention", icon: CircleAlert },
  { folder: "processing", label: "Processing", icon: RefreshCw },
  { folder: "draft", label: "Draft saved", icon: MailCheck },
  { folder: "failed", label: "Failed", icon: X },
  { folder: "skipped", label: "Skipped", icon: Ban },
];

const DOT: Record<ShellStatus["state"], string> = {
  connected: "bg-success",
  connecting: "bg-primary",
  attention: "bg-warning-dot",
  disconnected: "bg-subtle",
};

export type SidebarProps = { counts: Record<Folder, number>; status: ShellStatus; assets: BrandAssets };

function useActive() {
  const path = usePathname();
  const params = useSearchParams();
  const inMail = path === "/" || path.startsWith("/documents");
  const folder = (params.get("folder") ?? "all") as Folder;
  return (key: string) => (key === "activity" ? path.startsWith("/activity") : key === "settings" ? path.startsWith("/settings") : inMail && folder === key);
}

function NavItem({ href, label, icon: Icon, active, count, strong, onNavigate, layoutGroup }: { href: string; label: string; icon: typeof Inbox; active: boolean; count?: number; strong?: boolean; onNavigate?: () => void; layoutGroup: string }) {
  const reduce = useReducedMotion();
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-9 items-center gap-3 rounded-md px-3 text-[14px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/40",
        active ? "font-bold text-foreground" : "text-foreground hover:bg-hover",
      )}
    >
      {active && (
        <motion.span
          layoutId={`nav-${layoutGroup}`}
          aria-hidden="true"
          className="absolute inset-0 rounded-md bg-[var(--interaction-default-hover)]"
          transition={reduce ? { duration: 0 } : { duration: 0.18, ease: [0.2, 0, 0, 1] }}
        />
      )}
      <Icon className={cn("relative size-4 shrink-0", active ? "text-foreground" : "text-muted-foreground")} aria-hidden="true" />
      <span className="relative flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className={cn("relative tnum", strong ? "min-w-5 rounded-sm bg-primary px-1 py-px text-center text-[11px] leading-4 text-primary-foreground" : "text-meta text-muted-foreground")}>
          {count}
          <span className="sr-only"> documents</span>
        </span>
      )}
    </Link>
  );
}

function CheckMailButton() {
  const { checking, setChecking, changed } = useShellState();
  const router = useRouter();
  const run = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const r = await checkMailAction();
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    } finally {
      setChecking(false);
      changed();
      router.refresh();
    }
  };
  return (
    <Button onClick={run} disabled={checking} size="lg" className="w-full justify-center">
      {checking ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <MailCheck aria-hidden="true" />}
      {checking ? "Checking mail…" : "Check mail"}
    </Button>
  );
}

// Proton-style navigation: the logo, one primary action, the folders with their counts, then the other screens.
export function SidebarContent({ counts, status, assets, onNavigate, layoutGroup = "desktop" }: SidebarProps & { onNavigate?: () => void; layoutGroup?: string }) {
  const isActive = useActive();
  const { checking } = useShellState();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[60px] shrink-0 items-center px-4">
        <Link href="/" onClick={onNavigate} aria-label="GFS Contract Agent, Inbox" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
          <Brand assets={assets} busy={checking} />
        </Link>
      </div>
      <div className="px-3 pb-4">
        <CheckMailButton />
      </div>
      <nav aria-label="Folders" className="flex flex-col gap-px px-2">
        {FOLDER_NAV.map((f) => (
          <NavItem
            key={f.folder}
            href={f.folder === "all" ? "/" : `/?folder=${f.folder}`}
            label={f.label}
            icon={f.icon}
            active={isActive(f.folder)}
            count={counts[f.folder]}
            strong={f.folder === "attention"}
            onNavigate={onNavigate}
            layoutGroup={layoutGroup}
          />
        ))}
      </nav>
      <div className="mx-5 my-3 h-px bg-border" />
      <nav aria-label="More" className="flex flex-col gap-px px-2">
        <NavItem href="/activity" label="Activity" icon={Activity} active={isActive("activity")} onNavigate={onNavigate} layoutGroup={layoutGroup} />
        <NavItem href="/settings" label="Settings" icon={Settings} active={isActive("settings")} onNavigate={onNavigate} layoutGroup={layoutGroup} />
      </nav>
      <div className="mt-auto px-2 pb-3">
        <Link href="/settings#microsoft" onClick={onNavigate} className="flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-hover">
          <Cloud className="size-4 text-subtle" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-meta text-muted-foreground">Microsoft 365</span>
            <span className="flex items-center gap-1.5 text-dense font-medium text-foreground">
              <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT[status.state])} />
              {status.label}
            </span>
          </span>
        </Link>
      </div>
    </div>
  );
}

export function Sidebar(props: SidebarProps) {
  return (
    <aside className="hidden h-full w-[250px] shrink-0 bg-secondary/45 lg:block">
      <SidebarContent {...props} />
    </aside>
  );
}
