import { satangToBaht } from "@/lib/money";

/**
 * The price readout — the page's signature element.
 *
 * A recessed dark window with gold tabular digits, so the number reads as a
 * live instrument rather than as bold text. Tabular figures are the functional
 * half of this: during an auction the price updates on every poll, and
 * proportional digits would make the whole panel twitch on each change.
 *
 * The baht symbol is set apart from the figure so the digits keep a single
 * uninterrupted rhythm.
 */
export function PriceWindow({
  satang,
  size = "md",
  label,
}: {
  satang: number;
  size?: "sm" | "md" | "lg";
  label?: string;
}) {
  const digits = new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(satangToBaht(satang));

  const scale = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-2xl sm:text-3xl",
  }[size];

  return (
    <span className="inline-flex flex-col gap-1">
      {label ? (
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink/50">
          {label}
        </span>
      ) : null}
      <span className={`price-window font-semibold ${scale}`}>
        <span className="price-currency">฿</span>
        {digits}
      </span>
    </span>
  );
}
