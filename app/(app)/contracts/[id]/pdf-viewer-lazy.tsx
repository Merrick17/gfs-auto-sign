"use client";

import dynamic from "next/dynamic";

// pdf.js touches `window` at import time, so the viewer only loads in the browser.
export const PdfViewerLazy = dynamic(() => import("./pdf-viewer").then((m) => m.PdfViewer), {
  ssr: false,
  loading: () => <p className="p-4 text-muted">Loading…</p>,
});
