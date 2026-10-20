import { Suspense } from "react";
import { MailList } from "@/components/mail/mail-list";
import { MailSplit } from "@/components/mail/mail-split";
import { Skeleton } from "@/components/ui/skeleton";

function ListFallback() {
  return (
    <div className="w-full shrink-0 border-r lg:w-[400px]" role="status" aria-label="Loading documents">
      <div className="flex h-[52px] items-center border-b px-4">
        <Skeleton className="h-4 w-24" />
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="space-y-2 border-b px-8 py-3">
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}

// The mail view: the document list stays in place while documents open beside it in the reading pane.
export default function MailLayout({ children }: LayoutProps<"/">) {
  return (
    <MailSplit
      list={
        <Suspense fallback={<ListFallback />}>
          <MailList />
        </Suspense>
      }
    >
      {children}
    </MailSplit>
  );
}
