/**
 * How long is left, in Thai.
 *
 * Pure and timezone-free: it works on two instants, so the same function
 * formats a server-rendered card and a ticking client countdown without the
 * two ever disagreeing.
 *
 * Deliberately coarse above an hour. "เหลือ 3 วัน" is what a browser needs to
 * decide whether to keep looking; seconds only start mattering at the end,
 * which is where the live countdown takes over.
 */
export function timeLeft(endTime: Date | null, now: Date): string {
  if (!endTime) return "ไม่ระบุเวลา";

  const ms = endTime.getTime() - now.getTime();
  if (ms <= 0) return "หมดเวลาแล้ว";

  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days >= 1) return `เหลือ ${days} วัน`;
  if (hours >= 1) return `เหลือ ${hours} ชม. ${minutes % 60} น.`;
  if (minutes >= 1) return `เหลือ ${minutes} นาที`;
  return "เหลือไม่ถึง 1 นาที";
}

/**
 * Digits only, for the ticking readout: 02:14:09, or 3 วัน 04:12 further out.
 *
 * Takes milliseconds rather than two Dates so a client ticker can drive it
 * from a single number without allocating a Date every second.
 */
export function countdownDigits(msRemaining: number): string {
  const total = Math.floor(Math.max(0, msRemaining) / 1000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  return days > 0
    ? `${days} วัน ${pad(hours)}:${pad(minutes)}`
    : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * True when an auction is close enough that the urgency styling is honest.
 *
 * Six hours, not twenty-four. A day out is not urgent, and a badge that lands
 * on most of the grid stops carrying information — it just adds red.
 */
export function isClosingSoon(endTime: Date | null, now: Date): boolean {
  if (!endTime) return false;
  const ms = endTime.getTime() - now.getTime();
  return ms > 0 && ms <= 6 * 60 * 60 * 1000;
}
