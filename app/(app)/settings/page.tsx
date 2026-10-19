import { connection } from "next/server";
import { Suspense } from "react";
import { budgetState } from "@/lib/budget";
import { getDb } from "@/lib/db";
import type { PolicyRules } from "@/lib/policy";
import { BudgetForm, ConnectButton, PolicyForm, SignerForm } from "./forms";

const EXAMPLE: PolicyRules = {
  minConfidence: 0.8,
  mandatoryReviewKeywords: ["exclusivity", "penalty"],
  customers: [
    {
      name: "Customer name as printed on contracts",
      currency: "EUR",
      maxAmount: 50000,
      contractTypes: [],
      paymentTerms: ["30 days"],
      deliveryTerms: ["FOB"],
      replyTo: [],
      cc: [],
      instructions: "",
    },
  ],
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded border border-line bg-surface p-3">
    <h2 className="mb-2 font-medium">{title}</h2>
    {children}
  </section>
);

async function Settings() {
  await connection();
  const db = getDb();
  const [subs, policy, profile, budget, usage] = await Promise.all([
    db.graphSubscription.findMany({ orderBy: { createdAt: "desc" }, take: 3 }),
    db.signingPolicy.findFirst({ where: { active: true }, orderBy: { version: "desc" } }),
    db.signatureProfile.findFirst({ where: { active: true } }),
    budgetState(),
    db.usageRecord.aggregate({ _count: true, _sum: { inputTokens: true, outputTokens: true } }),
  ]);

  return (
    <div className="mx-auto grid max-w-[1100px] gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Section title="Microsoft 365 connection">
          {subs.length === 0 ? <p className="mb-2 text-muted">No subscription yet.</p> : (
            <ul className="mb-2 space-y-1">
              {subs.map((s) => (
                <li key={s.id} className={s.status === "active" ? "" : "text-muted"}>
                  {s.status} · expires {s.expiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                </li>
              ))}
            </ul>
          )}
          <ConnectButton />
        </Section>

        <Section title="Signer and certificate">
          {profile ? (
            <dl className="mb-3 space-y-0.5">
              <p>{profile.signatoryName}{profile.title ? `, ${profile.title}` : ""}</p>
              <p className="text-muted">{profile.certSubject}</p>
              <p className="text-muted">Valid until {profile.certNotAfter.toISOString().slice(0, 10)}</p>
              {profile.selfSigned && <p className="text-warn">Self-signed: cryptographically verifiable, but not a trusted legal identity.</p>}
            </dl>
          ) : <p className="mb-3 text-muted">No signer configured.</p>}
          <SignerForm />
        </Section>

        <Section title="AI usage">
          <p className="mb-2 text-muted">
            This month: ${budget.spent.toFixed(2)}{budget.limit !== null ? ` of $${budget.limit.toFixed(2)}` : ""} · {usage._count} calls ·{" "}
            {(usage._sum.inputTokens ?? 0).toLocaleString("en-US")} in / {(usage._sum.outputTokens ?? 0).toLocaleString("en-US")} out tokens
          </p>
          {budget.alert && <p className="mb-2 text-warn">{budget.exhausted ? "Budget reached: new contracts pause for review." : "80% of the monthly budget is used."}</p>}
          <BudgetForm value={budget.limit} />
        </Section>
      </div>

      <Section title="Signing mandate and rules">
        <PolicyForm
          rules={JSON.stringify(policy?.rules ?? EXAMPLE, null, 2)}
          enabled={policy?.autonomousSigningEnabled ?? false}
          version={policy?.version ?? null}
        />
      </Section>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <Settings />
    </Suspense>
  );
}
