import { cn } from "@/lib/utils";

export type BrandAssets = { logo: string | null; mark: string | null };

// The built-in mark: a signature stroke over a baseline, on the brand blue. While the agent is checking mail the
// stroke writes itself out; it rests otherwise. Hover lifts it slightly.
export function BrandMark({ busy = false, className, src }: { busy?: boolean; className?: string; src?: string | null }) {
  if (src)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" aria-hidden="true" className={cn("size-7 shrink-0 object-contain transition-transform duration-200 ease-out group-hover/brand:-translate-y-px", busy && "brand-busy-img", className)} />
    );
  return (
    <svg
      viewBox="0 0 28 28"
      aria-hidden="true"
      className={cn("size-7 shrink-0 transition-transform duration-200 ease-out group-hover/brand:-translate-y-px group-hover/brand:-rotate-3", className)}
    >
      <rect width="28" height="28" rx="6" className="fill-primary" />
      <path d="M6.5 20.5h15" stroke="white" strokeOpacity=".45" strokeWidth="1.4" strokeLinecap="round" />
      <path
        d="M6.5 16.5c1.6-.4 2.8-4.9 4.3-4.9 1.3 0 .4 4.3 1.9 4.3 1.6 0 2.4-6.2 4.2-6.2 1.5 0 .3 6.4 2 6.4 1 0 1.6-1.3 2.6-2.1"
        fill="none"
        stroke="white"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        className={cn("brand-stroke", busy && "brand-stroke-busy")}
      />
    </svg>
  );
}

export function Brand({ assets, busy = false, className }: { assets?: BrandAssets; busy?: boolean; className?: string }) {
  if (assets?.logo)
    return (
      <span className={cn("group/brand relative flex items-center", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assets.logo} alt="GFS Contract Agent" className="h-7 w-auto max-w-[168px] object-contain transition-transform duration-200 ease-out group-hover/brand:-translate-y-px" />
        {busy && <span aria-hidden="true" className="brand-sweep absolute -bottom-1.5 left-0 h-0.5 w-full overflow-hidden rounded-full bg-primary/15" />}
      </span>
    );
  return (
    <span className={cn("group/brand flex items-center gap-2.5", className)}>
      <BrandMark busy={busy} src={assets?.mark} />
      <span className="flex flex-col leading-none">
        <span className="text-[14px] font-medium tracking-tight text-foreground">GFS</span>
        <span className="mt-0.5 text-meta text-muted-foreground">Contract Agent</span>
      </span>
    </span>
  );
}
