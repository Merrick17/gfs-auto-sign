import { connection } from "next/server";
import { requireOwner } from "@/auth";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { ContractExtraction } from "@/lib/contract-schema";
import { getDb } from "@/lib/db";
import { PdfViewerLazy } from "./pdf-viewer-lazy";

type Sig = { field: string; ours: boolean; intact: boolean; valid: boolean; trustedByOwnRootOnly?: boolean };

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex gap-3 border-b border-line py-1.5 last:border-0">
    <dt className="w-36 shrink-0 text-muted">{k}</dt>
    <dd className="min-w-0 break-words">{v ?? "—"}</dd>
  </div>
);

async function Review({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireOwner(); // never read data for an unauthenticated request
  const { id } = await params;
  const c = await getDb().contract.findUnique({
    where: { id },
    include: {
      analyses: { orderBy: { createdAt: "desc" }, take: 1 },
      documents: true,
      draft: true,
      audits: { orderBy: { createdAt: "asc" }, take: 50 },
    },
  });
  if (!c) notFound();
  const a = c.analyses[0];
  const d = a?.result as ContractExtraction | undefined;
  const signed = c.documents.find((x) => x.kind === "SIGNED");
  const sigs = ((signed?.verification as { signatures?: Sig[] } | null)?.signatures ?? []) as Sig[];
  const reasons = (a?.reasons as string[] | undefined) ?? [];

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4 lg:grid-cols-[minmax(0,600px)_1fr]">
      <section className="rounded border border-line bg-surface">
        <h2 className="border-b border-line px-3 py-2 font-medium">{signed ? "Signed document" : "Original document"}</h2>
        <PdfViewerLazy src={`/api/contracts/${c.id}/document?kind=${signed ? "SIGNED" : "ORIGINAL"}`} />
      </section>

      <div className="space-y-4">
        <section className="rounded border border-line bg-surface p-3">
          <h2 className="mb-2 font-medium">Decision</h2>
          <p className={a?.decision === "APPROVE" ? "text-ok" : "text-warn"}>
            {a?.decision === "APPROVE" ? `Signed under policy v${a.policyVersion}` : c.exception ?? "Awaiting decision"}
          </p>
          {a?.decision === "REVIEW" && reasons.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          )}
        </section>

        {d && (
          <section className="rounded border border-line bg-surface p-3">
            <h2 className="mb-2 font-medium">Extracted terms</h2>
            <dl>
              <Row k="Customer" v={d.customer} />
              <Row k="Contract" v={[d.contractNumber, d.version && `v${d.version}`].filter(Boolean).join(" ")} />
              <Row k="Date" v={d.contractDate} />
              <Row k="Amount" v={d.amount != null ? `${d.amount.toLocaleString("en-US")} ${d.currency ?? ""}` : null} />
              <Row k="Payment" v={d.paymentTerms} />
              <Row k="Delivery" v={d.deliveryTerms} />
              <Row k="Articles" v={d.articles.length ? d.articles.map((x) => `${x.style} × ${x.quantity ?? "?"}`).join(", ") : null} />
              <Row k="Signature spot" v={d.gfsSignatureLocations[0] ? `Page ${d.gfsSignatureLocations[0].page}` : "Not found"} />
              <Row k="Existing signatures" v={d.existingSignatures.length ? d.existingSignatures.map((s) => `${s.signer ?? "unnamed"} (${s.kind})`).join(", ") : "None"} />
              <Row k="Model" v={`${a.model} · confidence ${d.confidence}`} />
            </dl>
          </section>
        )}

        {d && (d.inconsistencies.length > 0 || d.unusualCommitments.length > 0 || d.evidence.length > 0) && (
          <section className="rounded border border-line bg-surface p-3">
            <h2 className="mb-2 font-medium">Findings</h2>
            {[...d.inconsistencies, ...d.unusualCommitments].map((f) => (
              <p key={f} className="text-warn">{f}</p>
            ))}
            <ul className="mt-2 space-y-1 text-muted">
              {d.evidence.map((e, i) => (
                <li key={i}><span className="text-foreground">{e.field}</span> {e.page ? `p.${e.page}` : ""}: “{e.quote}”</li>
              ))}
            </ul>
          </section>
        )}

        {signed && (
          <section className="rounded border border-line bg-surface p-3">
            <h2 className="mb-2 font-medium">Signature verification</h2>
            {sigs.map((s) => (
              <p key={s.field} className={s.intact && s.valid ? "text-ok" : "text-bad"}>
                {s.ours ? "GFS signature" : `Existing: ${s.field}`} — {s.intact && s.valid ? "valid, document intact" : "failed"}
              </p>
            ))}
            <p className="mt-2 text-muted">
              Cryptographic validity confirms the file is unaltered since signing. It does not establish trusted legal identity unless the certificate chains to a trusted authority.
            </p>
            <p className="mt-1 break-all text-xs text-muted">SHA-256 {signed.sha256}</p>
            <a className="mt-2 inline-block text-accent hover:underline" href={`/api/contracts/${c.id}/document?kind=SIGNED`}>Download signed PDF</a>
          </section>
        )}

        {c.draft && (
          <section className="rounded border border-line bg-surface p-3">
            <h2 className="mb-2 font-medium">Outlook draft</h2>
            <dl>
              <Row k="State" v={c.draft.state === "ATTACHED" ? "In Drafts, signed PDF attached" : c.draft.state} />
              <Row k="To" v={((c.draft.to as string[] | null) ?? ["Original sender"]).join(", ")} />
              <Row k="CC" v={((c.draft.cc as string[] | null) ?? []).join(", ") || "None"} />
            </dl>
          </section>
        )}

        <section className="rounded border border-line bg-surface p-3">
          <h2 className="mb-2 font-medium">History</h2>
          <ul className="space-y-0.5 text-muted">
            {c.audits.map((e) => (
              <li key={e.id}>{e.createdAt.toISOString().slice(11, 19)} {e.action}</li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

export default function Page(props: PageProps<"/contracts/[id]">) {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <Review params={props.params} />
    </Suspense>
  );
}
