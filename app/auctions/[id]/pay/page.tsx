import Link from "next/link";
import { notFound } from "next/navigation";

import { PaymentPanel } from "@/components/payment-panel";
import { PAYMENT_WINDOW_HOURS } from "@/lib/auction-rules";
import { formatBaht } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { formatThaiDateTime } from "@/lib/thai-datetime";

/**
 * Pay for a won auction.
 *
 * Reachable only by the person who currently holds the right to buy. That is
 * re-read here on every render rather than trusted from a link, and re-read
 * AGAIN under the auction's row lock when a charge is actually created — the
 * right can move to the next bidder at any moment, and a page that rendered a
 * second earlier must not be able to charge someone who has since lost it.
 */
export default async function PayPage({
  params,
}: PageProps<"/auctions/[id]/pay">) {
  const { id } = await params;
  const { user } = await requireSession(`/auctions/${id}/pay`);

  const item = await prisma.auctionItem.findFirst({
    where: { id, status: { in: ["ended", "cancelled"] } },
    select: {
      id: true,
      title: true,
      currentPrice: true,
      winnerId: true,
      paymentState: true,
      paymentDueAt: true,
      seller: { select: { name: true } },
    },
  });

  // A non-winner gets the same 404 as a stranger: whether someone else won an
  // auction is not something a guessed URL should confirm.
  if (!item || item.winnerId !== user.id) notFound();

  const paid = item.paymentState === "paid";

  const payment = await prisma.payment.findFirst({
    where: { auctionItemId: item.id, payerId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      method: true,
      qrDownloadUri: true,
      expiresAt: true,
      failureMessage: true,
      amount: true,
      paidAt: true,
    },
  });

  // react-hooks/purity targets client components, which may re-render at any
  // moment. This is an async Server Component on a dynamic route: it runs once
  // per request, and whether the deadline has passed is exactly the kind of
  // request-time fact it exists to answer. The charge path re-checks it under
  // the row lock anyway, so this only decides what to render.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const overdue =
    !paid && item.paymentDueAt !== null && item.paymentDueAt.getTime() <= now;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href={`/auctions/${item.id}`}
        className="text-sm text-ink/60 underline-offset-4 hover:underline"
      >
        ← กลับไปหน้ารายการ
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">ชำระเงิน</h1>
        <p className="text-sm text-ink/60">
          {item.title} — ผู้ขาย {item.seller.name}
        </p>
      </header>

      <dl className="flex flex-col gap-2 rounded-xl bg-white p-5 text-sm">
        <div className="flex items-baseline justify-between">
          <dt className="text-ink/60">ยอดที่ต้องชำระ</dt>
          <dd className="text-xl font-semibold">
            {formatBaht(item.currentPrice)}
          </dd>
        </div>
        {!paid && item.paymentDueAt ? (
          <div className="flex items-baseline justify-between">
            <dt className="text-ink/60">ชำระภายใน</dt>
            <dd>{formatThaiDateTime(item.paymentDueAt)}</dd>
          </div>
        ) : null}
      </dl>

      {paid ? (
        <section className="flex flex-col gap-2 rounded-xl border border-success/35 bg-success/8 p-5 text-sm">
          <h2 className="font-semibold text-success">
            ชำระเงินเรียบร้อยแล้ว
          </h2>
          <p className="text-success/80">
            ขอบคุณครับ ทีมงานจะโอนเงินให้ผู้ขายและแจ้งให้จัดส่งสินค้าต่อไป
            {payment?.paidAt
              ? ` (ชำระเมื่อ ${formatThaiDateTime(payment.paidAt)})`
              : ""}
          </p>
        </section>
      ) : overdue ? (
        <section className="flex flex-col gap-2 rounded-xl border border-brand/30 bg-brand/[.05] p-5 text-sm">
          <h2 className="font-semibold text-brand-dark">
            หมดเวลาชำระเงินแล้ว
          </h2>
          <p className="text-brand-dark/80">
            สิทธิ์การซื้อถูกส่งต่อให้ผู้เสนอราคารายถัดไป
            และระบบได้บันทึกการไม่ชำระเงินไว้ในบัญชีของคุณ
          </p>
        </section>
      ) : (
        <PaymentPanel
          itemId={item.id}
          amount={item.currentPrice}
          publicKey={process.env.OMISE_PUBLIC_KEY ?? ""}
          windowHours={PAYMENT_WINDOW_HOURS}
          initialPayment={
            payment && payment.status !== "successful"
              ? {
                  id: payment.id,
                  status: payment.status,
                  method: payment.method,
                  qrDownloadUri: payment.qrDownloadUri,
                  expiresAt: payment.expiresAt?.toISOString() ?? null,
                  failureMessage: payment.failureMessage,
                }
              : null
          }
        />
      )}
    </main>
  );
}
