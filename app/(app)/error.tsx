"use client";

import { TriangleAlert } from "@/components/icons";
import { Button } from "@/components/ui/button";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <TriangleAlert className="size-5 text-warning" aria-hidden="true" />
      <p className="mt-3 text-[14px] font-medium">This page couldn&apos;t be loaded</p>
      <p className="mt-1 max-w-sm text-dense text-muted-foreground">Nothing was changed. Try again in a moment.</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
