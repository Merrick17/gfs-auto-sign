"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// List and reading pane side by side from 1024px. Below that, one at a time: the list, or the open document.
export function MailSplit({ list, children }: { list: React.ReactNode; children: React.ReactNode }) {
  const open = usePathname().startsWith("/documents/");
  return (
    <div data-fill className="flex min-h-0 flex-1">
      <div className={cn("min-h-0 lg:flex", open ? "hidden" : "flex w-full lg:w-auto")}>{list}</div>
      <div className={cn("min-h-0 min-w-0 flex-1 flex-col", open ? "flex" : "hidden lg:flex")}>{children}</div>
    </div>
  );
}
