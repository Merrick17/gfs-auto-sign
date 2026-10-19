import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { downloadFile } from "@/lib/sharepoint";

export async function GET(req: Request, ctx: RouteContext<"/api/contracts/[id]/document">) {
  if (!(await auth())?.user) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const kind = new URL(req.url).searchParams.get("kind") === "SIGNED" ? "SIGNED" : "ORIGINAL";
  const ref = await getDb().documentRef.findUnique({ where: { contractId_kind: { contractId: id, kind } } });
  if (!ref) return new Response("Not found", { status: 404 });
  const bytes = await downloadFile(ref, ref.sha256);
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
