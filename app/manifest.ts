import type { MetadataRoute } from "next";

/**
 * Installable to a home screen.
 *
 * `display: standalone` is what makes an installed copy open without browser
 * chrome — the difference between a bookmark and something that feels like an
 * app. `theme_color` is the brand red, so the Android status bar matches the
 * header rather than flashing white on launch.
 *
 * The service worker at /sw.js handles push and NOTHING else — no fetch
 * handler, so nothing is ever served from a cache and a deploy can never be
 * shadowed by a stale one. Offline use is still not a goal, and a cached
 * auction price would still be actively harmful; installability never required
 * a worker, and this one is registered only when someone turns notifications
 * on.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ThaiAuction — ประมูลออนไลน์",
    short_name: "ThaiAuction",
    description:
      "ประมูลพระเครื่อง ของสะสม และสินค้ามือสองจากผู้ขายที่ยืนยันตัวตนแล้ว",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#8b0000",
    lang: "th",
    categories: ["shopping"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
