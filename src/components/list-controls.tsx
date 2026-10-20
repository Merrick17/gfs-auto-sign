"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, Search, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

function useParamUpdater() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in changes)) next.delete("page");
    const qs = next.toString();
    start(() => router.replace(qs ? `${path}?${qs}` : path, { scroll: false }));
  };
  return { params, set, pending };
}

export function Tabs({ items, current }: { items: { value: string; label: string; count?: number }[]; current: string }) {
  const path = usePathname();
  const params = useSearchParams();
  const reduce = useReducedMotion();
  const href = (v: string) => {
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    if (v === "all") next.delete("status");
    else next.set("status", v);
    const qs = next.toString();
    return qs ? `${path}?${qs}` : path;
  };
  return (
    <nav aria-label="Filter" className="-mx-1.5 flex gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
      {items.map((t) => {
        const active = t.value === current;
        return (
          <Link
            key={t.value}
            href={href(t.value)}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-10 shrink-0 items-center gap-1.5 px-2.5 text-dense text-muted-foreground transition-colors duration-150 hover:text-foreground",
              active && "font-medium text-foreground",
            )}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className={cn("rounded-sm px-1 text-meta tnum transition-colors", active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")}>{t.count}</span>
            )}
            {active && (
              <motion.span
                layoutId="tab-underline"
                aria-hidden="true"
                className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-full bg-primary"
                transition={reduce ? { duration: 0 } : { duration: 0.2, ease: [0.2, 0, 0, 1] }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function SearchAndSort({ placeholder, sortLabels }: { placeholder: string; sortLabels: { newest: string; oldest: string } }) {
  const { params, set, pending } = useParamUpdater();
  const [q, setQ] = useState(params.get("q") ?? "");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = window.setTimeout(() => set({ q: q.trim() || null }), 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 sm:max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" aria-hidden="true" />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
        />
        {pending ? (
          <LoaderCircle className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-subtle" aria-hidden="true" />
        ) : (
          q && (
            <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded-sm text-subtle hover:bg-hover hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )
        )}
      </div>
      <Select value={params.get("sort") === "oldest" ? "oldest" : "newest"} onValueChange={(v) => set({ sort: v === "newest" ? null : v })}>
        <SelectTrigger className="ml-auto w-36" aria-label="Sort">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value="newest">{sortLabels.newest}</SelectItem>
          <SelectItem value="oldest">{sortLabels.oldest}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export function Pagination({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const { set } = useParamUpdater();
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const last = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-end gap-2 px-4 py-1.5 text-meta text-muted-foreground tnum">
      <span>
        {from}–{to} of {total}
      </span>
      <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>
        <ChevronLeft />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= last} onClick={() => set({ page: String(page + 1) })}>
        <ChevronRight />
      </Button>
    </div>
  );
}

export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" size="sm" onClick={() => start(() => router.refresh())} disabled={pending}>
      <RefreshCw className={cn(pending && "animate-spin")} aria-hidden="true" />
      Refresh
    </Button>
  );
}
