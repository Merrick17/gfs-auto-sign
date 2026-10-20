"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { approveSuggestedAction, listDocumentsAction, retryAction, skipAction } from "@/actions";
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Inbox, LoaderCircle, RotateCw, SearchIcon } from "@/components/icons";
import { useShellState } from "@/components/shell/shell-state";
import { StatusLabel } from "@/components/status";
import { Time } from "@/components/time";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FOLDER_LABEL, LIST_PAGE_SIZE, type Folder, type ListRow } from "@/lib/mailbox-folders";
import { cn } from "@/lib/utils";

type Data = { rows: ListRow[]; total: number; processing: boolean };

// Reads the list for the current folder, search and page. The previous rows stay on screen while the next ones
// load, so filtering and polling never blank the column.
function useDocuments(query: { folder: string; q: string; page: string; sort: string }) {
  const { version } = useShellState();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(query);

  useEffect(() => {
    let current = true;
    listDocumentsAction(JSON.parse(key)).then(
      (r) => {
        if (!current) return;
        setData(r);
        setError(false);
      },
      () => current && setError(true),
    );
    return () => {
      current = false;
    };
  }, [key, version, tick]);

  // Quick while something is processing, slow otherwise (new mail); paused while the tab is hidden.
  const processing = data?.processing ?? false;
  useEffect(() => {
    const again = () => document.visibilityState === "visible" && setTick((t) => t + 1);
    const id = window.setInterval(again, processing ? 3000 : 20000);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", again);
    };
  }, [processing]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload };
}

function RowActions({ row, onDone }: { row: ListRow; onDone: () => void }) {
  const [pending, start] = useTransition();
  if (!row.hasDraft && !row.canRetry) return null;
  return (
    <span className="relative z-10 hidden items-center gap-0.5 group-hover:flex group-focus-within:flex">
      {row.hasDraft && (
        <Tooltip>
          <TooltipTrigger asChild>
            <a href={`/api/documents/${row.id}/outlook`} target="_blank" rel="noreferrer" aria-label="Open draft in Outlook" className="grid size-7 place-items-center rounded-sm hover:bg-card hover:text-primary">
              <ExternalLink className="size-4" />
            </a>
          </TooltipTrigger>
          <TooltipContent>Open draft in Outlook</TooltipContent>
        </Tooltip>
      )}
      {row.canRetry && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Retry"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await retryAction(row.id);
                  if (r.ok) toast.success(r.message);
                  else toast.error(r.message);
                  onDone();
                })
              }
              className="grid size-7 place-items-center rounded-sm hover:bg-card hover:text-primary disabled:opacity-50"
            >
              <RotateCw className={cn("size-4", pending && "animate-spin")} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Retry</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

// One document, laid out like a Proton conversation row: who it is from and when, the email subject, then the
// file and its state. Documents that need the owner read like unread mail (white, bold); the rest sit on the
// lowered background. The open document is shown selected in the solid interaction colour.
function Row({ row, selected, href, checked, onToggle, onDone }: { row: ListRow; selected: boolean; href: string; checked: boolean; onToggle: () => void; onDone: () => void }) {
  const on = selected;
  return (
    <li className={cn("group relative border-b border-border", on ? "bg-primary text-primary-foreground" : row.needsYou ? "bg-card" : "bg-lowered")}>
      <Link
        href={href}
        data-row={row.id}
        aria-current={on ? "page" : undefined}
        className={cn(
          "absolute inset-0 outline-none transition-colors duration-150 focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:ring-inset",
          !on && "group-hover:bg-hover",
        )}
      >
        <span className="sr-only">
          {row.name}, from {row.sender}, {row.status.label}
        </span>
      </Link>
      <div className="pointer-events-none relative flex gap-3 px-4 py-3">
        {row.needsYou ? (
          <span className="pointer-events-auto relative z-10 mt-0.5 shrink-0">
            <Checkbox checked={checked} onCheckedChange={onToggle} aria-label={`Select ${row.name}`} className={cn(on && "border-primary-foreground/70 bg-transparent")} />
          </span>
        ) : (
          <span className="mt-[7px] w-1.5 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-[14px]", row.needsYou && "font-bold")} title={row.senderAddress ?? undefined}>
              {row.sender}
            </span>
            <span className="pointer-events-auto flex shrink-0 items-center">
              <RowActions row={row} onDone={onDone} />
              <Time
                value={row.at}
                className={cn("text-meta tnum", row.needsYou && "font-bold", !on && !row.needsYou && "text-muted-foreground", (row.hasDraft || row.canRetry) && "group-hover:hidden group-focus-within:hidden")}
              />
            </span>
          </div>
          <p className={cn("truncate text-[14px]", row.needsYou ? "font-bold" : on ? "" : "text-foreground")}>{row.subject ?? "No subject"}</p>
          <div className="mt-1.5 flex min-w-0 items-center gap-2">
            <span className={cn("flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-meta", on ? "border-white/30 bg-white/10" : "bg-card text-muted-foreground")}>
              <FileText className={cn("size-3.5 shrink-0", on ? "" : "text-danger-dot")} aria-hidden="true" />
              <span className="truncate" title={row.name}>
                {row.name}
              </span>
            </span>
            {row.inEmail > 1 && <span className={cn("shrink-0 text-meta tnum", on ? "text-white/80" : "text-subtle")}>+{row.inEmail - 1}</span>}
            <StatusLabel status={row.status} className={cn("ml-auto shrink-0 text-meta", on && "text-primary-foreground [&>span]:bg-primary-foreground")} />
          </div>
          {row.status.tone === "danger" && row.reason && <p className={cn("mt-1 truncate text-meta", on ? "text-white/90" : "text-danger")}>{row.reason}</p>}
        </div>
      </div>
    </li>
  );
}

function Skeletons() {
  return (
    <ul aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <li key={i} className="flex gap-3 border-b border-border/70 px-4 py-3">
          <span className="w-1.5" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        </li>
      ))}
    </ul>
  );
}

const WIDTH_KEY = "gfs-list-width";

// The document list column. Selecting a row opens it in the reading pane; the column keeps its place.
export function MailList() {
  const params = useSearchParams();
  const path = usePathname();
  const router = useRouter();
  const folder = (params.get("folder") ?? "all") as Folder;
  const q = params.get("q") ?? "";
  const page = Number(params.get("page") ?? "1") || 1;
  const sort = params.get("sort") === "oldest" ? "oldest" : "newest";
  const { data, error, reload } = useDocuments({ folder, q, page: String(page), sort });
  const selected = path.startsWith("/documents/") ? path.split("/")[2] : null;
  const listRef = useRef<HTMLUListElement>(null);

  // Bulk selection works on the page in view. It resets whenever the folder, search or page changes.
  const view = `${folder}|${q}|${page}|${sort}`;
  const [selection, setSelection] = useState<{ view: string; ids: Set<string> }>({ view, ids: new Set() });
  const picked = selection.view === view ? selection.ids : new Set<string>();
  const setPicked = (next: Set<string> | ((p: Set<string>) => Set<string>)) => setSelection({ view, ids: typeof next === "function" ? next(picked) : next });
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; what: string } | null>(null);
  const waiting = (data?.rows ?? []).filter((r) => r.needsYou);
  const chosen = waiting.filter((r) => picked.has(r.id));
  const approvable = chosen.filter((r) => r.canApprove);
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  const allPicked = waiting.length > 0 && chosen.length === waiting.length;

  // One document at a time from here, so a long batch can't run into a request time limit and shows progress.
  const runBulk = async (what: "approve" | "skip", targets: ListRow[]) => {
    setConfirming(false);
    let ok = 0;
    const problems: string[] = [];
    for (const [i, r] of targets.entries()) {
      setProgress({ done: i, total: targets.length, what: what === "approve" ? "Signing" : "Skipping" });
      try {
        const res = await (what === "approve" ? approveSuggestedAction(r.id) : skipAction(r.id));
        if (res.ok) ok++;
        else problems.push(`${r.name}: ${res.message}`);
      } catch {
        problems.push(`${r.name}: something went wrong`);
      }
    }
    setProgress(null);
    setPicked(new Set());
    const verb = what === "approve" ? "Signed" : "Skipped";
    if (problems.length === 0) toast.success(`${verb} ${ok} document${ok === 1 ? "" : "s"}.${what === "approve" ? " Drafts are saved in Outlook, nothing was sent." : ""}`);
    else toast.error(`${verb} ${ok} of ${targets.length}. ${problems.length} need${problems.length === 1 ? "s" : ""} a closer look.`, { description: problems.slice(0, 3).join(" · ") });
    reload();
  };

  // The width the owner dragged the column to last time, read once (the server renders the default).
  const [width, setWidth] = useState(() => {
    if (typeof window === "undefined") return 400;
    try {
      const w = Number(localStorage.getItem(WIDTH_KEY));
      return w >= 320 && w <= 640 ? w : 400;
    } catch {
      return 400;
    }
  });

  const qs = (over: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(over)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const s = next.toString();
    return s ? `?${s}` : "";
  };
  const keep = qs({});
  const setParam = (over: Record<string, string | null>) => router.replace(`${path}${qs(over)}`, { scroll: false });

  // Arrow keys or j / k move through the list and open the document, like a mail client.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !data?.rows.length) return;
    const dir = e.key === "ArrowDown" || e.key === "j" ? 1 : e.key === "ArrowUp" || e.key === "k" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const i = data.rows.findIndex((r) => r.id === selected);
    const next = data.rows[Math.min(data.rows.length - 1, Math.max(0, i === -1 ? 0 : i + dir))];
    router.push(`/documents/${next.id}${keep}`, { scroll: false });
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-row="${next.id}"]`)?.focus());
  };

  const startResize = (e: React.PointerEvent) => {
    const startX = e.clientX;
    const startW = width;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setWidth(Math.min(640, Math.max(320, startW + ev.clientX - startX)));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      setWidth((w) => {
        try {
          localStorage.setItem(WIDTH_KEY, String(w));
        } catch {
          // not persisted
        }
        return w;
      });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const total = data?.total ?? 0;
  const from = total ? (page - 1) * LIST_PAGE_SIZE + 1 : 0;
  const to = Math.min(total, page * LIST_PAGE_SIZE);
  const last = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));

  return (
    <section aria-label={FOLDER_LABEL[folder]} className="relative flex min-h-0 w-full shrink-0 flex-col border-r lg:w-[var(--list-w)]" style={{ "--list-w": `${width}px` } as React.CSSProperties} onKeyDown={onKeyDown} suppressHydrationWarning>
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b px-4">
        {waiting.length > 0 && (
          <Checkbox
            checked={allPicked}
            onCheckedChange={() => setPicked(allPicked ? new Set() : new Set(waiting.map((r) => r.id)))}
            aria-label="Select all waiting documents on this page"
            disabled={!!progress}
          />
        )}
        <h1 className="min-w-0 truncate text-section">{q ? `Results for “${q}”` : FOLDER_LABEL[folder]}</h1>
        <span className="text-meta text-muted-foreground tnum">{data ? total : ""}</span>
        <Select value={sort} onValueChange={(v) => setParam({ sort: v === "newest" ? null : v, page: null })}>
          <SelectTrigger size="sm" className="ml-auto h-7 w-auto gap-1 border-transparent px-2 text-meta shadow-none hover:bg-hover" aria-label="Sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
        {!data && !error ? (
          <Skeletons />
        ) : error && !data ? (
          <div role="alert" className="px-6 py-12 text-center">
            <p className="text-[14px] font-medium">The list couldn&apos;t be loaded</p>
            <button type="button" onClick={reload} className="mt-2 text-dense font-medium text-primary hover:underline">
              Try again
            </button>
          </div>
        ) : data && data.rows.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            {q ? <SearchIcon className="size-5 text-subtle" aria-hidden="true" /> : <Inbox className="size-5 text-subtle" aria-hidden="true" />}
            <p className="mt-3 text-[14px] font-medium">{q ? "No documents match" : folder === "all" ? "No documents yet" : `Nothing in ${FOLDER_LABEL[folder]}`}</p>
            <p className="mt-1 max-w-xs text-dense text-muted-foreground">
              {q ? "Try a file name, a sender or words from the subject." : folder === "all" ? "Emails with a PDF attachment show up here. Use Check mail to look for them now." : "Documents move here when they reach this state."}
            </p>
          </div>
        ) : (
          <ul ref={listRef}>
            {data!.rows.map((r) => (
              <Row key={r.id} row={r} selected={r.id === selected} href={`/documents/${r.id}${keep}`} checked={picked.has(r.id)} onToggle={() => toggle(r.id)} onDone={reload} />
            ))}
          </ul>
        )}
      </div>

      {(chosen.length > 0 || progress) && (
        <div role="region" aria-label="Bulk actions" className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-card px-4 py-2.5">
          {progress ? (
            <p role="status" className="flex items-center gap-2 text-dense">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              {progress.what} {Math.min(progress.done + 1, progress.total)} of {progress.total}…
            </p>
          ) : (
            <>
              <span className="text-dense font-medium tnum">{chosen.length} selected</span>
              <Button size="sm" className="ml-auto" disabled={approvable.length === 0} onClick={() => setConfirming(true)}>
                Approve &amp; sign{approvable.length ? ` (${approvable.length})` : ""}
              </Button>
              <Button size="sm" variant="outline" onClick={() => runBulk("skip", chosen)}>
                Skip
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
                Clear
              </Button>
              {approvable.length < chosen.length && (
                <p className="basis-full text-meta text-muted-foreground">
                  {chosen.length - approvable.length} of the selected need{chosen.length - approvable.length === 1 ? "s" : ""} a closer look (position or setup) and can only be approved one by one.
                </p>
              )}
            </>
          )}
        </div>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-section">
              Sign {approvable.length} document{approvable.length === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription className="text-dense">
              Your signature image goes on each document at the position suggested in its review, then a draft is saved in Outlook. Nothing is sent. Documents that turn out to need a closer look are left for you.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={() => runBulk("approve", approvable)}>Approve &amp; sign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {total > LIST_PAGE_SIZE && (
        <div className="flex h-10 shrink-0 items-center justify-end gap-1 border-t px-3 text-meta text-muted-foreground tnum">
          <span className="mr-1">
            {from}–{to} of {total}
          </span>
          <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setParam({ page: page - 1 > 1 ? String(page - 1) : null })} className="grid size-7 place-items-center rounded-sm hover:bg-hover disabled:opacity-40">
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" aria-label="Next page" disabled={page >= last} onClick={() => setParam({ page: String(page + 1) })} className="grid size-7 place-items-center rounded-sm hover:bg-hover disabled:opacity-40">
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the list"
        onPointerDown={startResize}
        className="absolute top-0 -right-1 z-20 hidden h-full w-2 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-primary/50 lg:block"
      />
    </section>
  );
}
