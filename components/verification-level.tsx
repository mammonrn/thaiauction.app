import Link from "next/link";
import { btnPrimarySm } from "@/lib/button";

import {
  LEVELS,
  verificationLevel,
  type VerificationFacts,
} from "@/lib/verification-level";

/**
 * One badge instead of a stack of them.
 *
 * Two modes, because the same fact is read for two different reasons:
 *
 *   - `own` — on your own account page, where the useful part is what comes
 *     next, so the badge is followed by a progress track and one link.
 *   - default — on a listing, where you are reading a STRANGER's standing.
 *     Their next step is none of your business, so only the badge renders.
 *
 * Same component either way, so the two can never drift apart in wording or
 * in what a level is taken to mean.
 */
export function VerificationLevel({
  facts,
  variant = "compact",
}: {
  facts: VerificationFacts;
  variant?: "compact" | "own";
}) {
  const level = verificationLevel(facts);
  const info = LEVELS[level];

  if (variant === "compact") {
    return <LevelBadge level={level} title={info.title} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <LevelBadge level={level} title={info.title} />
        <span className="text-sm text-ink/60">{info.can}</span>
      </div>

      {/* Three segments, filled to the level reached. The track carries real
          information — how far along you are — rather than decorating it.

          Filled in success, not brand. Three full-width brand bars made a
          finished account the loudest thing on the account page, which put the
          accent colour on a state rather than on an action. Progress towards a
          verified account IS a status, and status has its own colour now. */}
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {([1, 2, 3] as const).map((step) => (
          <span
            key={step}
            className={`h-1.5 flex-1 rounded-full ${
              step <= level ? "bg-success" : "bg-black/10"
            }`}
          />
        ))}
      </div>

      {info.next ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-ink/70">ขั้นถัดไป: {info.next}</span>
          <Link
            href={info.nextHref}
            className={`${btnPrimarySm} shrink-0`}
          >
            {info.nextLabel}
          </Link>
        </div>
      ) : (
        <p className="text-sm text-ink/60">
          ยืนยันครบทุกขั้นแล้ว — ใช้งานได้เต็มรูปแบบ
        </p>
      )}
    </div>
  );
}

/**
 * A completed account is a STATUS, so it is marked in success — not in brand,
 * which belongs to the brand and its buttons, and not in gold, which belongs
 * to the price. This badge is the only place the level is stated, so getting
 * its colour right settles it everywhere the component is used.
 */
function LevelBadge({ level, title }: { level: number; title: string }) {
  const complete = level === 3;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
        complete ? "bg-success/12 text-success" : "bg-black/[.06] text-ink/75"
      }`}
    >
      <span
        aria-hidden="true"
        className={`grid h-4 w-4 place-items-center rounded-full text-[10px] ${
          complete ? "bg-success/20" : "bg-ink/15"
        }`}
      >
        {level}
      </span>
      {title}
    </span>
  );
}
