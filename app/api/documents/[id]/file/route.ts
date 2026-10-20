import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { downloadFile } from "@/lib/sharepoint";
import { signedName } from "@/lib/signing";

// Streams the original or the signed PDF from the owner's OneDrive. Never cached, never public.
export async function GET(req: Request, ctx: RouteContext<"/api/documents/[id]/file">) {
  if (!(await auth())?.user) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") === "signed" ? "SIGNED" : "ORIGINAL";
  const db = getDb();
  const [ref, c] = await Promise.all([
    db.documentRef.findUnique({ where: { contractId_kind: { contractId: id, kind } } }),
    db.contract.findUnique({ where: { id }, select: { attachmentName: true } }),
  ]);
  if (!ref || !c) return new Response("Not found", { status: 404 });
  let bytes: Buffer;
  try {
    bytes = await downloadFile(ref, ref.sha256); // refuses a file that changed since it was stored
  } catch {
    return new Response("Document unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  const name = kind === "SIGNED" ? signedName(c.attachmentName) : c.attachmentName;
  const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
