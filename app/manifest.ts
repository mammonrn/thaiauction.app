import type { MetadataRoute } from "next";

/**
 * Installable to a home screen.
 *
 * `display: standalone` is what makes an installed copy open without browser
 * chrome — the difference between a bookmark and something that feels like an
 * app. `theme_color` is the brand red, so the Android status bar matches the
 * header rather than flashing white on launch.
 *
 * No service worker: offline use is not a goal here, and a cache that serves a
 * stale auction price would be actively harmful. Installability does not
 * require one.
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
