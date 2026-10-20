"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { approveAction, retryAction, saveDraftAction, skipAction, type Result } from "@/actions";
import { ArrowLeft, Ban, Download, ExternalLink, LoaderCircle, MoreHorizontal, PenLine, RotateCw, TriangleAlert } from "@/components/icons";
import { StatusLabel } from "@/components/status";
import { Time } from "@/components/time";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { announceDocumentsChanged } from "@/components/shell/shell-state";
import { Stepper } from "@/components/stepper";
import type { Placement } from "@/lib/placement";
import { ACTION_LABEL, formatDuration, type PrimaryAction, type StatusView, type Step } from "@/lib/view-model";
import type { Kind } from "./pdf-viewer";

const PdfViewer = dynamic(() => import("./pdf-viewer"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 justify-center bg-secondary/70 p-6" role="status" aria-label="Loading document">
      <Skeleton className="h-[720px] w-full max-w-[820px] bg-card" />
    </div>
  ),
});

export type WorkspaceDoc = {
  id: string;
  name: string;
  sender: string;
  senderAddress: string | null;
  subject: string | null;
  receivedAt: string;
  status: string;
  attention: string | null;
  view: StatusView;
  exception: string | null;
  hasSigned: boolean;
  pageCount: number | null;
  suggestedPlacement: Placement;
  action: PrimaryAction;
  remembered: boolean;
  hasSignatureImage: boolean;
  steps: Step[];
  duration: number | null;
};

export function Workspace({ doc, aside }: { doc: WorkspaceDoc; aside: React.ReactNode }) {
  const router = useRouter();
  const startsPlacing = doc.action === "place" || doc.action === "approve";
  const [placing, setPlacing] = useState(startsPlacing && doc.status !== "SKIPPED");
  const [placement, setPlacement] = useState<Placement>(doc.suggestedPlacement);
  const [remember, setRemember] = useState(false);
  const [kind, setKind] = useState<Kind>(doc.hasSigned ? "signed" : "original");
  const [pages, setPages] = useState(doc.pageCount);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const act = (label: string, fn: () => Promise<Result>, after?: () => void) => {
    setBusy(label);
    start(async () => {
      const r = await fn();
      setBusy(null);
      if (r.ok) {
        toast.success(r.message);
        after?.();
      } else toast.error(r.message);
      announceDocumentsChanged();
      router.refresh();
    });
  };

  const sign = () =>
    act("sign", () => approveAction(doc.id, placement, remember), () => {
      setPlacing(false);
      setKind("signed");
    });

  const canPlaceManually = !doc.hasSigned && ["SKIPPED", "FAILED"].includes(doc.status);
  const canSkip = !doc.hasSigned && ["NEEDS_ATTENTION", "FAILED"].includes(doc.status);
  const Spinner = <LoaderCircle className="animate-spin" aria-hidden="true" />;

  let primary: React.ReactNode = null;
  if (placing)
    primary = (
      <Button onClick={sign} disabled={pending}>
        {busy === "sign" ? Spinner : <PenLine aria-hidden="true" />}
        Sign & save draft
      </Button>
    );
  else if (doc.action === "place" || doc.action === "approve")
    primary = (
      <Button onClick={() => setPlacing(true)}>
        <PenLine aria-hidden="true" />
        {ACTION_LABEL[doc.action]}
      </Button>
    );
  else if (doc.action === "settings")
    primary = (
      <Button asChild>
        <Link href="/settings#signature">{ACTION_LABEL.settings}</Link>
      </Button>
    );
  else if (doc.action === "save-draft")
    primary = (
      <Button onClick={() => act("draft", () => saveDraftAction(doc.id))} disabled={pending}>
        {busy === "draft" && Spinner}
        {ACTION_LABEL["save-draft"]}
      </Button>
    );
  else if (doc.action === "open-outlook")
    primary = (
      <Button asChild>
        <a href={`/api/documents/${doc.id}/outlook`} target="_blank" rel="noreferrer">
          <ExternalLink aria-hidden="true" />
          {ACTION_LABEL["open-outlook"]}
        </a>
      </Button>
    );
  else if (doc.action === "retry")
    primary = (
      <Button onClick={() => act("retry", () => retryAction(doc.id))} disabled={pending}>
        {busy === "retry" ? Spinner : <RotateCw aria-hidden="true" />}
        {ACTION_LABEL.retry}
      </Button>
    );

  const kinds: Kind[] = doc.hasSigned ? ["signed", "original"] : ["original"];

  return (
    <div data-fill className="flex flex-col overflow-y-auto lg:min-h-0 lg:flex-1 lg:overflow-hidden">
      <header className="shrink-0 border-b px-5 pt-3 pb-4">
        <Link href="/" className="mb-1.5 inline-flex items-center gap-1 text-meta text-muted-foreground transition-colors hover:text-foreground lg:hidden">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Inbox
        </Link>
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="min-w-0 flex-[1_1_320px]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="min-w-0 text-page break-all">{doc.name}</h1>
              <StatusLabel status={doc.view} />
            </div>
            <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-0.5 text-dense text-muted-foreground">
              <div className="flex min-w-0 gap-1.5">
                <dt>From</dt>
                <dd className="min-w-0 truncate text-foreground" title={doc.senderAddress ?? undefined}>
                  {doc.sender}
                  {doc.senderAddress && doc.senderAddress !== doc.sender && <span className="text-muted-foreground"> &lt;{doc.senderAddress}&gt;</span>}
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt>Received</dt>
                <dd className="text-foreground tnum">
                  <Time value={doc.receivedAt} format="long" />
                </dd>
              </div>
              {doc.subject && (
                <div className="flex min-w-0 gap-1.5">
                  <dt>Subject</dt>
                  <dd className="min-w-0 truncate text-foreground">{doc.subject}</dd>
                </div>
              )}
            </dl>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <a href={`/api/documents/${doc.id}/file?kind=original`} target="_blank" rel="noreferrer">
                Open original
              </a>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {doc.hasSigned && (
                  <DropdownMenuItem asChild>
                    <a href={`/api/documents/${doc.id}/file?kind=signed&download=1`}>
                      <Download aria-hidden="true" />
                      Download signed copy
                    </a>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <a href={`/api/documents/${doc.id}/file?kind=original&download=1`}>
                    <Download aria-hidden="true" />
                    Download original
                  </a>
                </DropdownMenuItem>
                {canPlaceManually && !placing && (
                  <DropdownMenuItem onSelect={() => setPlacing(true)}>
                    <PenLine aria-hidden="true" />
                    Place signature myself
                  </DropdownMenuItem>
                )}
                {canSkip && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => act("skip", () => skipAction(doc.id))}>
                      <Ban aria-hidden="true" />
                      Skip this document
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {primary}
          </div>
        </div>
        <div className="mt-4 border-t pt-4">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-meta font-medium tracking-wide text-muted-foreground uppercase">Run</h2>
            {doc.duration !== null && <span className="text-meta text-muted-foreground tnum">· finished in {formatDuration(doc.duration)}</span>}
          </div>
          <Stepper steps={doc.steps} />
        </div>
      </header>

      <div className="flex flex-col lg:min-h-0 lg:flex-1 lg:flex-row">
        <aside className="order-2 shrink-0 border-t lg:order-none lg:w-[320px] lg:overflow-y-auto lg:border-t-0 lg:border-r">{aside}</aside>
        <div className="flex h-[78dvh] min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:h-auto">
          {placing && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-primary-soft px-4 py-2 text-dense">
              {doc.attention === "REVIEW" ? (
                <span className="flex items-center gap-1.5 text-warning">
                  <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
                  {doc.exception ?? "Check this document before signing."}
                </span>
              ) : (
                <span className="text-foreground">
                  <span className="font-medium">Page {placement.page}.</span> Drag the signature into place, drag its corner to resize, then sign.
                </span>
              )}
              {doc.senderAddress && pages && (
                <label className="flex cursor-pointer items-center gap-2 text-muted-foreground">
                  <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
                  Use this position for {pages}-page documents from {doc.senderAddress}
                </label>
              )}
              {!startsPlacing && (
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setPlacing(false)}>
                  Cancel
                </Button>
              )}
            </div>
          )}
          <PdfViewer
            id={doc.id}
            kinds={placing ? ["original"] : kinds}
            kind={placing ? "original" : kind}
            onKindChange={setKind}
            placing={placing}
            placement={placement}
            onPlacementChange={setPlacement}
            onPageCount={setPages}
            hasSignatureImage={doc.hasSignatureImage}
          />
        </div>
      </div>
    </div>
  );
}
