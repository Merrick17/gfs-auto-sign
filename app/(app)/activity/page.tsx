import type { Metadata } from "next";
import { Suspense } from "react";
import { RunList } from "@/components/activity/run-list";
import { Activity as ActivityIcon, SearchIcon } from "@/components/icons";
import { Pagination, SearchAndSort, Tabs } from "@/components/list-controls";
import { AutoRefresh } from "@/components/shell/auto-refresh";
import { PageHeader } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ACTIVITY_FILTERS, ACTIVITY_LABEL, PAGE_SIZE, activity, hasRunning, parseListParams } from "@/lib/views";

export const metadata: Metadata = { title: "Activity" };

async function ActivityContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = parseListParams(await searchParams, ACTIVITY_FILTERS);
  const [data, running] = await Promise.all([activity(params), hasRunning()]);
  return (
    <>
      <AutoRefresh active={running} />
      <PageHeader title="Activity" below={<Tabs current={params.status} items={ACTIVITY_FILTERS.map((f) => ({ value: f, label: ACTIVITY_LABEL[f] }))} />} />
      <section className="mx-auto w-full max-w-[1280px]">
        <div className="border-b px-5 py-2.5">
          <SearchAndSort placeholder="Search runs" sortLabels={{ newest: "Latest first", oldest: "Oldest first" }} />
        </div>
        <div className="hidden h-9 grid-cols-[16px_150px_minmax(0,1.6fr)_minmax(0,1fr)_72px_80px] items-center gap-x-3 border-b bg-secondary/50 px-5 text-meta font-medium text-muted-foreground md:grid" aria-hidden="true">
          <span />
          <span>Status</span>
          <span>Document</span>
          <span>Sender</span>
          <span className="text-right">Duration</span>
          <span className="text-right">Updated</span>
        </div>
        {data.rows.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center bg-secondary/20 px-6 py-16 text-center">
            {params.q ? <SearchIcon className="size-5 text-subtle" aria-hidden="true" /> : <ActivityIcon className="size-5 text-subtle" aria-hidden="true" />}
            <p className="mt-3 text-[14px] font-medium">{params.q ? "No runs match your search" : "No runs yet"}</p>
            <p className="mt-1 max-w-sm text-dense text-muted-foreground">Every document that arrives by email gets a run here: received, ingested, signed, draft saved.</p>
          </div>
        ) : (
          <RunList runs={data.rows} />
        )}
        <div className="border-t">
          <Pagination page={params.page} pageSize={PAGE_SIZE} total={data.total} />
        </div>
      </section>
    </>
  );
}

function ActivitySkeleton() {
  return (
    <>
      <PageHeader title="Activity" below={<div className="h-10" />} />
      <div role="status" aria-label="Loading activity">
        <div className="border-b px-5 py-2.5">
          <Skeleton className="h-8 w-80 max-w-full" />
        </div>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex h-12 items-center gap-4 border-b px-4 last:border-b-0">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
      </div>
    </>
  );
}

export default function ActivityPage(props: PageProps<"/activity">) {
  return (
    <Suspense fallback={<ActivitySkeleton />}>
      <ActivityContent searchParams={props.searchParams} />
    </Suspense>
  );
}
