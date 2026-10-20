"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteRuleAction, originalParticipantsAction, saveRuleAction, suggestRecipientsAction, suggestSendersAction } from "@/actions";
import { LoaderCircle, Plus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { RecipientInput, SenderInput, type Option } from "./suggest-input";

export type RuleValue = { id: string; sender: string; to: string[]; cc: string[]; autoSign: boolean };

type Participants = Awaited<ReturnType<typeof originalParticipantsAction>>;

// Merges the people on the original email (when opened from a document) ahead of the mailbox suggestions.
function withOriginal(original: Participants, role: "to" | "cc", rest: Option[], q: string, exclude: string[]): Option[] {
  if (!original) return rest;
  const people = role === "to" ? [...(original.from ? [original.from] : []), ...original.to] : [...original.cc, ...original.to];
  const ql = q.toLowerCase();
  const first = people
    .filter((p) => !exclude.includes(p.email) && (!ql || p.email.includes(ql) || p.name.toLowerCase().includes(ql)))
    .map((p) => ({ ...p, reason: original.from?.email === p.email ? "Sent this email" : role === "cc" && original.cc.some((c) => c.email === p.email) ? "Copied on this email" : "On this email" }));
  const seen = new Set(first.map((f) => f.email));
  return [...first, ...rest.filter((r) => !seen.has(r.email))];
}

export function RuleDialog({ sender: fixedSender, rule, documentId, trigger }: { sender?: string; rule: RuleValue | null; documentId?: string; trigger: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sender, setSender] = useState(rule?.sender ?? fixedSender ?? "");
  const [to, setTo] = useState<string[]>(rule?.to ?? []);
  const [cc, setCc] = useState<string[]>(rule?.cc ?? []);
  const [autoSign, setAutoSign] = useState(rule?.autoSign ?? false);
  const [error, setError] = useState<string | null>(null);
  const [original, setOriginal] = useState<Participants>(null);
  const [pending, start] = useTransition();

  const reset = () => {
    setSender(rule?.sender ?? fixedSender ?? "");
    setTo(rule?.to ?? []);
    setCc(rule?.cc ?? []);
    setAutoSign(rule?.autoSign ?? false);
    setError(null);
  };

  const domain = fixedSender?.includes("@") ? `@${fixedSender.split("@")[1]}` : null;
  const lookupSender = sender.trim() || fixedSender || "";
  const load = (role: "to" | "cc") => async (q: string, exclude: string[]) =>
    withOriginal(original, role, await suggestRecipientsAction({ sender: lookupSender || undefined, query: q, role, exclude }), q, exclude);

  const save = () =>
    start(async () => {
      const r = await saveRuleAction({ sender, to, cc, autoSign }, rule?.id);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      toast.success(r.message);
      setOpen(false);
      router.refresh();
    });

  const remove = () =>
    start(async () => {
      if (!rule) return;
      const r = await deleteRuleAction(rule.id);
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
        router.refresh();
      } else toast.error(r.message);
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          reset();
          if (documentId && !original) void originalParticipantsAction(documentId).then(setOriginal);
        }
      }}
    >
      <DialogTrigger asChild>
        {rule || fixedSender ? (
          <Button variant="ghost" size="xs" className="text-primary hover:text-primary">
            {trigger}
          </Button>
        ) : (
          <Button size="sm">
            <Plus aria-hidden="true" />
            {trigger}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-section">{rule ? "Edit sender rule" : "New sender rule"}</DialogTitle>
          <DialogDescription className="text-dense">Who receives the Outlook draft when a document comes from this sender.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-dense font-medium">Sender</label>
            {fixedSender && !rule ? (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-sm bg-secondary p-0.5" role="radiogroup" aria-label="Applies to">
                  {[fixedSender, domain].filter((v): v is string => Boolean(v)).map((v) => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={sender === v}
                      onClick={() => setSender(v)}
                      className={`h-7 max-w-[220px] truncate rounded-[3px] px-2.5 text-meta font-medium ${sender === v ? "bg-card text-foreground shadow-xs" : "text-muted-foreground"}`}
                    >
                      {v === domain ? `Everyone at ${v.slice(1)}` : v}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <SenderInput value={sender} onChange={(v) => { setSender(v); setError(null); }} load={(q) => suggestSendersAction(q)} />
            )}
            <p className="mt-1 text-meta text-muted-foreground">An address applies to that person; a domain applies to everyone there. An address rule wins over its domain.</p>
          </div>

          <div>
            <label className="mb-1.5 block text-dense font-medium">To</label>
            <RecipientInput label="To" value={to} onChange={setTo} load={load("to")} placeholder="Reply to the sender" />
            <p className="mt-1 text-meta text-muted-foreground">Leave empty to reply to whoever sent the document.</p>
          </div>

          <div>
            <label className="mb-1.5 block text-dense font-medium">CC</label>
            <RecipientInput label="CC" value={cc} onChange={setCc} load={load("cc")} placeholder="Add people to copy" />
            <p className="mt-1 text-meta text-muted-foreground">Suggestions come from your mailbox: who you usually copy when writing to this sender.</p>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-sm border p-3">
            <Switch checked={autoSign} onCheckedChange={setAutoSign} className="mt-0.5" aria-label="Sign automatically" />
            <span>
              <span className="block text-dense font-medium">Sign automatically</span>
              <span className="block text-meta text-muted-foreground">
                Documents from this sender are signed without asking when the signature position is certain. Needs automatic signing turned on in Settings.
              </span>
            </span>
          </label>

          {error && (
            <p role="alert" className="text-dense text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {rule ? (
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={remove} disabled={pending}>
              Delete rule
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !sender.trim()}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Save rule
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
