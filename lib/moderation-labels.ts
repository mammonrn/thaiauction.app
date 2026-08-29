/**
 * Report reasons and their Thai labels.
 *
 * Split from lib/moderation.ts because that module is `server-only` and the
 * report form is a client component: the labels are not secrets, and the
 * browser needs the same list the server validates against so the two cannot
 * drift.
 */

export type ReportReason =
  | "illegal"
  | "counterfeit"
  | "inappropriate"
  | "other";

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "illegal", label: "ผิดกฎหมาย" },
  { value: "counterfeit", label: "ของปลอม" },
  { value: "inappropriate", label: "เนื้อหาไม่เหมาะสม" },
  { value: "other", label: "อื่น ๆ" },
];

export const REPORT_REASON_LABEL: Record<ReportReason, string> =
  Object.fromEntries(
    REPORT_REASONS.map((entry) => [entry.value, entry.label]),
  ) as Record<ReportReason, string>;

export function isReportReason(value: string): value is ReportReason {
  return REPORT_REASONS.some((entry) => entry.value === value);
}

/** A note longer than this is a conversation, not a report. */
export const MAX_REPORT_NOTE = 500;
