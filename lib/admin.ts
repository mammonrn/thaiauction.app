import "server-only";

import { notFound } from "next/navigation";

import { getSession, requireSession } from "@/lib/session";

/**
 * Who is an administrator.
 *
 * Read from ADMIN_EMAILS rather than a column on `users`, deliberately: admin
 * rights then live outside the database, so someone who gains write access to
 * PostgreSQL still cannot make themselves an admin and read other people's ID
 * cards. Changing the list means editing .env and restarting, which for a
 * single owner is a fair trade for that property.
 *
 * Moving to a role column later is easy — only this file decides.
 */
function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;

  const list = adminEmails();
  // An unset or empty ADMIN_EMAILS must grant nobody, never everybody.
  if (list.length === 0) return false;

  return list.includes(email.trim().toLowerCase());
}

/** True when the current visitor is an administrator. */
export async function isCurrentUserAdmin(): Promise<boolean> {
  const session = await getSession();
  // Better Auth only issues a session after the email is confirmed as the
  // account's own, so matching on it is safe here.
  return isAdminEmail(session?.user.email);
}

/**
 * Require an administrator.
 *
 * A signed-in non-admin gets a 404 rather than a 403: there is no reason to
 * confirm to a stranger that an admin area exists at this path.
 */
export async function requireAdmin(returnTo: string) {
  const session = await requireSession(returnTo);

  if (!isAdminEmail(session.user.email)) {
    notFound();
  }

  return session;
}
