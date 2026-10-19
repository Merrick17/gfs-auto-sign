import { Suspense } from "react";
import { AutomaticSigningSection } from "./_sections/rules";
import { OutlookSection } from "./_sections/outlook";
import { RecipientsSection } from "./_sections/recipients";
import { SignatureSection } from "./_sections/signature";
import { SpendingSection } from "./_sections/spending";

// STUB owned by the Settings agent.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <OutlookSection />
      <SignatureSection />
      <AutomaticSigningSection />
      <RecipientsSection />
      <SpendingSection />
    </Suspense>
  );
}
