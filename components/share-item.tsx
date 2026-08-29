"use client";

import { useState, useSyncExternalStore } from "react";

import { btnSecondarySm } from "@/lib/button";

/**
 * Share a listing.
 *
 * Two shapes, decided by what the device can do rather than by screen width.
 * Where the Web Share API exists — every current phone browser — one button
 * opens the system sheet, which already knows which apps the person has and
 * puts the ones they use first. Anywhere else, the named services are the
 * fallback, because a desktop browser offers nothing.
 *
 * No Instagram: it has no share-a-link endpoint, and a button that silently
 * did nothing would be worse than its absence.
 *
 * `useSyncExternalStore` rather than an effect, so the server and the first
 * client render agree on "no share sheet" and only then correct themselves —
 * the pattern the payment panel already uses to detect a phone.
 */
function noSubscribe() {
  return () => {};
}

function readCanShare() {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/**
 * This page's own address.
 *
 * Read through the same store as the share-sheet check, not inline in render:
 * the first render happens on the SERVER, where there is no `window`, so an
 * inline read produced an empty string and — with nothing to trigger a second
 * render — the named-service links shipped with `url=` blank. Going through
 * useSyncExternalStore makes the client correct it on hydration.
 */
function readHref() {
  return typeof window === "undefined" ? "" : window.location.href;
}

type Service = {
  key: string;
  label: string;
  href: (url: string, title: string) => string;
  icon: React.ReactNode;
};

/**
 * Each service's own web share endpoint. Plain links, so nothing is loaded
 * from these domains and no SDK watches the page — a share button that ships a
 * tracker to every visitor is a different feature from the one asked for.
 */
const SERVICES: Service[] = [
  {
    key: "line",
    label: "LINE",
    href: (url, title) =>
      `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
    // A squared chat box with a tail, deliberately NOT the round bubble
    // Messenger gets below: at 20px two bubbles are the same icon twice.
    icon: (
      <>
        <rect x="3" y="4" width="18" height="13" rx="3.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8.5 17 7 20.5 12 17" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M8 8.5v4M8 8.5h.01M11.5 12.5v-4l3 4v-4M17 8.5h-1.2v4H17M15.8 10.5h1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  {
    key: "facebook",
    label: "Facebook",
    href: (url) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    icon: (
      <path
        d="M13.5 21v-7.5h2.5l.4-3h-2.9V8.6c0-.9.2-1.5 1.5-1.5H16.6V4.4C16.3 4.4 15.4 4.3 14.3 4.3c-2.2 0-3.8 1.4-3.8 3.9v2.3H8v3h2.5V21"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    ),
  },
  {
    key: "messenger",
    label: "Messenger",
    href: (url) =>
      `https://www.facebook.com/dialog/send?link=${encodeURIComponent(url)}&app_id=0&redirect_uri=${encodeURIComponent(url)}`,
    icon: (
      <>
        <path
          d="M12 3C7 3 3.2 6.7 3.2 11.3c0 2.5 1.2 4.7 3.1 6.2V21l2.9-1.6c.9.2 1.8.4 2.8.4 5 0 8.8-3.7 8.8-8.5S17 3 12 3Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="m7.4 13.7 3.1-3.3 1.9 1.8 2.6-1.9-3.1 3.3-1.9-1.8-2.6 1.9Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </>
    ),
  },
  {
    key: "telegram",
    label: "Telegram",
    href: (url, title) =>
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
    icon: (
      <>
        <path
          d="M21 4.5 2.9 11.3c-.5.2-.5.9 0 1l4.5 1.4L19 6.2 9.6 14.6l-.3 4.6c.4 0 .6-.2.9-.4l2.1-2 4.4 3.2c.5.3 1 .1 1.1-.5L21.6 5.3c.1-.6-.3-1-.6-.8Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </>
    ),
  },
];

export function ShareItem({ title }: { title: string }) {
  const canShare = useSyncExternalStore(noSubscribe, readCanShare, () => false);
  const url = useSyncExternalStore(noSubscribe, readHref, () => "");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused (an insecure origin, a locked-down
      // browser). The named services still work, so this is not worth an alert.
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-black/10 pt-4">
      <span className="text-sm text-ink/60">แชร์</span>

      {canShare ? (
        <button
          type="button"
          onClick={() => {
            void navigator
              .share({ title, url })
              // An abandoned share sheet rejects; that is a choice, not a fault.
              .catch(() => {});
          }}
          className={btnSecondarySm}
        >
          แชร์สินค้านี้
        </button>
      ) : (
        SERVICES.map((service) => (
          <a
            key={service.key}
            href={service.href(url, title)}
            target="_blank"
            // noreferrer as well as noopener: the target keeps window.opener
            // otherwise, and the referrer tells them nothing they need.
            rel="noopener noreferrer"
            aria-label={`แชร์ไปยัง ${service.label}`}
            title={service.label}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-black/15 text-ink/70 transition-colors hover:border-brand/40 hover:text-brand"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
              {service.icon}
            </svg>
          </a>
        ))
      )}

      <button
        type="button"
        onClick={copy}
        aria-label="คัดลอกลิงก์"
        title="คัดลอกลิงก์"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-black/15 text-ink/70 transition-colors hover:border-brand/40 hover:text-brand"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5A1.5 1.5 0 0 0 5.5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {/* aria-live so the confirmation is announced, not only seen. */}
      <span role="status" aria-live="polite" className="text-xs text-success">
        {copied ? "คัดลอกลิงก์แล้ว" : ""}
      </span>
    </div>
  );
}
