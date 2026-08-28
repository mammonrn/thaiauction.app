import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Optimistic route protection.
 *
 * Next.js renamed `middleware.ts` to `proxy.ts`, and its docs are explicit that
 * this layer "should not be used as a full session management or authorization
 * solution" — it may run at the network edge, away from the database.
 *
 * So this only checks whether a session cookie is *present*, purely to bounce
 * signed-out visitors to /login without paying for a render. It does not verify
 * the cookie. Anyone can forge one; the real check is `requireSession()` in
 * lib/session.ts, which validates against the database inside the page itself.
 */
const PROTECTED_ROUTES = [
  // Reserved for the "list an item for auction" flow in the next phase.
  "/sell",
  "/account",
  // Admin pages call requireAdmin() themselves; this only avoids rendering
  // them for a visitor with no session at all.
  "/admin",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  if (!isProtected) {
    return NextResponse.next();
  }

  // Cheap, synchronous, no database access.
  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Skip Next internals, the auth endpoints themselves, and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
