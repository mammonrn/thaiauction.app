import { AccountSidebar } from "@/components/account-sidebar";
import { requireSession } from "@/lib/session";
import { unreadNotificationCount } from "@/lib/notifications";
import { unpaidWinCount } from "@/lib/unpaid";

/**
 * The account shell.
 *
 * Puts the sidebar beside every /account page instead of repeating a nav on
 * each one. The session is already required by each page; requiring it here
 * too costs nothing — `getSession` is wrapped in React's `cache`, so the whole
 * render shares one lookup.
 */
export default async function AccountLayout({
  children,
}: LayoutProps<"/account">) {
  const { user } = await requireSession("/account");
  const unpaidWins = await unpaidWinCount(user.id);
  const unreadNotifications = await unreadNotificationCount(user.id);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <AccountSidebar
        name={user.name}
        email={user.email}
        unpaidWins={unpaidWins}
        unreadNotifications={unreadNotifications}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
