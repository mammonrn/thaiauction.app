import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_MAX_AGE,
  referralCookieUpdate,
} from "@/lib/referral-code";

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

  /**
   * Remember who invited this visitor.
   *
   * Here rather than on a landing page, because an invite link is allowed to
   * point anywhere: someone shares the listing they are excited about, not the
   * home page, and `?ref=` has to work on whichever page that is. This layer
   * sees all of them.
   *
   * It stays a string decision with no database in it, which is the rule this
   * file already lives by — the code is only looked up later, at sign-up, on
   * the server. An invented one is written to a cookie and then never matches
   * anything, which costs nobody anything.
   */
  const referral = referralCookieUpdate(
    request.nextUrl,
    request.cookies.get(REFERRAL_COOKIE)?.value,
  );

  const withReferral = <T extends NextResponse>(response: T): T => {
    if (referral) {
      response.cookies.set(REFERRAL_COOKIE, referral, {
        maxAge: REFERRAL_COOKIE_MAX_AGE,
        path: "/",
        sameSite: "lax",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
      });
    }
    return response;
  };

  const isProtected = PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  if (!isProtected) {
    return withReferral(NextResponse.next());
  }

  // Cheap, synchronous, no database access.
  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirectTo", pathname);
    // The cookie rides along on the redirect too: a link to a signed-in page
    // is still an invite, and the credit must survive the trip to /login.
    return withReferral(NextResponse.redirect(loginUrl));
  }

  return withReferral(NextResponse.next());
}

export const config = {
  // Skip Next internals, the auth endpoints themselves, and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
