import { failureMessage } from "@/lib/omise-failures";
import { refreshPayment } from "@/lib/payments";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Live state for one payment attempt, polled by the pay page.
 *
 * Reading re-asks Omise (Retrieve Charge) whenever the attempt is still
 * pending, which is how a scanned PromptPay QR turns into a settled auction.
 * The project has no webhook endpoint by design — Omise's docs say webhook
 * deliveries are not guaranteed to be retried and that verifying through the
 * API is the alternative — so this poll IS the confirmation mechanism, not a
 * convenience layered on top of one.
 *
 * Only the payer may read it. Anyone else, signed in or not, gets 404: a
 * payment id should not be a way to find out that a payment exists.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();

  if (!session) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const owned = await prisma.payment.findFirst({
    where: { id, payerId: session.user.id },
    select: { id: true },
  });
  if (!owned) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // Best effort: a gateway hiccup must not break the page the buyer is
  // watching. The stored status is still returned, and the next poll retries.
  try {
    await refreshPayment(id);
  } catch (error) {
    console.error(`[payment-state] refresh failed for ${id}:`, error);
  }

  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      method: true,
      amount: true,
      qrDownloadUri: true,
      authorizeUri: true,
      expiresAt: true,
      failureCode: true,
      failureMessage: true,
      auctionItemId: true,
    },
  });

  return Response.json(
    {
      status: payment.status,
      method: payment.method,
      amount: payment.amount,
      qrDownloadUri: payment.qrDownloadUri,
      // Only ever returned to the payer, whose ownership was checked above.
      // It is a single-use authorisation link, not a credential.
      authorizeUri: payment.authorizeUri,
      expiresAt: payment.expiresAt?.toISOString() ?? null,
      // Omise's raw English message is kept in the database for the audit
      // trail; what the buyer sees is the Thai explanation for that code.
      failureMessage:
        payment.status === "failed"
          ? failureMessage(payment.failureCode, payment.failureMessage)
          : null,
      auctionItemId: payment.auctionItemId,
      serverNow: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
