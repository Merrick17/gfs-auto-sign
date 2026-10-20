import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Workspace } from "@/components/document/workspace";
import { ChevronLeft, ChevronRight, FileText } from "@/components/icons";
import { RuleDialog } from "@/components/rules/rule-dialog";
import { AutoRefresh } from "@/components/shell/auto-refresh";
import { Skeleton } from "@/components/ui/skeleton";
import { getDraftSettings } from "@/lib/settings";
import { documentDetail, type DocumentDetail } from "@/lib/views";

export const metadata: Metadata = { title: "Document" };

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-b px-4 py-4 last:border-b-0 md:px-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-meta font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

function People({ label, list, empty }: { label: string; list: string[]; empty: string }) {
  return (
    <div className="flex gap-3 text-dense">
      <dt className="w-8 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{list.length ? list.join(", ") : <span className="text-muted-foreground">{empty}</span>}</dd>
    </div>
  );
}

async function Aside({ d }: { d: DocumentDetail }) {
  const settings = await getDraftSettings();
  const willTo = d.rule?.to.length ? d.rule.to : [];
  const willCc = [...new Set([...(d.rule?.cc ?? []), ...settings.cc])].filter((e) => !willTo.includes(e));
  return (
    <>
      <Section
        title="Outlook draft"
        action={
          d.senderAddress && !d.draft ? (
            <RuleDialog
              sender={d.senderAddress}
              documentId={d.id}
              rule={d.rule ? { id: d.rule.id, sender: d.rule.sender, to: d.rule.to, cc: d.rule.cc, autoSign: d.rule.autoSign } : null}
              trigger={d.rule ? "Edit recipients" : "Choose recipients"}
            />
          ) : undefined
        }
      >
        <dl className="flex flex-col gap-1.5">
          {d.draft ? (
            <>
              <People label="To" list={d.draft.to} empty="The sender" />
              <People label="CC" list={d.draft.cc} empty="Nobody" />
            </>
          ) : (
            <>
              <People label="To" list={willTo} empty={d.senderAddress ? `${d.senderAddress} (reply)` : "The sender (reply)"} />
              <People label="CC" list={willCc} empty="Nobody" />
            </>
          )}
        </dl>
        <p className="mt-2.5 text-meta text-muted-foreground">
          {d.draft
            ? "Saved in your Outlook Drafts. It is never sent automatically."
            : d.rule
              ? `From your rule for ${d.rule.sender}. The draft is saved, never sent.`
              : "No rule for this sender yet. The draft is saved, never sent."}
        </p>
      </Section>

      {/* Only when the email really carries several PDFs: where this one sits, and a way to step through them. */}
      {d.email.total > 1 && (
        <Section title="Email attachments">
          <div className="flex items-center gap-2">
            <FileText className="size-4 shrink-0 text-subtle" aria-hidden="true" />
            <span className="flex-1 text-dense tnum">
              PDF {d.email.index} of {d.email.total} in this email
            </span>
            <nav aria-label="Other PDFs in this email" className="flex gap-1">
              {d.email.previous ? (
                <Link href={`/documents/${d.email.previous}`} aria-label="Previous PDF in this email" className="grid size-7 place-items-center rounded-sm border transition-colors hover:bg-hover">
                  <ChevronLeft className="size-4" aria-hidden="true" />
                </Link>
              ) : (
                <span aria-hidden="true" className="grid size-7 place-items-center rounded-sm border text-subtle opacity-50">
                  <ChevronLeft className="size-4" />
                </span>
              )}
              {d.email.next ? (
                <Link href={`/documents/${d.email.next}`} aria-label="Next PDF in this email" className="grid size-7 place-items-center rounded-sm border transition-colors hover:bg-hover">
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Link>
              ) : (
                <span aria-hidden="true" className="grid size-7 place-items-center rounded-sm border text-subtle opacity-50">
                  <ChevronRight className="size-4" />
                </span>
              )}
            </nav>
          </div>
        </Section>
      )}
    </>
  );
}

async function DocumentContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = /^[A-Za-z0-9_-]{1,64}$/.test(id) ? await documentDetail(id) : null;
  if (!d) notFound();
  return (
    <>
      <AutoRefresh active={d.view.group === "processing"} />
      <Workspace
        key={`${d.id}:${d.status}:${d.attention}:${d.hasSigned}`}
        doc={{
          id: d.id,
          name: d.name,
          sender: d.sender,
          senderAddress: d.senderAddress,
          subject: d.subject,
          receivedAt: d.receivedAt.toISOString(),
          status: d.status,
          attention: d.attention,
          view: d.view,
          exception: d.exception,
          hasSigned: d.hasSigned,
          pageCount: d.pageCount,
          suggestedPlacement: d.suggestedPlacement,
          action: d.action,
          remembered: Boolean(d.rule?.remembered),
          hasSignatureImage: d.hasSignatureImage,
          steps: d.steps,
          duration: d.duration,
        }}
        aside={<Aside d={d} />}
      />
    </>
  );
}

function DocumentSkeleton() {
  return (
    <div role="status" aria-label="Loading document" data-fill className="flex flex-1 flex-col">
      <div className="border-b px-5 py-4">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="mt-2 h-6 w-72 max-w-full" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
        <div className="mt-5 grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      </div>
      <div className="flex flex-1">
        <div className="hidden w-[320px] border-r p-5 lg:block">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="mb-4 h-8" />
          ))}
        </div>
        <div className="flex flex-1 justify-center bg-secondary/70 p-6">
          <Skeleton className="h-[600px] w-full max-w-[820px] bg-card" />
        </div>
      </div>
    </div>
  );
}

export default function DocumentPage(props: PageProps<"/documents/[id]">) {
  return (
    <Suspense fallback={<DocumentSkeleton />}>
      <DocumentContent params={props.params} />
    </Suspense>
  );
}
