"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  subscribePushAction,
  unsubscribePushAction,
} from "@/app/account/push-actions";
import { btnPrimarySm, btnSecondarySm } from "@/lib/button";

/**
 * Turn Web Push on or off for THIS browser.
 *
 * Permission is requested only when the button is pressed. A page that asks on
 * load gets refused by people who would have said yes if asked at a moment
 * they understood — and a refusal is close to permanent, because the browser
 * will not let the site ask again.
 *
 * Every state the visitor could be in is named, because each has a different
 * next step and "nothing happens when I press it" is the worst of them:
 *
 *   unsupported  — no push in this browser at all
 *   ios-needs-pwa — iOS Safari, which allows push ONLY from an installed copy
 *   blocked      — they said no once; the site cannot ask again, so the only
 *                  route is browser settings, which is spelled out
 *   off / on     — the ordinary two
 */
type Capability = "unsupported" | "ios-needs-pwa" | "blocked" | "available";

/**
 * How long to wait for the browser's push service before giving up.
 *
 * Generous, because this is a real network round trip to Google or Mozilla on
 * a phone that may be on mobile data — but finite, because the alternative is
 * a button that spins forever.
 */
const SUBSCRIBE_TIMEOUT_MS = 15_000;

/** The VAPID public key arrives base64url; PushManager wants bytes. */
function urlBase64ToUint8Array(base64: string): BufferSource {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const normalised = padded.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  // A fresh ArrayBuffer, not a view onto a shared one: PushManager's typing
  // requires ArrayBufferView<ArrayBuffer>, and Uint8Array's default generic is
  // the wider ArrayBufferLike.
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

function isIos(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent);
}

/** An installed PWA, in the two ways the platforms report it. */
function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

function noSubscribe() {
  return () => {};
}

/**
 * What this browser can do — all synchronous reads, so it goes through
 * useSyncExternalStore rather than an effect. The server has no idea and
 * renders the loading line; the client corrects it on hydration.
 */
function readCapability(): Capability {
  if (typeof navigator === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    // iOS Safari in a TAB reports no PushManager, which looks identical to a
    // browser that will never have it — but the remedy is different, so the
    // two are told apart here.
    return isIos() && !isStandalone() ? "ios-needs-pwa" : "unsupported";
  }
  if (Notification.permission === "denied") return "blocked";
  return "available";
}

export function PushToggle({ publicKey }: { publicKey: string }) {
  const capability = useSyncExternalStore(
    noSubscribe,
    readCapability,
    () => "unsupported" as Capability,
  );
  // Whether THIS browser already holds a subscription. Only knowable
  // asynchronously, so it stays an effect — and the state is set from inside
  // the promise, never synchronously during the effect body.
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (capability !== "available") return;
    let cancelled = false;

    navigator.serviceWorker
      .getRegistration("/sw.js")
      .then((registration) => registration?.pushManager.getSubscription() ?? null)
      .then((existing) => {
        if (!cancelled) setSubscribed(existing !== null);
      })
      .catch(() => {
        if (!cancelled) setSubscribed(false);
      });

    return () => {
      cancelled = true;
    };
  }, [capability]);

  async function enable() {
    setBusy(true);
    setMessage(null);
    try {
      // Registered here rather than on every page load: a visitor who never
      // asks for notifications never installs a worker.
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
      await navigator.serviceWorker.ready;

      const permission = await Notification.requestPermission();
      if (permission === "denied") {
        // readCapability will report "blocked" from here on; say so now too.
        setMessage("คุณบล็อกการแจ้งเตือนไว้ — เปิดใหม่ได้ที่การตั้งค่าเบราว์เซอร์");
        return;
      }
      if (permission !== "granted") {
        // Dismissed rather than refused: they can be asked again.
        setMessage("ยังไม่ได้อนุญาต ลองใหม่ได้");
        return;
      }

      // Raced against a clock, because subscribe() can HANG rather than
      // reject: it has to reach the browser's push service, and a network
      // that blocks it — a corporate firewall, a captive portal, a country
      // that filters it — leaves the promise pending forever. Without this the
      // button sits on "กำลังเปิด…" with nothing ever happening, which is the
      // exact failure this component exists to avoid.
      const subscription = await Promise.race([
        registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }),
        new Promise<never>((_, reject) =>
          window.setTimeout(
            () => reject(new Error("push-subscribe-timeout")),
            SUBSCRIBE_TIMEOUT_MS,
          ),
        ),
      ]);

      const json = subscription.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };

      const data = new FormData();
      data.set("endpoint", json.endpoint ?? "");
      data.set("p256dh", json.keys?.p256dh ?? "");
      data.set("auth", json.keys?.auth ?? "");
      const result = await subscribePushAction({ ok: false, message: null }, data);

      setMessage(result.message);
      if (result.ok) setSubscribed(true);
    } catch (error) {
      console.error("[push] enable failed:", error);
      setMessage(
        (error as Error)?.message === "push-subscribe-timeout"
          ? "เชื่อมต่อบริการแจ้งเตือนไม่ได้ — อาจถูกเครือข่ายบล็อกไว้ ลองเครือข่ายอื่นหรือลองใหม่ภายหลัง"
          : "เปิดการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่",
      );
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        const data = new FormData();
        data.set("endpoint", subscription.endpoint);
        // The server row goes first: if unsubscribing in the browser succeeded
        // and the row survived, this device would be pushed to forever.
        await unsubscribePushAction({ ok: false, message: null }, data);
        await subscription.unsubscribe();
      }

      setSubscribed(false);
      setMessage("ปิดการแจ้งเตือนแล้ว");
    } catch (error) {
      console.error("[push] disable failed:", error);
      setMessage("ปิดไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-white p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">แจ้งเตือนบนอุปกรณ์นี้</span>
        {capability === "available" && subscribed === true ? (
          <span className="rounded bg-success/12 px-2 py-0.5 text-xs font-medium text-success">
            เปิดอยู่
          </span>
        ) : capability === "available" && subscribed === false ? (
          <span className="rounded bg-black/[.06] px-2 py-0.5 text-xs text-ink/60">
            ปิดอยู่
          </span>
        ) : null}
      </div>

      {capability === "unsupported" ? (
        <p className="text-xs text-ink/60">
          เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน — กระดิ่งในแอปยังใช้ได้ตามปกติ
        </p>
      ) : capability === "ios-needs-pwa" ? (
        // Naming the exact steps, because iOS gives no prompt and no error:
        // the button would simply do nothing.
        <p className="text-xs text-warning">
          บน iPhone ต้องติดตั้งแอปก่อน — กดปุ่มแชร์ใน Safari แล้วเลือก
          &ldquo;เพิ่มไปยังหน้าจอโฮม&rdquo; จากนั้นเปิดจากไอคอนแอปและกลับมาหน้านี้
        </p>
      ) : capability === "blocked" ? (
        // The site cannot re-ask once refused; only the browser can undo it.
        <p className="text-xs text-warning">
          คุณเคยบล็อกการแจ้งเตือนไว้ เว็บขอสิทธิ์ซ้ำเองไม่ได้ — เปิดใหม่ได้ที่
          การตั้งค่าเบราว์เซอร์ &rsaquo; การแจ้งเตือน แล้วอนุญาตเว็บนี้
        </p>
      ) : subscribed === null ? (
        <p className="text-xs text-ink/55">กำลังตรวจสอบ…</p>
      ) : subscribed ? (
        <>
          <p className="text-xs text-ink/60">
            จะได้รับแจ้งเตือนแม้ไม่ได้เปิดเว็บไว้
          </p>
          <button
            type="button"
            onClick={disable}
            disabled={busy}
            className={`${btnSecondarySm} self-start`}
          >
            {busy ? "กำลังปิด…" : "ปิดการแจ้งเตือน"}
          </button>
        </>
      ) : (
        <>
          <p className="text-xs text-ink/60">
            เปิดไว้เพื่อรู้ทันทีเมื่อถูกแซงราคาหรือประมูลใกล้จบ
          </p>
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className={`${btnPrimarySm} self-start`}
          >
            {busy ? "กำลังเปิด…" : "เปิดการแจ้งเตือน"}
          </button>
        </>
      )}

      {message ? <p className="text-xs text-ink/60">{message}</p> : null}
    </div>
  );
}
