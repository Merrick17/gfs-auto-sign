"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { disconnectAction, saveDraftSettingsAction, setAutoSignAction, suggestRecipientsAction } from "@/actions";
import { LoaderCircle } from "@/components/icons";
import { RecipientInput } from "@/components/rules/suggest-input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message: string }>, done?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.message);
        done?.();
      } else toast.error(r.message);
      router.refresh();
    });
  return { pending, run };
}

// Turning this on is the owner's standing authorization. Without it, every document waits for approval.
export function AutoSignSwitch({ on, authorizedAt, hasImage }: { on: boolean; authorizedAt: string | null; hasImage: boolean }) {
  const { pending, run } = useAction();
  const [asking, setAsking] = useState(false);
  const [consent, setConsent] = useState(false);
  return (
    <>
      <div className="flex items-start gap-3">
        <Switch
          checked={on}
          disabled={pending}
          aria-label="Automatic signing"
          onCheckedChange={(v) => {
            if (v) {
              setConsent(false);
              setAsking(true);
            } else run(() => setAutoSignAction(false, false));
          }}
          className="mt-0.5"
        />
        <div>
          <p className="text-dense font-medium">{on ? "On for the senders you allow" : "Off: every document waits for your approval"}</p>
          <p className="mt-0.5 text-meta text-muted-foreground">
            {on && authorizedAt
              ? `Authorized on ${new Date(authorizedAt).toLocaleString()}. `
              : ""}
            Only senders with “Sign automatically” in their rule, and only when the signature position is certain. Anything else waits for you.
            {!hasImage && " Upload your signature first."}
          </p>
        </div>
      </div>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-section">Turn on automatic signing?</DialogTitle>
            <DialogDescription className="text-dense">
              Your signature image will be placed on documents from senders you mark “Sign automatically”, without asking you each time. It is an image of your signature, not a certificate-based digital signature. Drafts are still only saved, never sent.
            </DialogDescription>
          </DialogHeader>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-sm border p-3 text-dense">
            <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />I authorize GFS Contract Agent to add my signature to those documents on my behalf.
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button disabled={!consent || pending} onClick={() => run(() => setAutoSignAction(true, consent), () => setAsking(false))}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Turn on
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DraftPreferences({ message: initialMessage, cc: initialCc, placeholder }: { message: string; cc: string[]; placeholder: string }) {
  const { pending, run } = useAction();
  const [message, setMessage] = useState(initialMessage);
  const [cc, setCc] = useState(initialCc);
  const dirty = message !== initialMessage || cc.join() !== initialCc.join();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor="draft-message" className="mb-1.5 block text-dense font-medium">
          Email message
        </label>
        <Textarea id="draft-message" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={placeholder} className="min-h-28" maxLength={4000} />
        <p className="mt-1 text-meta text-muted-foreground">Written above the quoted original email. Leave empty to use the text shown.</p>
      </div>
      <div>
        <label className="mb-1.5 block text-dense font-medium">Always CC</label>
        <RecipientInput label="Always CC" value={cc} onChange={setCc} load={(q, exclude) => suggestRecipientsAction({ query: q, role: "cc", exclude })} placeholder="Nobody" />
        <p className="mt-1 text-meta text-muted-foreground">Added to every draft, on top of the sender rule&apos;s CC.</p>
      </div>
      <div>
        <Button onClick={() => run(() => saveDraftSettingsAction({ message, cc }))} disabled={!dirty || pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          Save preferences
        </Button>
      </div>
    </div>
  );
}

export function DisconnectButton() {
  const { pending, run } = useAction();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={pending}>
          Disconnect
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect Microsoft 365?</AlertDialogTitle>
          <AlertDialogDescription>New emails stop being processed until you reconnect. Documents, signed copies and drafts already saved stay where they are.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => run(() => disconnectAction())}>Disconnect</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
