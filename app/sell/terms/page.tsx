import Link from "next/link";

import { acceptSellerTermsAction } from "@/app/sell/terms/actions";
import { PAYMENT_WINDOW_HOURS } from "@/lib/auction-rules";
import { formatBaht } from "@/lib/money";
import {
  COMMISSION_PERCENT,
  splitPayment,
  type PaymentBreakdown,
} from "@/lib/payment-math";
import { splitPaymentWithTransfer } from "@/lib/payout-math";
import { recipientPayoutsEnabled } from "@/lib/payouts";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { formatThaiDateTime } from "@/lib/thai-datetime";
import { btnPrimary } from "@/lib/button";

export const metadata = { title: "เงื่อนไขการขาย" };

/**
 * The worked example, in satang, computed rather than typed.
 *
 * A sale of ฿10,000 whose gateway fee came to about ฿390. The figures below are
 * produced by the same functions that produce a real payout, so the terms a
 * seller accepts cannot drift away from the arithmetic they are paid by — which
 * is the one way a page like this goes quietly wrong.
 */
const EXAMPLE_AMOUNT = 1_000_000;
const EXAMPLE_FEE = 36_449;
const EXAMPLE_FEE_VAT = 2_551;
const EXAMPLE_NET = EXAMPLE_AMOUNT - EXAMPLE_FEE - EXAMPLE_FEE_VAT;

/**
 * The terms a seller reads once, before their first listing.
 *
 * This page exists because of the commission. A seller is entitled to know
 * what the marketplace keeps BEFORE they list, not to discover it on their
 * first payout — so the rate is stated here in full, and accepting is recorded
 * with a timestamp rather than assumed from the fact that they carried on.
 *
 * Buyers never see this page and never see the rate. What a buyer pays is the
 * bid; how the marketplace and the seller divide it is not their transaction.
 */
export default async function SellerTermsPage({
  searchParams,
}: PageProps<"/sell/terms">) {
  const { user } = await requireSession("/sell/terms");
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/sell/new";

  // The example follows whichever payout path is live. With automatic transfers
  // off there is no transfer fee to deduct, and stating one would be describing
  // a charge that is not made.
  const charge = {
    amount: EXAMPLE_AMOUNT,
    fee: EXAMPLE_FEE,
    feeVat: EXAMPLE_FEE_VAT,
    net: EXAMPLE_NET,
  };
  const example: PaymentBreakdown & { transferFee?: number } =
    (recipientPayoutsEnabled() ? splitPaymentWithTransfer(charge) : null) ??
    splitPayment(charge);

  const record = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { sellerTermsAcceptedAt: true },
  });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-2">
        <Link
          href="/sell"
          className="text-sm text-ink/60 underline-offset-4 hover:underline"
        >
          ← กลับรายการสินค้าของฉัน
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">เงื่อนไขการขาย</h1>
        <p className="text-sm text-ink/60">
          อ่านครั้งเดียวก่อนลงขายครั้งแรก
        </p>
      </div>

      <div className="flex flex-col gap-5 rounded-xl bg-white p-5 sm:p-6">
        <Term title={`ค่าคอมมิชชั่น ${COMMISSION_PERCENT}%`}>
          <p>
            เมื่อสินค้าขายได้และผู้ซื้อชำระเงินแล้ว เราหักค่าคอมมิชชั่น{" "}
            <strong>{COMMISSION_PERCENT}%</strong>{" "}
            จากยอดที่เหลือหลังหักค่าธรรมเนียมของระบบชำระเงิน
            {example.transferFee !== undefined
              ? " และค่าธรรมเนียมโอนเงินเข้าบัญชีธนาคารของคุณ"
              : ""}
            แล้ว ส่วนที่เหลือทั้งหมดเป็นของคุณ
          </p>
          <p className="text-ink/60">
            ตัวอย่าง: ขายได้ {formatBaht(example.amount)} ·
            ค่าธรรมเนียมระบบชำระเงิน{" "}
            {formatBaht(example.fee + example.feeVat)} ·
            {example.transferFee !== undefined ? (
              <> ค่าธรรมเนียมโอน {formatBaht(example.transferFee)} ·</>
            ) : null}{" "}
            หักคอมมิชชั่น {COMMISSION_PERCENT}% ={" "}
            {formatBaht(example.commission)} ·{" "}
            <strong className="text-ink">
              คุณได้รับ {formatBaht(example.sellerNet)}
            </strong>
          </p>
          <p className="text-ink/60">
            ค่าธรรมเนียมระบบชำระเงินขึ้นกับวิธีที่ผู้ซื้อเลือก
            เราใช้ตัวเลขจริงจากผู้ให้บริการทุกครั้ง ไม่ได้ประมาณเอง
            และแสดงรายการหักทั้งหมดให้ดูได้
          </p>
        </Term>

        <Term title="การรับเงิน">
          <p>
            เราโอนเข้าบัญชีธนาคารที่คุณบันทึกไว้ในหน้า{" "}
            <Link href="/account/bank" className="text-brand underline underline-offset-4">
              บัญชีธนาคาร
            </Link>{" "}
            ชื่อบัญชีควรตรงกับชื่อที่คุณยืนยันตัวตนไว้
            ถ้าไม่ตรงทีมงานจะตรวจสอบก่อนโอน ซึ่งทำให้ได้รับเงินช้าลง
          </p>
        </Term>

        <Term title="ผู้ซื้อมีเวลาชำระ 24 ชั่วโมง">
          <p>
            ถ้าผู้ชนะไม่ชำระภายใน {PAYMENT_WINDOW_HOURS} ชั่วโมง
            สิทธิ์จะถูกส่งต่อให้ผู้เสนอราคารายถัดไปโดยอัตโนมัติ
            ที่ราคาที่คนนั้นเสนอไว้ ซึ่งอาจต่ำกว่าราคาปิดเดิม
          </p>
        </Term>

        <Term title="ห้ามปั่นราคาสินค้าตัวเอง">
          <p>
            การใช้บัญชีอื่นมาเสนอราคาสินค้าของตัวเองเพื่อดันราคาเป็นเหตุให้ถูกระงับการขาย
            ระบบตรวจสอบเบอร์โทรและข้อมูลยืนยันตัวตนที่ซ้ำกัน
            และบันทึกที่มาของการเสนอราคาทุกครั้งเพื่อการตรวจสอบ
          </p>
        </Term>

        <Term title="ข้อมูลส่วนบุคคล">
          <p>
            ดูรายละเอียดที่{" "}
            <Link href="/privacy" className="text-brand underline underline-offset-4">
              นโยบายความเป็นส่วนตัว
            </Link>
          </p>
        </Term>
      </div>

      {record.sellerTermsAcceptedAt ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-5">
          <p className="text-sm text-ink/70">
            คุณยอมรับเงื่อนไขแล้วเมื่อ{" "}
            {formatThaiDateTime(record.sellerTermsAcceptedAt)}
          </p>
          <Link
            href={next}
            className={btnPrimary}
          >
            ไปลงขายสินค้า
          </Link>
        </div>
      ) : (
        <form
          action={acceptSellerTermsAction}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-5"
        >
          <input type="hidden" name="next" value={next} />
          <p className="text-sm text-ink/70">
            กดยอมรับเพื่อเริ่มลงขายสินค้า
          </p>
          <button
            type="submit"
            className={btnPrimary}
          >
            ยอมรับเงื่อนไขและลงขาย
          </button>
        </form>
      )}
    </main>
  );
}

function Term({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5 border-b border-black/8 pb-5 last:border-0 last:pb-0">
      <h2 className="font-semibold">{title}</h2>
      <div className="flex flex-col gap-1.5 text-sm leading-relaxed text-ink/80">
        {children}
      </div>
    </section>
  );
}
