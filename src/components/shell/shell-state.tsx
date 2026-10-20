"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

// Shared, short-lived UI state of the shell: whether "Check mail" is running (the logo shows it), and a signal
// that documents changed so the list re-reads without a full page refresh.
type ShellState = { checking: boolean; setChecking: (v: boolean) => void; version: number; changed: () => void };

const Ctx = createContext<ShellState | null>(null);

export const DOCUMENTS_CHANGED = "gfs:documents-changed";

export function ShellStateProvider({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(false);
  const [version, setVersion] = useState(0);
  const changed = useCallback(() => setVersion((v) => v + 1), []);
  // Components outside this tree (dialogs, the document workspace) announce changes with a window event.
  useEffect(() => {
    window.addEventListener(DOCUMENTS_CHANGED, changed);
    return () => window.removeEventListener(DOCUMENTS_CHANGED, changed);
  }, [changed]);
  const value = useMemo(() => ({ checking, setChecking, version, changed }), [checking, version, changed]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShellState(): ShellState {
  const v = useContext(Ctx);
  return v ?? { checking: false, setChecking: () => undefined, version: 0, changed: () => undefined };
}

export const announceDocumentsChanged = () => window.dispatchEvent(new Event(DOCUMENTS_CHANGED));
