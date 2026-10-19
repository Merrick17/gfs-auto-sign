import { auth } from "@/auth";
import { getActiveSignatureImage, readSignatureImage } from "@/lib/signature-image";

// Streams the active signature image from the owner's private OneDrive. Never cached, never public.
export async function GET() {
  if (!(await auth())?.user) return new Response("Unauthorized", { status: 401 });
  const img = await getActiveSignatureImage();
  if (!img) return new Response("Not found", { status: 404 });
  try {
    const bytes = await readSignatureImage(img);
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Signature-Version": String(img.version) },
    });
  } catch {
    return new Response("Signature unavailable", { status: 502 });
  }
}
