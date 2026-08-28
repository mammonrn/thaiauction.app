"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { btnSecondarySm } from "@/lib/button";

/**
 * "Install app", handling the fact that the two platforms disagree completely.
 *
 * Chrome on Android fires `beforeinstallprompt`, which must be captured and
 * replayed from a user gesture — so the event is stashed and the button only
 * appears once there is something to replay.
 *
 * iOS Safari fires nothing and offers no API. The only route is Share → Add to
 * Home Screen, so iOS gets instructions instead of a button that cannot work.
 * Telling an iPhone user to "install" and having nothing happen is worse than
 * telling them where the menu item is.
 *
 * Already-installed visitors see neither: `display-mode: standalone` means they
 * are reading this inside the installed copy.
 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Platform = "unknown" | "ios" | "other" | "installed";

/**
 * Which platform is reading this.
 *
 * Read through useSyncExternalStore rather than set from an effect: it is
 * external browser state that never changes for the life of the page, and the
 * server has no answer for it. The server snapshot is "unknown", so the first
 * paint matches on both sides and nothing flashes.
 */
function readPlatform(): Platform {
  if (window.matchMedia("(display-mode: standalone)").matches) return "installed";
  // iPad reports as Macintosh, so touch capability is part of the test.
  const ios =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return ios ? "ios" : "other";
}

/** Platform does not change while the page is open, so nothing to subscribe to. */
const noSubscribe = () => () => {};

export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const platform = useSyncExternalStore<Platform>(
    noSubscribe,
    readPlatform,
    () => "unknown",
  );

  useEffect(() => {
    const capture = (event: Event) => {
      // Stop Chrome showing its own mini-infobar; we place the button.
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", capture);
    return () => window.removeEventListener("beforeinstallprompt", capture);
  }, []);

  if (platform === "installed") return null;

  if (platform === "ios") {
    return (
      <p className="text-sm text-ink/60">
        ติดตั้งเป็นแอป: กดปุ่มแชร์{" "}
        <span aria-hidden="true" className="mx-0.5">
          􀈂
        </span>
        ใน Safari แล้วเลือก{" "}
        <strong className="text-ink/80">เพิ่มไปยังหน้าจอโฮม</strong>
      </p>
    );
  }

  if (!prompt) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        await prompt.prompt();
        await prompt.userChoice;
        // The event is single-use; drop it either way.
        setPrompt(null);
      }}
      className={btnSecondarySm}
    >
      ติดตั้งแอป
    </button>
  );
}
