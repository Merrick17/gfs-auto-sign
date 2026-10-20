import type { Placement } from "./placement";

// Finds where GFS signs by reading the PDF's own text layout: a signature label ("Date/stamp/signature",
// "Signature", "Unterschrift" …) together with the party it belongs to, matched against the role GFS has in
// the document ("Vendor: … Green Fashion Solution"). Works without any AI service and never guesses: when the
// label or the role is unclear the result says so through a lower confidence.

export type LayoutResult = {
  locations: (Placement & { evidence: string })[];
  confidence: number;
  role: string | null; // the role GFS has in this document, when the document names it
};

type Item = { text: string; page: number; x: number; y: number; w: number }; // fractions, origin top-left, y = baseline

const OUR_NAME = /green\s*fashion|\bgfs\b/i;
const SIGNATURE = /signature|signed\s+by|sign\s+here|unterschrift|firma|signature\s+et\s+cachet|date\s*\/\s*stamp/i;
const ROLES = ["vendor", "supplier", "seller", "manufacturer", "contractor", "agent", "principal", "buyer", "customer", "purchaser", "client"] as const;
const roleIn = (t: string) => ROLES.find((r) => new RegExp(`\\b${r}\\b`, "i").test(t)) ?? null;

async function readItems(pdf: Buffer): Promise<{ items: Item[]; pages: number }> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(pdf), disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  const items: Item[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    for (const raw of tc.items) {
      const it = raw as { str?: string; transform?: number[]; width?: number };
      if (!it.str?.trim() || !it.transform) continue;
      // The viewport transform maps PDF space to the page as displayed (rotation included).
      const [vx, vy] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      items.push({ text: it.str.trim(), page: p, x: vx / vp.width, y: vy / vp.height, w: (it.width ?? 0) / vp.width });
    }
  }
  await task.destroy();
  return { items, pages: doc.numPages };
}

// The role GFS plays: a label on the same line as our company name ("Vendor:  5006306 - Green Fashion Solution FZCO").
function ourRole(items: Item[]): string | null {
  for (const it of items) {
    if (!OUR_NAME.test(it.text)) continue;
    const sameLine = items.filter((o) => o.page === it.page && Math.abs(o.y - it.y) < 0.008 && o.x < it.x);
    for (const o of sameLine.sort((a, b) => b.x - a.x)) {
      const r = roleIn(o.text);
      if (r) return r;
    }
    const inside = roleIn(it.text);
    if (inside) return inside;
  }
  return null;
}

export async function locateSignature(pdf: Buffer): Promise<LayoutResult> {
  const { items, pages } = await readItems(pdf);
  const role = ourRole(items);
  const labels = items
    .filter((it) => SIGNATURE.test(it.text))
    .map((it) => {
      // The party is written on the label or on the line just below it ("Date/stamp/signature" / "vendor").
      const below = items.find((o) => o.page === it.page && o.y > it.y && o.y - it.y < 0.03 && Math.abs(o.x - it.x) < 0.06);
      const party = roleIn(it.text) ?? (below ? roleIn(below.text) : null) ?? (OUR_NAME.test(it.text) || (below && OUR_NAME.test(below.text)) ? "gfs" : null);
      return { it, party };
    });
  if (labels.length === 0) return { locations: [], confidence: 0, role };

  const ours = labels.filter((l) => l.party === "gfs" || (role && l.party === role));
  const pick = ours.length > 0 ? ours : labels.length === 1 ? labels : [];
  if (pick.length === 0) return { locations: [], confidence: 0.3, role };

  // Prefer the last occurrence: signature blocks close the document.
  const { it, party } = pick.sort((a, b) => b.it.page - a.it.page || b.it.y - a.it.y)[0];
  const width = 0.3;
  const x = Math.min(Math.max(0, it.x - 0.01), 1 - width);
  // The signature goes in the free space above the label: below the nearest printed line in the same column.
  const labelTop = it.y - 0.014; // baseline minus the label's cap height
  const above = items
    .filter((o) => o.page === it.page && o.y < labelTop - 0.004 && o.x < x + width && o.x + o.w > x)
    .reduce((m, o) => Math.max(m, o.y), labelTop - 0.2);
  const top = above + 0.008;
  const height = Math.max(0.03, Math.min(0.08, labelTop - 0.006 - top));
  const y = Math.min(Math.max(0, labelTop - 0.006 - height), 1 - height);
  const confidence = ours.length > 0 && (party === "gfs" || role) ? 0.92 : 0.6;
  return {
    locations: [{ page: it.page, x, y, width, height, evidence: `${it.text}${party ? ` (${party})` : ""}, page ${it.page} of ${pages}` }],
    confidence,
    role,
  };
}
