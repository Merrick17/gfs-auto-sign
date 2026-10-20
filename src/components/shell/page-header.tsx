"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// The top of the work panel. It stays put while the content scrolls under it, and gains a soft edge once
// something is underneath.
export function PageHeader({ title, children, below, className }: { title: React.ReactNode; children?: React.ReactNode; below?: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [lifted, setLifted] = useState(false);

  useEffect(() => {
    const scroller = ref.current?.closest("[data-scroll]");
    if (!scroller) return;
    const onScroll = () => setLifted(scroller.scrollTop > 2);
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "sticky top-0 z-20 border-b bg-card transition-shadow duration-200",
        lifted && "shadow-[0_6px_16px_-12px_rgb(15_23_42/0.35)]",
        className,
      )}
    >
      <div className="flex min-h-[56px] flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2.5">
        <h1 className="min-w-0 truncate text-page">{title}</h1>
        {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
      </div>
      {below && <div className="px-5">{below}</div>}
    </div>
  );
}
