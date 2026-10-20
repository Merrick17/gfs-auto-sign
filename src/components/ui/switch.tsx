"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type Props = Omit<ComponentProps<"input">, "type" | "size" | "onChange"> & {
  size?: "sm" | "default";
  onCheckedChange?: (checked: boolean) => void;
};

export function Switch({ className, size = "default", onCheckedChange, disabled, ...props }: Props) {
  return <span className={cn("relative inline-flex h-7 w-10 shrink-0 items-center", size === "sm" && "h-6 w-8", disabled && "opacity-50", className)}>
    <input {...props} type="checkbox" role="switch" disabled={disabled} onChange={event => onCheckedChange?.(event.target.checked)} data-slot="switch" className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed" />
    <span aria-hidden="true" className={cn("pointer-events-none block h-5 w-9 rounded-full border border-input bg-input transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring/40 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-background", size === "sm" && "h-4 w-7")} />
    <span aria-hidden="true" className={cn("pointer-events-none absolute left-0.5 size-4 rounded-full bg-white shadow-xs transition-transform peer-checked:translate-x-4", size === "sm" && "size-3 peer-checked:translate-x-3")} />
  </span>;
}
