"use client"

import { CircleCheck as CircleCheckIcon, Info as InfoIcon, Loader2 as Loader2Icon, X as OctagonXIcon, TriangleAlert as TriangleAlertIcon } from "@/components/icons";
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "6px",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
