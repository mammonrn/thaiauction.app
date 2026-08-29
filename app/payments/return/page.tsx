import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PaymentReturn } from "@/components/payment-return";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export const metadata = { title: "ผลการชำระเงิน" };

/**
 * Where Omise sends the buyer back after a redirect payment.
 *
 * NOTHING about the outcome is taken from this request. Omise's own guidance
 * is that the return is a navigation, not a notification: it carries no proof,
 * it fires whether the buyer paid or pressed back, and a buyer can type the URL
 * themselves. So this page reads the payment id, checks the signed-in user owns
 * it, and then does exactly what the pay page's poll does — re-ask Omise.
 *
 * The polling is the same component in both places for that reason: a redirect
 * payment can still be `pending` when the buyer lands here, because the bank
 * confirms out of band. Showing "failed" at that moment would be a lie the
 * buyer would act on.
 */
export default async function PaymentReturnPage({
  searchParams,
}: PageProps<"/payments/return">) {
  const { p } = await searchParams;
  const paymentId = typeof p === "string" ? p : "";
  const { user } = await requireSession("/account/bids");

  if (!paymentId) notFound();

  // Scoped to the payer: a guessed id is indistinguishable from a missing one.
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, payerId: user.id },
    select: { id: true, auctionItemId: true, method: true },
  });
  if (!payment) notFound();

  // Card and PromptPay never redirect, so arriving here for one of them means
  // a hand-typed URL. Send them back to where their payment actually lives.
  if (payment.method !== "installment" && payment.method !== "shopeepay") {
    redirect(`/auctions/${payment.auctionItemId}/pay`);
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">ผลการชำระเงิน</h1>
      <PaymentReturn
        paymentId={payment.id}
        itemId={payment.auctionItemId}
      />
      <Link
        href={`/auctions/${payment.auctionItemId}`}
        className="text-sm text-ink/60 underline-offset-4 hover:underline"
      >
        ← กลับไปหน้ารายการ
      </Link>
    </main>
  );
}
