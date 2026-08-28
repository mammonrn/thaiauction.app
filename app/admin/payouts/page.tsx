import Link from "next/link";

import { PayoutRow } from "@/components/payout-row";
import { requireAdmin } from "@/lib/admin";
import { formatBaht } from "@/lib/money";
import { COMMISSION_PERCENT } from "@/lib/payment-math";
import { prisma } from "@/lib/prisma";
import { bankName } from "@/lib/thai-banks";
import { formatThaiDateTime } from "@/lib/thai-datetime";

/**
 * What the marketplace owes sellers, and what it has already sent.
 *
 * Every figure shown is stored, not recomputed here: the gateway fee and net
 * came from the Omise charge itself, and the commission and seller share were
 * worked out once at the moment the payment settled. A page that recalculated
 * them could quietly disagree with what was actually taken.
 */
export default async function AdminPayoutsPage() {
  await requireAdmin("/admin/payouts");

  const selection = {
    id: true,
    amount: true,
    fee: true,
    feeVat: true,
    net: true,
    commission: true,
    sellerNet: true,
    paidAt: true,
    payoutAt: true,
    payoutReference: true,
    payoutAccountNumber: true,
    payoutAccountName: true,
    payoutBy: { select: { name: true, email: true } },
    payer: { select: { name: true } },
    auctionItem: {
      select: {
        id: true,
        title: true,
        seller: {
          select: {
            name: true,
            email: true,
            firstName: true,
            lastName: true,
            bankAccount: {
              select: {
                bankCode: true,
                accountNumber: true,
                accountName: true,
                nameMatchesKyc: true,
              },
            },
          },
        },
      },
    },
  } as const;

  const [due, sent] = await Promise.all([
    prisma.payment.findMany({
      where: { status: "successful", payoutStatus: "pending" },
      orderBy: { paidAt: "asc" },
      select: selection,
    }),
    prisma.payment.findMany({
      where: { status: "successful", payoutStatus: "transferred" },
      orderBy: { payoutAt: "desc" },
      take: 20,
      select: selection,
    }),
  ]);

  const owed = due.reduce((total, row) => total + (row.sellerNet ?? 0), 0);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          รอโอนให้ผู้ขาย
        </h1>
        <p className="text-sm text-ink/60">
          {due.length} รายการ รวม {formatBaht(owed)} — ค่าคอมมิชชั่น{" "}
          {COMMISSION_PERCENT}% หักจากยอดหลังลบค่าธรรมเนียม Omise แล้ว
        </p>
      </header>

      {due.length === 0 ? (
        <p className="text-sm text-ink/60">
          ไม่มีรายการรอโอน
        </p>
      ) : (
        <ul className="flex flex-col gap-5">
          {due.map((row) => {
            const seller = row.auctionItem.seller;
            const account = seller.bankAccount;
            return (
              <li
                key={row.id}
                className="flex flex-col gap-4 rounded-xl bg-white p-5"
              >
                <div className="flex flex-col gap-1">
                  <Link
                    href={`/auctions/${row.auctionItem.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {row.auctionItem.title}
                  </Link>
                  <span className="text-xs text-ink/60">
                    ผู้ซื้อ {row.payer.name} · ชำระเมื่อ{" "}
                    {row.paidAt ? formatThaiDateTime(row.paidAt) : "-"}
                  </span>
                </div>

                <Breakdown row={row} />

                <div className="rounded-lg bg-black/[0.03] p-4 text-sm">
                  <p className="font-medium">โอนให้ {seller.name}</p>
                  {account ? (
                    <>
                      <p className="text-ink/70">
                        {bankName(account.bankCode)} · {account.accountNumber}
                      </p>
                      <p className="text-ink/70">
                        ชื่อบัญชี: {account.accountName}
                      </p>
                      {/* The KYC comparison is advisory: Thai bank names carry
                          title prefixes and inconsistent spacing, so a
                          mismatch is a prompt to look, not a verdict. */}
                      {account.nameMatchesKyc ? (
                        <p className="text-green-700">
                          ✓ ตรงกับชื่อที่ยืนยันตัวตน
                        </p>
                      ) : (
                        <p className="text-amber-700">
                          ⚠ ไม่ตรงกับชื่อที่ยืนยันตัวตน (
                          {seller.firstName && seller.lastName
                            ? `${seller.firstName} ${seller.lastName}`
                            : "ยังไม่ได้ยืนยันตัวตน"}
                          ) — กรุณาตรวจสอบก่อนโอน
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-red-600">
                      ผู้ขายยังไม่ได้บันทึกบัญชีธนาคาร — โอนไม่ได้จนกว่าจะบันทึก
                    </p>
                  )}
                </div>

                {account ? <PayoutRow paymentId={row.id} /> : null}
              </li>
            );
          })}
        </ul>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">โอนแล้วล่าสุด</h2>
        {sent.length === 0 ? (
          <p className="text-sm text-ink/60">
            ยังไม่มีประวัติการโอน
          </p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {sent.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-1 rounded-lg bg-white p-4"
              >
                <span className="font-medium">{row.auctionItem.title}</span>
                <span className="text-ink/70">
                  {formatBaht(row.sellerNet ?? 0)} →{" "}
                  {row.payoutAccountName ?? row.auctionItem.seller.name} ·{" "}
                  {row.payoutAccountNumber ?? "-"}
                </span>
                <span className="text-xs text-ink/60">
                  อ้างอิง {row.payoutReference} · โอนเมื่อ{" "}
                  {row.payoutAt ? formatThaiDateTime(row.payoutAt) : "-"} · โดย{" "}
                  {row.payoutBy?.email ?? "-"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/** The audit trail for one sale, every figure as it was recorded. */
function Breakdown({
  row,
}: {
  row: {
    amount: number;
    fee: number | null;
    feeVat: number | null;
    net: number | null;
    commission: number | null;
    sellerNet: number | null;
  };
}) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
      <Figure label="ผู้ซื้อชำระ" value={row.amount} />
      <Figure label="ค่าธรรมเนียม Omise" value={-(row.fee ?? 0)} />
      <Figure label="VAT ค่าธรรมเนียม" value={-(row.feeVat ?? 0)} />
      <Figure label="ยอดสุทธิที่ได้รับ" value={row.net ?? 0} />
      <Figure
        label={`ค่าคอมมิชชั่น ${COMMISSION_PERCENT}%`}
        value={-(row.commission ?? 0)}
      />
      <Figure label="ผู้ขายได้รับ" value={row.sellerNet ?? 0} strong />
    </dl>
  );
}

function Figure({
  label,
  value,
  strong,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-ink/60">{label}</dt>
      <dd className={strong ? "font-semibold" : undefined}>
        {value < 0 ? `−${formatBaht(-value)}` : formatBaht(value)}
      </dd>
    </div>
  );
}
