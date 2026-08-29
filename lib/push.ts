import "server-only";

import webpush from "web-push";

import { prisma } from "@/lib/prisma";

/**
 * Web Push delivery.
 *
 * VAPID keys live only in the environment. Generate a pair with:
 *
 *   npx web-push generate-vapid-keys
 *
 * and put the two halves in NEXT_PUBLIC_VAPID_PUBLIC_KEY and
 * VAPID_PRIVATE_KEY. The public half is deliberately NEXT_PUBLIC_: the browser
 * has to pass it to `pushManager.subscribe`, and it is a public key — the
 * private half never leaves the server.
 *
 * Every send here is best-effort. Nothing in this file may make a bid or a
 * payment fail: the notification row is already written before any of this
 * runs, and the bell shows it whether or not a push service was reachable.
 */

function vapidConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT,
  );
}

/**
 * Configured lazily, on the first send.
 *
 * `webpush.setVapidDetails` throws on a malformed key, and doing that at
 * import time would take the whole app down over a misconfigured optional
 * feature — the site works perfectly well with the bell alone.
 */
let configured = false;
function configure(): boolean {
  if (configured) return true;
  if (!vapidConfigured()) return false;

  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!,
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    configured = true;
    return true;
  } catch (error) {
    console.error("[push] VAPID keys are not usable:", error);
    return false;
  }
}

export type PushPayload = {
  title: string;
  body: string;
  /** In-app path. The service worker opens or focuses a tab here. */
  url: string;
};

/**
 * Push one payload to every device this person has registered.
 *
 * Sends to all of them in parallel — a seller with a phone and a desktop
 * should hear it on both — and prunes the ones the push service says are gone.
 *
 * 404 and 410 are the push service saying this endpoint no longer exists: the
 * browser was reinstalled, site data was cleared, or permission was revoked.
 * Only those two delete the row. Anything else (a 500, a timeout) is the
 * service having a bad day, and deleting a live subscription over it would
 * silence someone permanently for a transient fault.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; pruned: number }> {
  if (!configure()) return { sent: 0, pruned: 0 };

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  if (subscriptions.length === 0) return { sent: 0, pruned: 0 };

  const body = JSON.stringify(payload);
  const dead: string[] = [];
  let sent = 0;

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          body,
        );
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          dead.push(subscription.id);
        } else {
          console.error(`[push] send failed (${status ?? "no status"}):`, error);
        }
      }
    }),
  );

  if (dead.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: dead } } });
  }

  if (sent > 0) {
    await prisma.pushSubscription.updateMany({
      where: { userId, id: { notIn: dead } },
      data: { lastUsedAt: new Date() },
    });
  }

  return { sent, pruned: dead.length };
}

/**
 * Register a browser for push.
 *
 * Keyed on the endpoint, which is the address the push service routes on: the
 * same browser re-subscribing produces the same endpoint, so an upsert keeps
 * one row per device rather than accumulating duplicates that would each
 * deliver the same notification.
 *
 * The userId is overwritten on conflict deliberately — a shared computer where
 * a second person signs in should push to whoever is signed in now, not to
 * whoever registered the browser first.
 */
export async function saveSubscription(params: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<void> {
  await prisma.pushSubscription.upsert({
    where: { endpoint: params.endpoint },
    create: {
      userId: params.userId,
      endpoint: params.endpoint,
      p256dh: params.p256dh,
      auth: params.auth,
    },
    update: {
      userId: params.userId,
      p256dh: params.p256dh,
      auth: params.auth,
      lastUsedAt: new Date(),
    },
  });
}

/**
 * Forget a browser.
 *
 * Scoped to the owner so one account cannot unsubscribe another's device by
 * submitting its endpoint.
 */
export async function removeSubscription(
  userId: string,
  endpoint: string,
): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

/** Whether this deployment can push at all. Decides what the toggle offers. */
export function pushAvailable(): boolean {
  return vapidConfigured();
}
