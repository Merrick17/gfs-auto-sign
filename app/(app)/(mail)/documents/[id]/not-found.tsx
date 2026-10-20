import Link from "next/link";
import { FileX2 } from "@/components/icons";
import { Button } from "@/components/ui/button";

export default function DocumentNotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <FileX2 className="size-5 text-subtle" aria-hidden="true" />
      <p className="mt-3 text-[14px] font-medium">This document doesn&apos;t exist</p>
      <p className="mt-1 text-dense text-muted-foreground">It may have been opened from an old link.</p>
      <Button variant="outline" size="sm" className="mt-4" asChild>
        <Link href="/">Back to Inbox</Link>
      </Button>
    </div>
  );
}
