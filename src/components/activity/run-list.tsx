"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { retryAction, saveDraftAction } from "@/actions";
import { ChevronRight, ExternalLink, LoaderCircle, RotateCw } from "@/components/icons";
import { StatusLabel } from "@/components/status";
import { Stepper } from "@/components/stepper";
import { Time } from "@/components/time";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/view-model";
import type { ActivityRow } from "@/lib/views";

const GRID = "grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-3 md:grid-cols-[16px_150px_minmax(0,1.6fr)_minmax(0,1fr)_72px_80px]";

function RunActions({ run }: { run: ActivityRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const call = (fn: () => ReturnType<typeof retryAction>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      router.refresh();
    });
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" asChild>
        <Link href={`/documents/${run.id}`}>Open document</Link>
      </Button>
      {run.action === "open-outlook" && (
        <Button size="sm" asChild>
          <a href={`/api/documents/${run.id}/outlook`} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden="true" />
            Open in Outlook
          </a>
        </Button>
      )}
      {run.action === "retry" && (
        <Button size="sm" onClick={() => call(() => retryAction(run.id))} disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <RotateCw aria-hidden="true" />}
          Retry
        </Button>
      )}
      {run.action === "save-draft" && (
        <Button size="sm" onClick={() => call(() => saveDraftAction(run.id))} disabled={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          Save Outlook draft
        </Button>
      )}
      {(run.action === "place" || run.action === "approve" || run.action === "settings") && (
        <Button size="sm" asChild>
          <Link href={`/documents/${run.id}`}>{run.action === "settings" ? "Add signature image" : run.action === "place" ? "Add signature" : "Review & approve"}</Link>
        </Button>
      )}
    </div>
  );
}

export function RunList({ runs }: { runs: ActivityRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul>
      {runs.map((r) => {
        const expanded = open === r.id;
        return (
          <li key={r.id} className="border-b last:border-b-0">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={`run-${r.id}`}
              onClick={() => setOpen(expanded ? null : r.id)}
              className={cn(`${GRID} min-h-12 w-full px-4 py-2 text-left transition-colors hover:bg-hover`, expanded && "bg-selected hover:bg-selected")}
            >
              <ChevronRight className={cn("size-4 text-subtle transition-transform duration-150", expanded && "rotate-90")} aria-hidden="true" />
              <span className="hidden md:block">
                <StatusLabel status={r.status} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium" title={r.name}>{r.name}</span>
                <span className="block truncate text-meta text-muted-foreground md:hidden">
                  <StatusLabel status={r.status} className="text-meta" /> · {r.sender}
                </span>
              </span>
              <span className="hidden truncate text-dense text-muted-foreground md:block">{r.sender}</span>
              <span className="hidden text-right text-dense text-muted-foreground tnum md:block">{formatDuration(r.duration)}</span>
              <span className="text-right text-dense text-muted-foreground tnum">
                <Time value={r.at} />
              </span>
            </button>
            {expanded && (
              <div id={`run-${r.id}`} className="animate-appear border-t bg-secondary/40 px-4 py-4 md:pl-11">
                <div className="flex flex-col gap-4">
                  <Stepper steps={r.steps} />
                  <div className="flex flex-wrap items-center gap-3 border-t pt-3">
                    {r.status.tone === "danger" && r.exception && <p className="text-dense text-danger">{r.exception}</p>}
                    <RunActions run={r} />
                  </div>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
