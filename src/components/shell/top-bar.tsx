"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { LogOut, Menu, RefreshCw, Search, Settings, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SidebarContent, type SidebarProps } from "./sidebar";
import { useShellState } from "./shell-state";

// Search always looks through documents. On the mail screens it filters the list in place (an open document stays
// open); elsewhere it takes you to the Inbox with the search applied.
function SearchBox() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const inMail = path === "/" || path.startsWith("/documents");
  const [q, setQ] = useState(inMail ? (params.get("q") ?? "") : "");
  const input = useRef<HTMLInputElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!inMail) return;
    const t = window.setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (q.trim()) next.set("q", q.trim());
      else next.delete("q");
      next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${path}?${qs}` : path, { scroll: false });
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // "/" focuses search, like most mail apps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      role="search"
      className="relative w-full lg:max-w-[440px]"
      onSubmit={(e) => {
        e.preventDefault();
        if (!inMail) router.push(q.trim() ? `/?q=${encodeURIComponent(q.trim())}` : "/");
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
      <input
        ref={input}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search documents"
        aria-label="Search documents"
        className="h-9 w-full rounded-md border border-transparent bg-secondary pr-8 pl-9 sm:pr-16 text-[14px] outline-none transition-[box-shadow,border-color,background-color] placeholder:text-subtle hover:bg-[var(--interaction-weak)] focus-visible:border-ring focus-visible:bg-card focus-visible:shadow-[0_0_0_3px_var(--focus-ring)] [&::-webkit-search-cancel-button]:hidden"
      />
      {q ? (
        <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-subtle hover:bg-hover hover:text-foreground">
          <X className="size-3.5" />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded-sm border px-1.5 text-meta text-muted-foreground sm:block">/</kbd>
      )}
    </form>
  );
}

function IconLink({ label, children, ...rest }: { label: string; children: React.ReactNode } & React.ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} className="size-9 text-muted-foreground hover:text-foreground" {...rest}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function TopBar({ sidebar, user, signOut }: { sidebar: SidebarProps; user: { name?: string | null; email?: string | null }; signOut: () => Promise<void> }) {
  const router = useRouter();
  const { changed } = useShellState();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const initial = (user.name ?? user.email ?? "?").slice(0, 1);

  return (
    <header className="flex h-[60px] shrink-0 items-center gap-2 bg-secondary/70 px-3 lg:pr-4 lg:pl-0">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Open navigation" className="size-9 lg:hidden">
            <Menu />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[260px] gap-0 bg-background p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent {...sidebar} layoutGroup="mobile" onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <SearchBox />
      <div className="ml-auto flex items-center gap-0.5">
        <IconLink
          label="Refresh"
          disabled={pending}
          onClick={() =>
            start(() => {
              changed();
              router.refresh();
            })
          }
        >
          <RefreshCw className={cn(pending && "animate-spin")} />
        </IconLink>
        <IconLink label="Settings" asChild>
          <Link href="/settings">
            <Settings />
          </Link>
        </IconLink>
        <DropdownMenu>
          <DropdownMenuTrigger className="ml-1 flex items-center gap-2 rounded-md py-1 pr-2 pl-1 outline-none transition-colors hover:bg-hover focus-visible:ring-[3px] focus-visible:ring-ring/20">
            <span aria-hidden="true" className="grid size-8 place-items-center rounded-md bg-strong text-dense font-semibold text-foreground uppercase">
              {initial}
            </span>
            <span className="hidden min-w-0 text-left xl:block">
              <span className="block max-w-[180px] truncate text-dense font-medium">{user.name ?? "Account"}</span>
              <span className="block max-w-[180px] truncate text-meta text-muted-foreground">{user.email}</span>
            </span>
            <span className="sr-only">Account</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="font-normal">
              <span className="block truncate text-dense font-medium">{user.name ?? "Account"}</span>
              <span className="block truncate text-meta text-muted-foreground">{user.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <Settings aria-hidden="true" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void signOut()}>
              <LogOut aria-hidden="true" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
