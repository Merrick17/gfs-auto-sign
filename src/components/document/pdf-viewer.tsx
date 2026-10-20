"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileX2, Minus, MoveHorizontal, Plus, RotateCw } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Placement } from "@/lib/placement";
import { cn } from "@/lib/utils";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export type Kind = "original" | "signed";
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function Tip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

type Load = { src: string; url: string } | { src: string; error: true };

export type PdfViewerProps = {
  id: string;
  kinds: Kind[];
  kind: Kind;
  onKindChange: (k: Kind) => void;
  placing: boolean;
  placement: Placement;
  onPlacementChange: (p: Placement) => void;
  onPageCount?: (n: number) => void;
  hasSignatureImage: boolean;
};

export default function PdfViewer({ id, kinds, kind, onKindChange, placing, placement, onPlacementChange, onPageCount, hasSignatureImage }: PdfViewerProps) {
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(placing ? placement.page : 1);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [natural, setNatural] = useState({ width: 612, height: 792 });
  const [rendered, setRendered] = useState<string | null>(null);
  const live = useRef<HTMLCanvasElement>(null);
  const snap = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [load, setLoad] = useState<Load | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const revealed = useRef(false);

  // The signature box is often low on the page: once the page is drawn, scroll the document pane (only) to it.
  const reveal = () => {
    const pane = box.current;
    const el = pane?.querySelector<HTMLElement>('[aria-roledescription="movable signature"]');
    if (!placing || revealed.current || !pane || !el) return;
    revealed.current = true;
    const top = el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
    pane.scrollTop = Math.max(0, top - pane.clientHeight / 2);
  };

  const src = `/api/documents/${id}/file?kind=${kind}`;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // Small changes are ignored so the page is not redrawn for a few pixels of layout movement.
    const measure = () => {
      // A hidden pane measures 0: keep the last real width instead of redrawing the page tiny.
      if (el.clientWidth === 0) return;
      const next = Math.max(240, el.clientWidth - 48);
      setWidth((w) => (Math.abs(w - next) < 16 ? w : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fetched once into a blob, so a failed download becomes the designed error state and pdf.js never refetches.
  useEffect(() => {
    const ctl = new AbortController();
    let url: string | null = null;
    fetch(src, { signal: ctl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        url = URL.createObjectURL(await r.blob());
        setLoad({ src, url });
      })
      .catch(() => {
        if (!ctl.signal.aborted) setLoad({ src, error: true });
      });
    return () => {
      ctl.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [src, attempt]);

  const current = load?.src === src ? load : null;
  const failed = (current && "error" in current) || renderError === src;
  const file = current && "url" in current ? current.url : null;
  const pageWidth = zoom === "fit" ? Math.min(width, 920) : Math.round(natural.width * zoom);
  const pageHeight = Math.round((pageWidth * natural.height) / natural.width);
  const zi = zoom === "fit" ? ZOOMS.findIndex((z) => z * natural.width >= pageWidth) : ZOOMS.indexOf(zoom);
  // While a new frame draws (page, zoom or size changed) the last finished frame stays on screen, scaled.
  const frame = `${file}|${page}|${pageWidth}`;
  const stale = rendered !== null && rendered !== frame;
  const keepFrame = () => {
    const from = live.current;
    const to = snap.current;
    if (from && to && from.width > 0) {
      to.width = from.width;
      to.height = from.height;
      to.getContext("2d")?.drawImage(from, 0, 0);
    }
    setRendered(frame);
    reveal();
  };
  const step = (n: number) => setPage((p) => clamp(p + n, 1, Math.max(1, pages)));
  const zoomBy = (d: number) => {
    const base = zi < 0 ? ZOOMS.length - 1 : zi;
    setZoom(ZOOMS[clamp(base + d, 0, ZOOMS.length - 1)]);
  };

  return (
    <section aria-label="Document" className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5">
        {kinds.length > 1 ? (
          <div role="tablist" aria-label="Version" className="flex rounded-sm bg-secondary p-0.5">
            {kinds.map((k) => (
              <button
                key={k}
                role="tab"
                type="button"
                aria-selected={kind === k}
                onClick={() => {
                  onKindChange(k);
                  setRenderError(null);
                  setPages(0);
                }}
                className={cn("h-6 rounded-[3px] px-2.5 text-meta font-medium text-muted-foreground transition-colors", kind === k && "bg-card text-foreground shadow-xs")}
              >
                {k === "signed" ? "Signed" : "Original"}
              </button>
            ))}
          </div>
        ) : (
          <span className="px-1 text-meta font-medium text-muted-foreground">{kind === "signed" ? "Signed" : "Original"}</span>
        )}

        <div className="ml-auto flex items-center">
          <Tip label="Previous page">
            <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1 || failed} onClick={() => step(-1)}>
              <ChevronLeft />
            </Button>
          </Tip>
          <span className="min-w-14 text-center text-meta text-muted-foreground tnum" aria-live="polite">
            <span className="sr-only">Page </span>
            {page} / {pages || "–"}
          </span>
          <Tip label="Next page">
            <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= pages || failed} onClick={() => step(1)}>
              <ChevronRight />
            </Button>
          </Tip>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          <Tip label="Zoom out">
            <Button variant="ghost" size="icon-sm" aria-label="Zoom out" disabled={failed || zi === 0} onClick={() => zoomBy(-1)}>
              <Minus />
            </Button>
          </Tip>
          <span className="w-11 text-center text-meta text-muted-foreground tnum">{Math.round((pageWidth / natural.width) * 100)}%</span>
          <Tip label="Zoom in">
            <Button variant="ghost" size="icon-sm" aria-label="Zoom in" disabled={failed || zi === ZOOMS.length - 1} onClick={() => zoomBy(1)}>
              <Plus />
            </Button>
          </Tip>
          <Tip label="Fit to width">
            <Button variant={zoom === "fit" ? "secondary" : "ghost"} size="icon-sm" aria-label="Fit to width" aria-pressed={zoom === "fit"} disabled={failed} onClick={() => setZoom("fit")}>
              <MoveHorizontal />
            </Button>
          </Tip>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          <Tip label="Open in a new tab">
            <Button variant="ghost" size="icon-sm" aria-label="Open in a new tab" asChild>
              <a href={src} target="_blank" rel="noreferrer">
                <ExternalLink />
              </a>
            </Button>
          </Tip>
          <Tip label="Download">
            <Button variant="ghost" size="icon-sm" aria-label="Download" asChild>
              <a href={`${src}&download=1`}>
                <Download />
              </a>
            </Button>
          </Tip>
        </div>
      </div>

      <div ref={box} data-viewer-scroll className="relative h-[72dvh] overflow-auto bg-secondary/70 [scrollbar-gutter:stable] lg:h-auto lg:min-h-0 lg:flex-1">
        {failed ? (
          <div role="alert" className="flex flex-col items-center px-6 py-20 text-center">
            <FileX2 className="size-5 text-subtle" aria-hidden="true" />
            <p className="mt-3 text-[14px] font-medium">This document can&apos;t be shown</p>
            <p className="mt-1 max-w-sm text-dense text-muted-foreground">It couldn&apos;t be loaded from your OneDrive. Try again, or download it.</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                setRenderError(null);
                setAttempt((n) => n + 1);
              }}
            >
              <RotateCw aria-hidden="true" />
              Try again
            </Button>
          </div>
        ) : !file || width === 0 ? (
          <PageSkeleton width={Math.min(width || 600, 820)} />
        ) : (
          <div className="flex min-w-fit justify-center p-6">
            {/* react-pdf loads through Suspense: boundaries here keep the pane and the last frame on screen. */}
            <Suspense fallback={<PageSkeleton width={pageWidth} />}>
            <Document
              file={file}
              loading={<PageSkeleton width={pageWidth} />}
              onLoadSuccess={(d) => {
                setPages(d.numPages);
                onPageCount?.(d.numPages);
                setPage((p) => clamp(p, 1, d.numPages));
              }}
              onLoadError={() => setRenderError(src)}
            >
              <div className="relative bg-white shadow-[0_1px_3px_rgb(15_23_42/0.12)]" style={{ minHeight: pageHeight }}>
                <Suspense fallback={<div style={{ width: pageWidth, height: pageHeight }} />}>
                <Page
                  pageNumber={page}
                  width={pageWidth}
                  canvasRef={live}
                  renderAnnotationLayer={false}
                  renderTextLayer={!placing}
                  loading={<div style={{ width: pageWidth, height: pageHeight }} />}
                  onLoadSuccess={(p) => setNatural({ width: p.originalWidth || 612, height: p.originalHeight || 792 })}
                  onRenderSuccess={keepFrame}
                />
                </Suspense>
                <canvas
                  ref={snap}
                  aria-hidden="true"
                  className={cn("pointer-events-none absolute top-0 left-0", !stale && "invisible")}
                  style={{ width: pageWidth, height: pageHeight }}
                />
                {placing && (
                  placement.page === page ? (
                    <SignatureBox placement={placement} onChange={onPlacementChange} hasImage={hasSignatureImage} />
                  ) : (
                    <div className="absolute inset-x-0 bottom-4 flex justify-center">
                      <Button size="sm" variant="outline" className="shadow-pop" onClick={() => onPlacementChange({ ...placement, page })}>
                        Move signature to this page
                      </Button>
                    </div>
                  )
                )}
              </div>
            </Document>
            </Suspense>
          </div>
        )}
        {placing && pages > 0 && placement.page !== page && (
          <p className="sr-only" aria-live="polite">The signature is on page {placement.page}.</p>
        )}
      </div>
    </section>
  );
}

function PageSkeleton({ width }: { width: number }) {
  return (
    <div className="flex justify-center p-6" role="status" aria-label="Loading document">
      <Skeleton className="bg-card" style={{ width, height: Math.round(width * 1.294) }} />
    </div>
  );
}

// The signature image, placed on the page. Drag to move, drag the corner to resize, or use the arrow keys.
function SignatureBox({ placement: p, onChange, hasImage }: { placement: Placement; onChange: (p: Placement) => void; hasImage: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [imageOk, setImageOk] = useState(hasImage);


  const fit = (n: Placement): Placement => {
    const width = clamp(n.width, 0.05, 1);
    const height = clamp(n.height, 0.02, 1);
    return { page: n.page, width, height, x: clamp(n.x, 0, 1 - width), y: clamp(n.y, 0, 1 - height) };
  };

  const drag = (e: React.PointerEvent, mode: "move" | "resize") => {
    const page = ref.current?.parentElement?.getBoundingClientRect();
    if (!page) return;
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, p };
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / page.width;
      const dy = (ev.clientY - start.y) / page.height;
      if (mode === "move") onChange(fit({ ...start.p, x: start.p.x + dx, y: start.p.y + dy }));
      else {
        const width = clamp(start.p.width + dx, 0.05, 1 - start.p.x);
        // Keep the image's proportions: its height follows the width on this page's shape.
        const height = aspect ? (width * page.width) / aspect / page.height : start.p.height + dy;
        onChange(fit({ ...start.p, width, height: Math.min(height, 1 - start.p.y) }));
      }
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const key = (e: React.KeyboardEvent) => {
    const s = e.shiftKey ? 0.02 : 0.005;
    const moves: Record<string, Partial<Placement>> = {
      ArrowLeft: { x: p.x - s },
      ArrowRight: { x: p.x + s },
      ArrowUp: { y: p.y - s },
      ArrowDown: { y: p.y + s },
      "+": { width: p.width * 1.05, height: p.height * 1.05 },
      "=": { width: p.width * 1.05, height: p.height * 1.05 },
      "-": { width: p.width / 1.05, height: p.height / 1.05 },
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    onChange(fit({ ...p, ...m }));
  };

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-roledescription="movable signature"
      aria-label="Signature position. Use the arrow keys to move it, plus and minus to resize."
      aria-description={`Page ${p.page}, ${Math.round(p.x * 100)}% from the left, ${Math.round(p.y * 100)}% from the top`}
      onKeyDown={key}
      onPointerDown={(e) => drag(e, "move")}
      className="group absolute cursor-move touch-none rounded-[2px] border border-dashed border-primary bg-primary/5 outline-none ring-primary/30 transition-shadow focus-visible:ring-4"
      style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${p.width * 100}%`, height: `${p.height * 100}%` }}
    >
      <span className="pointer-events-none absolute top-0.5 right-0.5 rounded-sm bg-primary/90 px-1 py-px text-[10px] font-medium whitespace-nowrap text-primary-foreground">Signature</span>
      {imageOk ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/api/signature"
          alt=""
          draggable={false}
          className="pointer-events-none size-full object-contain select-none"
          onLoad={(e) => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
          onError={() => setImageOk(false)}
        />
      ) : (
        <span className="pointer-events-none grid size-full place-items-center text-meta text-primary">Your signature</span>
      )}
      <span
        aria-hidden="true"
        onPointerDown={(e) => drag(e, "resize")}
        className="absolute -right-1.5 -bottom-1.5 size-3 cursor-nwse-resize touch-none rounded-[2px] border border-primary bg-card"
      />
    </div>
  );
}
