"use client";

import { useRealtimeRunsWithTag } from "@trigger.dev/react-hooks";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

// Trigger.dev Realtime is the change signal; Neon stays the source of truth.
export function LiveRefresh({ token, tag }: { token: string; tag: string }) {
  const router = useRouter();
  const { runs } = useRealtimeRunsWithTag(tag, { accessToken: token });
  const last = useRef("");

  useEffect(() => {
    const sig = runs.map((r) => `${r.id}:${r.status}:${r.metadata?.stage ?? ""}`).join(",");
    if (sig !== last.current) {
      last.current = sig;
      router.refresh();
    }
  }, [runs, router]);

  return (
    <span className="text-xs text-muted">
      {runs.some((r) => !["COMPLETED", "FAILED", "CANCELED", "CRASHED", "SYSTEM_FAILURE", "TIMED_OUT"].includes(r.status))
        ? "Processing live"
        : "Live"}
    </span>
  );
}
