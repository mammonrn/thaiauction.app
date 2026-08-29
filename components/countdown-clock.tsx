"use client";

import { useEffect, useState } from "react";

import { countdownDigits } from "@/lib/time-left";

/**
 * A ticking countdown.
 *
 * Deliberately NOT in the price window's housing. One recessed readout per
 * card is a signature; two is a pattern, and the price stops being the thing
 * the eye goes to. This is white mono type on a dark housing instead — same
 * family, same tabular figures, a quarter of the weight.
 *
 * Used only where the seconds actually matter — the closing-soon rail — rather
 * than on every card in the grid. Two dozen intervals to animate numbers
 * nobody is watching is a cost with no return; the grid renders its remaining
 * time on the server instead.
 *
 * The initial value comes from the SERVER's clock, so the first paint is right
 * even on a device whose time is wrong. The effect then measures the skew once
 * and ticks against the corrected clock.
 */
export function CountdownClock({
  endsAt,
  serverNow,
}: {
  endsAt: string;
  serverNow: string;
}) {
  const [remaining, setRemaining] = useState(
    () => new Date(endsAt).getTime() - new Date(serverNow).getTime(),
  );

  useEffect(() => {
    const end = new Date(endsAt).getTime();
    // Positive when the device's clock runs behind the server's.
    const skew = new Date(serverNow).getTime() - Date.now();
    const id = setInterval(() => setRemaining(end - (Date.now() + skew)), 1000);
    return () => clearInterval(id);
  }, [endsAt, serverNow]);

  const done = remaining <= 0;

  return (
    <span
      className="font-mono text-[11px] font-semibold tabular-nums text-white"
      role="timer"
      aria-live="off"
    >
      {done ? "ปิดแล้ว" : countdownDigits(remaining)}
    </span>
  );
}
