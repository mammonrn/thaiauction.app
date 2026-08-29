"use client";

import { useRouter } from "next/navigation";
import { useActionState, useTransition } from "react";

import {
  markAllReadAction,
  markReadAction,
  type NotificationActionState,
} from "@/app/account/notifications/actions";
import { btnSecondarySm } from "@/lib/button";

const initialState: NotificationActionState = { ok: false, message: null };

export type NotificationRow = {
  id: string;
  title: string;
  body: string;
  url: string;
  unread: boolean;
  when: string;
};

/**
 * The list, where reading and going somewhere are one gesture.
 *
 * Each row is a button rather than a link, because tapping it does two things
 * — mark read, then navigate — and a link that also fires a Server Action
 * races itself: the navigation can win and the row stay unread.
 *
 * Unread is marked with a brand dot, the same mark the bell and the unpaid-win
 * tab already use, so "something here wants you" looks the same everywhere.
 */
export function NotificationList({ items }: { items: NotificationRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [allState, markAll, markingAll] = useActionState(
    markAllReadAction,
    initialState,
  );

  const anyUnread = items.some((item) => item.unread);

  function open(item: NotificationRow) {
    startTransition(async () => {
      if (item.unread) {
        const data = new FormData();
        data.set("id", item.id);
        await markReadAction(initialState, data);
      }
      router.push(item.url);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {anyUnread ? (
        <form action={markAll} className="self-end">
          <button type="submit" disabled={markingAll} className={btnSecondarySm}>
            {markingAll ? "กำลังบันทึก…" : "อ่านทั้งหมด"}
          </button>
        </form>
      ) : null}

      {allState.message ? (
        <p role="status" className="text-xs text-success">
          {allState.message}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => open(item)}
              disabled={pending}
              className={`flex w-full items-start gap-3 rounded-xl p-4 text-left transition-colors ${
                item.unread ? "bg-white" : "bg-white/60"
              } hover:bg-brand/[.03]`}
            >
              <span
                aria-hidden="true"
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  item.unread ? "bg-brand" : "bg-transparent"
                }`}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={`text-sm ${item.unread ? "font-medium" : "text-ink/70"}`}
                >
                  {item.title}
                  {item.unread ? (
                    <span className="sr-only"> (ยังไม่อ่าน)</span>
                  ) : null}
                </span>
                <span className="text-sm text-ink/60">{item.body}</span>
                <span className="text-xs text-ink/45">{item.when}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
