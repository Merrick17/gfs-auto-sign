import { connection } from "next/server";
import { requireOwner } from "@/auth";
import { auth as triggerAuth } from "@trigger.dev/sdk";
import Link from "next/link";
import { Suspense } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { LiveRefresh } from "./live-refresh";

const STAGE_LABEL: Record<string, string> = {
  EMAIL_RECEIVED: "Email received",
  REVIEWING: "Reviewing contract",
  EVALUATING: "Evaluating commercial terms",
  SIGNING: "Applying signature",
  VERIFYING: "Verifying signature",
  UPLOADING: "Uploading signed PDF",
  CREATING_DRAFT: "Creating Outlook draft",
  COMPLETED: "Draft ready",
  REQUIRES_REVIEW: "Requires review",
  FAILED: "Failed",
};

const TABS = [
  { key: "all", label: "All", where: { status: { not: "IGNORED" } } },
  { key: "processing", label: "Processing", where: { status: { in: ["RECEIVED", "ANALYZING", "AUTHORIZED", "SIGNING", "SIGNED", "STORED"] } } },
  { key: "drafts", label: "Drafts ready", where: { status: "DRAFT_READY" } },
  { key: "review", label: "Exceptions", where: { status: "NEEDS_REVIEW" } },
  { key: "failed", label: "Failures", where: { status: "FAILED" } },
] as { key: string; label: string; where: Prisma.ContractWhereInput }[];

const tone = (stage: string) =>
  stage === "COMPLETED" ? "text-ok" : stage === "REQUIRES_REVIEW" ? "text-warn" : stage === "FAILED" ? "text-bad" : "text-accent";

async function Operations({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await connection();
  await requireOwner(); // never read data for an unauthenticated request
  const { view = "all" } = await searchParams;
  const db = getDb();
  const tab = TABS.find((t) => t.key === view) ?? TABS[0];
  const [rows, counts, token] = await Promise.all([
    db.contract.findMany({
      where: tab.where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { analyses: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
    Promise.all(TABS.map((t) => db.contract.count({ where: t.where }))),
    // Without a Trigger.dev key the table still renders; only live updates are off.
    triggerAuth.createPublicToken({ scopes: { read: { tags: ["gfs"] } }, expirationTime: "1h" }).catch(() => null),
  ]);

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-3 flex items-center gap-1">
        {TABS.map((t, i) => (
          <Link
            key={t.key}
            href={t.key === "all" ? "/" : `/?view=${t.key}`}
            className={`rounded px-3 py-1.5 ${t.key === tab.key ? "bg-surface font-medium shadow-sm" : "text-muted hover:text-foreground"}`}
          >
            {t.label} <span className="text-muted">{counts[i]}</span>
          </Link>
        ))}
        <span className="ml-auto">{token ? <LiveRefresh token={token} tag="gfs" /> : <span className="text-xs text-muted">Live updates off</span>}</span>
      </div>
      <div className="overflow-x-auto rounded border border-line bg-surface">
        <table className="w-full min-w-[760px] text-left">
          <thead className="border-b border-line text-muted">
            <tr>
              <th className="px-3 py-2 font-normal">Customer</th>
              <th className="px-3 py-2 font-normal">Contract</th>
              <th className="px-3 py-2 text-right font-normal">Amount</th>
              <th className="px-3 py-2 font-normal">Received</th>
              <th className="px-3 py-2 font-normal">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-muted">No contracts here.</td></tr>
            )}
            {rows.map((c) => {
              const r = c.analyses[0]?.result as { amount?: number | null; currency?: string | null } | undefined;
              return (
                <tr key={c.id} className="border-b border-line last:border-0 hover:bg-background">
                  <td className="px-3 py-2">{c.customer ?? "—"}</td>
                  <td className="px-3 py-2">{c.contractNumber ?? c.attachmentName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r?.amount != null ? `${r.amount.toLocaleString("en-US")} ${r.currency ?? ""}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-muted">{c.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td className={`px-3 py-2 ${tone(c.stage)}`} title={c.exception ?? undefined}>
                    {STAGE_LABEL[c.stage] ?? c.stage}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/contracts/${c.id}`} className="text-accent hover:underline">Review</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Page(props: PageProps<"/">) {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <Operations searchParams={props.searchParams as Promise<{ view?: string }>} />
    </Suspense>
  );
}
