/**
 * Give every existing seller an Omise recipient. Run once, safely run again.
 *
 * Sellers who saved a bank account before automatic payouts existed have no
 * recipient, and a payout to them would be refused with "รอผู้ขายยืนยันบัญชี" —
 * which they cannot act on, because there is nothing for them to do. This
 * creates the missing ones.
 *
 * Idempotent because it selects on `omiseRecipientId IS NULL` and the write
 * that attaches an id is itself guarded on the column still being null. Running
 * it twice, or at the same time as the reconcile sweep, creates nothing twice.
 * That is also why it shares its implementation with the sweep rather than
 * having one of its own: a backfill that drifts from the steady state is a
 * backfill that stops matching what it is filling in for.
 *
 *   npm run payouts:backfill-recipients
 *
 * Creating a recipient does not make it usable — Omise still has to verify it,
 * and `npm run payouts:reconcile` is what notices when it has.
 */
import { backfillRecipients, recipientPayoutsEnabled } from "../lib/payouts";

async function main() {
  if (!recipientPayoutsEnabled()) {
    console.error(
      "[backfill-recipients] PAYOUT_RECIPIENTS_ENABLED is not set — refusing to create recipients for a flow that is switched off",
    );
    process.exitCode = 1;
    return;
  }

  const stamp = new Date().toISOString();
  const result = await backfillRecipients();
  console.log(
    `[backfill-recipients] ${stamp} considered ${result.considered}, created ${result.created}, failed ${result.failed}`,
  );
  if (result.failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[backfill-recipients] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
