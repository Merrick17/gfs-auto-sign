"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { removeSignatureAction, uploadSignatureAction } from "@/actions";
import { ImageOff, LoaderCircle, Upload } from "@/components/icons";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PrepareError, checkFile, loadPixels, prepareSignature, type Prepared } from "@/lib/client/prepare-image";

function Paper({ src, label }: { src: string | null; label: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="relative flex h-36 items-center justify-center rounded-sm border bg-white px-6">
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={label} className="max-h-24 max-w-full object-contain" onError={() => setBroken(true)} />
      ) : (
        <span className="flex flex-col items-center gap-2 text-dense text-muted-foreground">
          <ImageOff className="size-5 text-subtle" aria-hidden="true" />
          {src ? "Your signature couldn't be loaded from OneDrive." : "No signature yet"}
        </span>
      )}
      <span aria-hidden="true" className="absolute inset-x-6 bottom-7 border-b border-dashed border-border-strong" />
    </div>
  );
}

// Upload, preview and replace the signature image. The file is stored in the owner's OneDrive.
export function SignatureCard({ current }: { current: { version: number; fileName: string; uploadedAt: string } | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<ImageData | null>(null);
  const [transparent, setTransparent] = useState(true);
  const [prepared, setPrepared] = useState<(Prepared & { url: string; name: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const name = useRef("signature.png");

  // Re-prepares the preview whenever the background option changes.
  useEffect(() => {
    if (!source) return;
    let url: string | null = null;
    let cancelled = false;
    prepareSignature(source, { transparent })
      .then((p) => {
        if (cancelled) return;
        url = URL.createObjectURL(p.blob);
        setPrepared({ ...p, url, name: name.current });
        setError(null);
      })
      .catch((e) => !cancelled && setError(e instanceof PrepareError ? e.message : "That image couldn't be prepared."));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, transparent]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const problem = checkFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    try {
      name.current = file.name.replace(/\.[^.]+$/, "") + ".png";
      setSource(await loadPixels(file));
    } catch (e) {
      setError(e instanceof PrepareError ? e.message : "That image couldn't be read.");
    }
  };

  const cancel = () => {
    setSource(null);
    setPrepared(null);
    setError(null);
    if (input.current) input.current.value = "";
  };

  const save = () =>
    start(async () => {
      if (!prepared) return;
      const form = new FormData();
      form.set("image", new File([prepared.blob], prepared.name, { type: "image/png" }));
      const r = await uploadSignatureAction(form);
      if (r.ok) {
        toast.success(r.message);
        cancel();
        router.refresh();
      } else setError(r.message);
    });

  const remove = () =>
    start(async () => {
      const r = await removeSignatureAction();
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      {prepared ? (
        <>
          <Paper src={prepared.url} label="New signature preview" />
          <label className="flex cursor-pointer items-center gap-2 text-dense">
            <Checkbox checked={transparent} onCheckedChange={(v) => setTransparent(v === true)} />
            Remove the paper background
          </label>
        </>
      ) : (
        <Paper src={current ? `/api/signature?v=${current.version}` : null} label="Your signature" />
      )}

      {error && (
        <p role="alert" className="text-dense text-destructive">
          {error}
        </p>
      )}

      <input ref={input} type="file" accept="image/png,image/jpeg" className="sr-only" tabIndex={-1} onChange={(e) => void pick(e.target.files?.[0])} />
      <div className="flex flex-wrap items-center gap-2">
        {prepared ? (
          <>
            <Button onClick={save} disabled={pending}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Save to OneDrive
            </Button>
            <Button variant="outline" onClick={cancel} disabled={pending}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button variant={current ? "outline" : "default"} onClick={() => input.current?.click()}>
              <Upload aria-hidden="true" />
              {current ? "Replace" : "Upload signature"}
            </Button>
            {current && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={pending}>
                    Remove
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove your signature?</AlertDialogTitle>
                    <AlertDialogDescription>Documents will wait for you until you upload a new one. Documents already signed keep their signature.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={remove}>Remove</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </>
        )}
        <span className="ml-auto text-meta text-muted-foreground">PNG or JPG. A photo of your signature on white paper works.</span>
      </div>
    </div>
  );
}
