"use client";

import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export function PdfViewer({ src }: { src: string }) {
  const [pages, setPages] = useState(0);
  const [error, setError] = useState(false);
  if (error) return <p className="p-4 text-muted">Document unavailable.</p>;
  return (
    <div className="max-h-[80vh] overflow-auto bg-background p-2">
      <Document file={src} onLoadSuccess={(d) => setPages(d.numPages)} onLoadError={() => setError(true)} loading={<p className="p-4 text-muted">Loading…</p>}>
        {Array.from({ length: pages }, (_, i) => (
          <Page key={i} pageNumber={i + 1} width={560} className="mb-2 shadow-sm" />
        ))}
      </Document>
    </div>
  );
}
