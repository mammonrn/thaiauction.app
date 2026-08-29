import Link from "next/link";

import { NotificationList } from "@/components/notification-list";
import { listNotifications, NOTIFICATION_MAX_AGE_DAYS } from "@/lib/notifications";
import { btnSecondarySm } from "@/lib/button";
import { requireSession } from "@/lib/session";
import { formatThaiDateTime } from "@/lib/thai-datetime";

export const metadata = { title: "การแจ้งเตือน" };

/**
 * The bell's own page.
 *
 * Paged rather than loading everything: an active bidder accumulates these
 * quickly, and the useful ones are always at the top.
 */
export default async function NotificationsPage({
  searchParams,
}: PageProps<"/account/notifications">) {
  const { user } = await requireSession("/account/notifications");
  const requested = Number((await searchParams).page ?? "1");
  const { items, hasMore, page } = await listNotifications(
    user.id,
    Number.isFinite(requested) ? requested : 1,
  );

  return (
    <main className="flex w-full flex-1 flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">การแจ้งเตือน</h1>
      </header>

      {items.length === 0 ? (
        <p className="text-sm text-ink/60">
          {page === 1
            ? "ยังไม่มีการแจ้งเตือน"
            : "ไม่มีการแจ้งเตือนในหน้านี้"}
        </p>
      ) : (
        <NotificationList
          items={items.map((item) => ({
            id: item.id,
            title: item.title,
            body: item.body,
            url: item.url,
            unread: item.readAt === null,
            when: formatThaiDateTime(item.createdAt),
          }))}
        />
      )}

      <div className="flex items-center justify-between gap-2">
        {page > 1 ? (
          <Link
            href={`/account/notifications?page=${page - 1}`}
            className={btnSecondarySm}
          >
            ← ใหม่กว่า
          </Link>
        ) : (
          <span />
        )}
        {hasMore ? (
          <Link
            href={`/account/notifications?page=${page + 1}`}
            className={btnSecondarySm}
          >
            เก่ากว่า →
          </Link>
        ) : null}
      </div>

      <p className="text-xs text-ink/45">
        เก็บย้อนหลัง {NOTIFICATION_MAX_AGE_DAYS} วัน
      </p>
    </main>
  );
}
