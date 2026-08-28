import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "@/lib/auth";

export type AppSession = Awaited<ReturnType<typeof auth.api.getSession>>;

/**
 * Read the current session, or null when signed out.
 *
 * This is the authoritative check: it validates the session token against the
 * `sessions` table on every call, so a revoked or expired session is rejected
 * immediately. `proxy.ts` only does a cheap optimistic cookie check, which is
 * explicitly NOT a security boundary — this is.
 *
 * Wrapped in React's `cache` so several Server Components in one render share
 * a single database round-trip.
 */
export const getSession = cache(async (): Promise<AppSession> => {
  return auth.api.getSession({ headers: await headers() });
});

/**
 * Require a signed-in user, or redirect to /login.
 *
 * Use this at the top of any protected page or Server Action — for example the
 * upcoming "list an item for auction" page:
 *
 *   const { user } = await requireSession("/sell");
 *
 * `redirectTo` is where the user is sent back to after signing in.
 */
export async function requireSession(redirectTo?: string) {
  const session = await getSession();

  if (!session) {
    const target = redirectTo
      ? `/login?redirectTo=${encodeURIComponent(redirectTo)}`
      : "/login";
    redirect(target);
  }

  return session;
}
