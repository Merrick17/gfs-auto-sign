"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export const SETTINGS_SECTIONS = [
  { id: "microsoft", label: "Microsoft 365" },
  { id: "signature", label: "My signature" },
  { id: "rules", label: "Sender rules" },
  { id: "draft", label: "Draft preferences" },
] as const;

// Settings sub-navigation, as in Proton's settings: the section in view is marked while you scroll.
export function SettingsNav({ scroller }: { scroller: string }) {
  const [active, setActive] = useState<string>(SETTINGS_SECTIONS[0].id);
  useEffect(() => {
    const root = document.getElementById(scroller);
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { root, rootMargin: "0px 0px -60% 0px" },
    );
    for (const s of SETTINGS_SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [scroller]);

  return (
    <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto border-b px-4 py-2 [scrollbar-width:none] md:flex-col md:gap-px md:overflow-visible md:border-b-0 md:px-3 md:py-4">
      <p className="hidden px-3 pb-2 text-meta font-medium tracking-wide text-muted-foreground uppercase md:block">Settings</p>
      {SETTINGS_SECTIONS.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          aria-current={active === s.id ? "true" : undefined}
          onClick={() => setActive(s.id)}
          className={cn(
            "flex h-9 shrink-0 items-center rounded-md px-3 text-[14px] transition-colors duration-150",
            active === s.id ? "bg-hover font-bold text-foreground" : "text-foreground hover:bg-hover",
          )}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}
