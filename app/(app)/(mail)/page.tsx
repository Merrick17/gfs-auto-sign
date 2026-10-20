import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Keyboard, PenLine } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { folderCounts } from "@/lib/mailbox-view";
import { getActiveSignatureImage } from "@/lib/signature-image";

export const metadata: Metadata = { title: "Inbox" };

async function Overview() {
  await connection();
  const [counts, image] = await Promise.all([folderCounts(), getActiveSignatureImage()]);

  return (
    <div className="grid w-full max-w-2xl items-center gap-8 sm:grid-cols-[minmax(170px,0.8fr)_1.2fr] sm:gap-10">
      <div className="relative mx-auto grid size-44 place-items-center sm:size-52" aria-hidden="true">
        <div className="absolute inset-2 rounded-[2rem] bg-primary-soft/70" />
        <svg viewBox="0 0 180 200" className="relative h-44 w-40 drop-shadow-[0_12px_16px_rgb(15_23_42_/_0.12)] sm:h-52 sm:w-44" fill="none">
          <path d="M39 13h64l37 37v128a9 9 0 0 1-9 9H39a9 9 0 0 1-9-9V22a9 9 0 0 1 9-9Z" fill="white" stroke="#D1CFCD" strokeWidth="1.5" />
          <path d="M103 14v28a9 9 0 0 0 9 9h27" fill="#F5F4F2" stroke="#D1CFCD" strokeWidth="1.5" />
          <rect x="48" y="67" width="40" height="17" rx="4" fill="#E9EFFD" />
          <path d="M57 75.5h22" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" />
          <path d="M48 101h71M48 113h56M48 125h66" stroke="#E5E4E1" strokeWidth="4" strokeLinecap="round" />
          <path d="M49 156c7-2 8-12 12-12 4 0 2 16 7 16 4 0 5-18 9-18 3 0 3 9 8 9 3 0 5-3 8-4" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M48 165h56" stroke="#D1CFCD" strokeWidth="1.5" />
          <circle cx="132" cy="153" r="20" fill="#E9F6F3" stroke="white" strokeWidth="4" />
          <path d="m123 153 6 6 12-13" stroke="#18866A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="absolute bottom-1 left-0 rounded-lg border bg-card px-3 py-2 shadow-raised">
          <span className="flex items-center gap-2 text-meta font-medium text-foreground"><span className="size-2 rounded-full bg-success-dot" />PDF workflow</span>
        </div>
      </div>

      <div className="min-w-0 text-center sm:text-left">
        <p className="text-meta font-medium text-primary">GFS CONTRACT AGENT</p>
        <h1 className="mt-2 text-page text-[24px]">Your documents, at a glance</h1>
        <p className="mx-auto mt-2 max-w-md text-dense text-muted-foreground sm:mx-0">
          Choose a document to review its signing progress and next step.
        </p>

        <div className="mt-6 grid grid-cols-3 divide-x rounded-lg border bg-card py-3 text-left">
          {[
            { folder: "attention", label: "Needs attention", value: counts.attention, tone: counts.attention ? "text-warning" : "text-foreground" },
            { folder: "processing", label: "Processing", value: counts.processing, tone: "text-foreground" },
            { folder: "draft", label: "Drafts", value: counts.draft, tone: "text-foreground" },
          ].map((item) => (
            <Link key={item.label} href={`/?folder=${item.folder}`} className="min-w-0 rounded-sm px-2.5 outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/40 sm:px-4">
              <p className={`tnum text-xl font-semibold leading-6 ${item.tone}`}>{item.value}</p>
              <p className="mt-1 text-meta leading-4 text-muted-foreground">{item.label}</p>
            </Link>
          ))}
        </div>

        {!image && counts.attention > 0 && (
          <div className="mt-4 flex items-center gap-3 rounded-md border bg-primary/[0.04] px-4 py-3 text-left">
            <PenLine className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-dense">Upload your signature image so documents can be signed.</p>
            <Button size="sm" asChild>
              <Link href="/settings#signature">Upload</Link>
            </Button>
          </div>
        )}
        {!counts.all && (
          <p className="mt-4 text-dense text-muted-foreground">PDF attachments from Outlook will appear here as they arrive.</p>
        )}
        <p className="mt-5 flex flex-wrap items-center justify-center gap-1.5 text-meta text-muted-foreground sm:justify-start">
          <Keyboard className="size-3.5" aria-hidden="true" />
          <kbd className="rounded-sm border px-1">↑</kbd><kbd className="rounded-sm border px-1">↓</kbd> browse documents
          <span className="mx-1 text-border-strong">·</span><kbd className="rounded-sm border px-1">/</kbd> search
        </p>
      </div>
    </div>
  );
}

export default function InboxPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-secondary/30 p-6 sm:p-8">
      <Suspense fallback={null}>
        <Overview />
      </Suspense>
    </div>
  );
}
