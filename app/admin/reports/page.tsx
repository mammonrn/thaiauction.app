import { AdminBackLink } from "@/components/admin-back-link";
import { AdminReportRow, type ReportedRow } from "@/components/admin-report-row";
import { requireAdmin } from "@/lib/admin";
import { reportedItems } from "@/lib/moderation";
import { formatThaiDateTime } from "@/lib/thai-datetime";

export const metadata = { title: "สินค้าที่ถูกแจ้ง" };

/**
 * The moderation queue.
 *
 * Most-reported first, because the count is the only number that decides what
 * to open next. Unlike the public pages this deliberately does NOT filter out
 * removed listings — an admin needs to see what was taken down and why, and a
 * removal that vanishes from the admin's own view cannot be reviewed.
 */
export default async function AdminReportsPage() {
  await requireAdmin("/admin/reports");

  const queue = await reportedItems();

  const rows: ReportedRow[] = queue.map(({ item, reportCount }) => ({
    itemId: item.id,
    title: item.title,
    price: item.currentPrice,
    status: item.status,
    paymentState: item.paymentState,
    deleted: item.deletedAt !== null,
    seller: {
      id: item.seller.id,
      name: item.seller.name,
      email: item.seller.email,
    },
    reportCount,
    reports: item.reports.map((report) => ({
      id: report.id,
      reason: report.reason,
      note: report.note,
      // The reporter's own name, not masked: an admin judging a report needs
      // to see whether the same few accounts file all of them.
      reporterName: report.reporter.name,
      when: formatThaiDateTime(report.createdAt),
    })),
  }));

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-2">
        <AdminBackLink />
        <h1 className="text-2xl font-semibold tracking-tight">สินค้าที่ถูกแจ้ง</h1>
        <p className="text-sm text-ink/60">
          {rows.length} รายการ · เรียงตามจำนวนผู้แจ้ง
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-ink/60">ไม่มีเรื่องค้าง</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <AdminReportRow key={row.itemId} row={row} />
          ))}
        </ul>
      )}
    </main>
  );
}
