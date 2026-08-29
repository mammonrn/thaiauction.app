import { requireAdmin } from "@/lib/admin";
import { findFraudSignals } from "@/lib/fraud-signals";
import { BID_METADATA_RETENTION_DAYS } from "@/lib/retention";
import { formatThaiDateTime } from "@/lib/thai-datetime";

/**
 * Possible shill rings.
 *
 * Nothing on this page is a finding — it is a list of coincidences worth a
 * look. Several accounts bidding on one seller's items from one address is
 * exactly what a sock-puppet ring looks like, and also exactly what a family
 * on one router looks like, so the system never acts on it by itself.
 */
export default async function AdminFraudPage() {
  await requireAdmin("/admin/fraud");

  const signals = await findFraudSignals();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          สัญญาณน่าสงสัย (อาจเป็นการปั่นราคา)
        </h1>
        <p className="text-sm text-ink/60">
          หลายบัญชีเสนอราคาผู้ขายรายเดียวกันจาก IP หรืออุปกรณ์เดียวกัน —{" "}
          <strong>ไม่ใช่ข้อสรุปว่าโกง</strong>
        </p>
        <p className="text-xs text-ink/50">
          ย้อนหลัง {BID_METADATA_RETENTION_DAYS} วัน
        </p>
      </header>

      {signals.length === 0 ? (
        <p className="text-sm text-ink/60">
          ยังไม่พบสัญญาณน่าสงสัย
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {signals.map((signal) => (
            <li
              key={`${signal.signal}:${signal.value}:${signal.sellerId}`}
              className="flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-50/50 p-5 text-sm"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="rounded bg-amber-600/15 px-2 py-0.5 text-xs font-medium">
                  {signal.signal === "ip" ? "IP เดียวกัน" : "อุปกรณ์เดียวกัน"}
                </span>
                <span className="font-medium">
                  {signal.bidderNames.length} บัญชี · {signal.bidCount} การเสนอราคา
                </span>
              </div>

              <p>
                <span className="text-ink/60">ผู้ขาย: </span>
                {signal.sellerName} ({signal.sellerEmail})
              </p>
              <p>
                <span className="text-ink/60">
                  ผู้เสนอราคา:{" "}
                </span>
                {signal.bidderNames.join(", ")}
              </p>
              <p className="break-all text-xs text-ink/60">
                {signal.signal === "ip" ? "IP" : "User-Agent"}: {signal.value}
              </p>
              <p className="text-xs text-ink/60">
                เสนอราคาล่าสุด {formatThaiDateTime(signal.lastBidAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
