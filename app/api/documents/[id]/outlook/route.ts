import { auth } from "@/auth";
import { draftLink } from "@/lib/drafts";

// Opens the saved draft in Outlook on the web. The link comes from Microsoft Graph, never from user input.
export async function GET(req: Request, ctx: RouteContext<"/api/documents/[id]/outlook">) {
  if (!(await auth())?.user) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  let link: string | null = null;
  try {
    link = await draftLink(id);
  } catch {
    link = null;
  }
  if (!link || !/^https:\/\/([a-z0-9-]+\.)*(office\.com|office365\.com|outlook\.com|microsoft\.com|cloud\.microsoft)\//i.test(link))
    return Response.redirect(new URL(`/documents/${id}?outlook=missing`, req.url), 302);
  return Response.redirect(link, 302);
}
