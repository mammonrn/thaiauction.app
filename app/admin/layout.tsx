import { AdminNav } from "@/components/admin-nav";
import { isCurrentUserAdmin } from "@/lib/admin";

/**
 * The admin shell.
 *
 * PRESENTATION ONLY. Every page under /admin still calls `requireAdmin` for
 * itself, exactly as it did before this file existed, and that has to stay
 * that way: a layout does not re-render on navigation, so a check moved up
 * here would be made once and then trusted for every later page in the same
 * session. Next's own authentication guide says it in as many words — "be
 * cautious when doing checks in Layouts as these don't re-render on
 * navigation" — and adds that a layout cannot stop the segments below it from
 * rendering anyway.
 *
 * The `isCurrentUserAdmin` call below is therefore NOT a guard and nothing
 * depends on it being right. It decides whether to draw the chrome, so that a
 * stranger who guesses the path still gets a bare 404 and learns neither that
 * an admin area exists nor what is in it — the property lib/admin.ts describes,
 * which a sidebar wrapped around the 404 page would have quietly given away.
 * If it were ever stale in the permissive direction the visitor would see a
 * menu around a 404 and reach nothing; in the other direction, an admin sees
 * their tools unstyled. Neither is a way in.
 *
 * It reads the session and nothing else. The menu is labels and paths, so the
 * shell runs no query on any admin page — the counts stay on the index, which
 * is a page and does re-render.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const admin = await isCurrentUserAdmin();
  if (!admin) return children;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col sm:flex-row">
      <AdminNav />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
