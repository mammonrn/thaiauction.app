import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/admin";
import { btnPrimarySm } from "@/lib/button";
import { formatBaht } from "@/lib/money";
import {
  bangkokDayEnd,
  bangkokDayStart,
  salesReport,
  type CategorySales,
  type SalesTotals,
} from "@/lib/sales-report";

export const metadata = { title: "รายงานยอดขาย" };

/**
 * What has been sold, and where the money went.
 *
 * READ ONLY. There is no action on this page and no state it can change —
 * a report that can also do something is a report you hesitate to open.
 *
 * Every figure comes from a column written when a charge settled, never from
 * arithmetic performed here. See lib/sales-report.ts for why that distinction
 * is the whole point.
 */
export default async function AdminSalesReportPage({
  searchParams,
}: PageProps<"/admin/reports/sales">) {
  await requireAdmin("/admin/reports/sales");

  const params = await searchParams;
  const fromValue = typeof params.from === "string" ? params.from : "";
  const toValue = typeof params.to === "string" ? params.to : "";

  const report = await salesReport({
    from: bangkokDayStart(fromValue),
    to: bangkokDayEnd(toValue),
  });

  const filtered = report.from !== null || report.to !== null;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-2">
        <AdminBackLink />
        <h1 className="text-2xl font-semibold tracking-tight">รายงานยอดขาย</h1>
        <p className="text-sm text-ink/60">
          {filtered ? "ตามช่วงวันที่ที่เลือก" : "ตั้งแต่เริ่มระบบ"} ·{" "}
          {report.totals.count.toLocaleString("th-TH")} รายการที่ขายสำเร็จ
        </p>
      </header>

      {/* A GET form, like every other filter in the app: the view is a URL, so
          a month's figures can be sent to somebody rather than described. */}
      <form
        action="/admin/reports/sales"
        className="flex flex-wrap items-end gap-2 rounded-xl bg-white p-4"
      >
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-ink/60">ตั้งแต่</span>
          <input
            type="date"
            name="from"
            defaultValue={fromValue}
            className="rounded-lg border border-black/15 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-ink/60">ถึง</span>
          <input
            type="date"
            name="to"
            defaultValue={toValue}
            className="rounded-lg border border-black/15 px-3 py-2 text-sm"
          />
        </label>
        <button type="submit" className={btnPrimarySm}>
          ดูรายงาน
        </button>
        {filtered ? (
          <a
            href="/admin/reports/sales"
            className="text-xs text-info underline-offset-4 hover:underline"
          >
            ล้างตัวกรอง
          </a>
        ) : null}
      </form>

      <Summary totals={report.totals} />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">แยกตามหมวดหมู่</h2>

        {report.categories.length === 0 ? (
          <p className="text-sm text-ink/60">
            {filtered ? "ไม่มีการขายในช่วงนี้" : "ยังไม่มีการขายสำเร็จ"}
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {report.categories.map((row) => (
                <CategoryRow key={row.id} row={row} share={report.totals.sales} />
              ))}
            </ul>
            {report.quietCategories > 0 ? (
              <p className="text-xs text-ink/45">
                อีก {report.quietCategories} หมวดยังไม่มีการขายในช่วงนี้
              </p>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}

/**
 * The five figures, as a statement rather than a dashboard.
 *
 * Sales at the top because it is the subject; the two deductions marked as
 * subtractions; commission ruled off at the bottom because it is the line the
 * page exists to show. The same shape the payout breakdown uses, for the same
 * reason: the reader's question is "does the bottom line follow?", and a column
 * that runs down to a rule answers it by being read.
 */
function Summary({ totals }: { totals: SalesTotals }) {
  return (
    <dl className="flex flex-col rounded-xl bg-white px-5 py-4 text-sm">
      <Figure label="ยอดขายรวม" value={totals.sales} />
      <Figure label="ค่าธรรมเนียม Omise" value={-totals.omiseFee} indent />
      <Figure label="VAT ค่าธรรมเนียม" value={-totals.omiseVat} indent />
      <Figure label="รวมที่จ่ายให้ Omise" value={-totals.omiseTotal} />
      <Figure label="รายได้ค่าคอมมิชชั่น" value={totals.commission} total />
    </dl>
  );
}

function Figure({
  label,
  value,
  total,
  indent,
}: {
  label: string;
  value: number;
  total?: boolean;
  indent?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-1 ${
        total ? "mt-1 border-t border-black/12 pt-2 font-semibold" : ""
      }`}
    >
      <dt className={`${total ? "" : "text-ink/60"} ${indent ? "pl-3 text-xs" : ""}`}>
        {label}
      </dt>
      {/* tabular-nums so the digits line up down the column, which is the only
          reason a reader can check one figure against another.

          `|| 0` collapses negative zero: a deduction of nothing is passed in as
          -0, which is not less than zero and so escapes the sign branch below,
          and Intl then prints it "-฿0.00" with its own hyphen. An empty report
          would show four minus signs against four zeros. */}
      <dd className={`font-mono tabular-nums ${indent ? "text-xs text-ink/60" : ""}`}>
        {value < 0 ? `−${formatBaht(-value)}` : formatBaht(value || 0)}
      </dd>
    </div>
  );
}

/**
 * One category.
 *
 * The bar is the only thing here that is not a number, and it earns its place:
 * ranked rows answer "which is biggest" but not "by how much", and at a glance
 * a reader wants both. Ink, not brand — it is the shape of the data, not
 * something to act on.
 */
function CategoryRow({ row, share }: { row: CategorySales; share: number }) {
  const percent = share > 0 ? Math.round((row.sales / share) * 100) : 0;

  return (
    <li className="flex flex-col gap-1.5 rounded-xl bg-white p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="font-medium">{row.name}</span>
        <span className="font-mono tabular-nums font-semibold">
          {formatBaht(row.sales)}
        </span>
      </div>

      <div className="h-1 w-full overflow-hidden rounded-full bg-black/[.06]">
        <div
          className="h-full rounded-full bg-ink/45"
          style={{ width: `${Math.max(percent, 1)}%` }}
        />
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-ink/60">
        <span>
          {row.count.toLocaleString("th-TH")} รายการ · {percent}% ของยอดขาย
        </span>
        <span className="font-mono tabular-nums">
          คอมมิชชั่น {formatBaht(row.commission)}
        </span>
      </div>
    </li>
  );
}
