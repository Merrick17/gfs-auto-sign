import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Everything except the sign-in flow and the Graph webhook requires the signed-in owner.
// (The webhook authenticates itself with the subscription clientState.)
export const proxy = auth((req) => {
  if (req.auth?.user) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) return new NextResponse("Unauthorized", { status: 401 });
  return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
});

export const config = {
  matcher: ["/((?!login|brand/|api/auth|api/webhooks/microsoft-graph|_next/static|_next/image|favicon.ico).*)"],
};
