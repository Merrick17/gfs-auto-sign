"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Re-reads the page from the server: quickly while something is running, slowly otherwise to pick up new mail.
// Paused while the tab is hidden.
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = window.setInterval(tick, active ? 3000 : 20000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [active, router]);
  return null;
}
