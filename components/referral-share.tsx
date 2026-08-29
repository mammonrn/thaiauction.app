"use client";

import { useState, useSyncExternalStore } from "react";

import { btnPrimary, btnSecondary } from "@/lib/button";

/**
 * The invite link, with the two ways of passing it on.
 *
 * Same shape as the listing share control: the system share sheet where the
 * browser has one — every current phone — and the link plus a copy button
 * everywhere else. `useSyncExternalStore` rather than an effect so the server
 * and the first client render agree there is no share sheet, and only then
 * correct themselves.
 *
 * The message is fixed here rather than composed at the call site, because it
 * is the one piece of copy in this feature that has to stay honest: it says
 * what the marketplace is and nothing about what anyone gets for sharing it.
 */
function noSubscribe() {
  return () => {};
}

function readCanShare() {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

export function ReferralShare({ link, message }: { link: string; message: string }) {
  const canShare = useSyncExternalStore(noSubscribe, readCanShare, () => false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${message}\n${link}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused (an insecure origin, a locked-down
      // browser). The link is on screen and selectable, so this is not worth
      // an alert.
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Readable and selectable, so the link works even where neither button
          does. Mono, because it is a string to be copied exactly. */}
      <p className="break-all rounded-lg bg-paper px-3 py-2.5 font-mono text-sm">
        {link}
      </p>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className={btnPrimary}>
          คัดลอกลิงก์
        </button>

        {canShare ? (
          <button
            type="button"
            onClick={() => {
              void navigator
                .share({ text: message, url: link })
                // An abandoned share sheet rejects; that is a choice, not a fault.
                .catch(() => {});
            }}
            className={btnSecondary}
          >
            แชร์ให้เพื่อน
          </button>
        ) : null}
      </div>

      {/* aria-live so the confirmation is announced, not only seen. */}
      <span role="status" aria-live="polite" className="text-xs text-success">
        {copied ? "คัดลอกข้อความและลิงก์แล้ว" : ""}
      </span>
    </div>
  );
}
