/**
 * Push only. Deliberately not a caching service worker.
 *
 * The manifest's own note explains why this app had none: a cache that serves
 * a stale auction price is actively harmful, and offline use is not a goal.
 * That reasoning still holds — so this file adds the one capability that
 * genuinely requires a worker and nothing else. There is no `fetch` handler at
 * all, which means every request goes to the network exactly as it would
 * without a worker, and a deploy can never be shadowed by a stale cache.
 *
 * Registered from the account page, not the root layout, so a visitor who
 * never asks for notifications never installs one.
 */

// Take over as soon as a new version is installed, rather than waiting for
// every tab to close. With no cached responses there is nothing for a version
// change to be inconsistent with, so the usual caution does not apply.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    // A push that is not our JSON is not ours to render.
    return;
  }

  const title = payload.title || "ThaiAuction";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // The url rides along so the click handler knows where to go without
      // having to parse the body.
      data: { url: payload.url || "/" },
      // Collapse repeats about the same thing: a second notification for one
      // auction replaces the first in the tray rather than stacking.
      tag: payload.url || "thaiauction",
      renotify: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = new URL(
    (event.notification.data && event.notification.data.url) || "/",
    self.location.origin,
  );

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Focus a tab already on this site and steer it, rather than opening a
      // second one: someone who taps three notifications should end up with
      // one window, not three.
      for (const client of clientList) {
        if (new URL(client.url).origin === target.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(target.href);
            } catch {
              // Some browsers refuse navigate() on a cross-document client.
              // Focusing is still the useful half.
            }
          }
          return;
        }
      }

      await self.clients.openWindow(target.href);
    })(),
  );
});
