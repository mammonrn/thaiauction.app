/**
 * Ask Omise what happened to the recipients and the transfers.
 *
 * The payout half of the charge reconcile sweep, and it exists for the same
 * reason: Omise does not guarantee webhook delivery, this project has no
 * endpoint to receive them, and so nothing is ever believed about money until
 * it has been read back from the API.
 *
 * Three jobs, all idempotent:
 *
 *   - create recipients that are still missing (a save that could not reach
 *     Omise, or a seller who predates the feature);
 *   - poll the recipients Omise has not finished checking, and tell the seller
 *     when it passes or fails;
 *   - poll the transfers that have not landed, and adopt any transfer that
 *     exists at Omise with no local record of it.
 *
 *   npm run payouts:reconcile
 *
 * Suggested crontab — every 15 minutes. Recipient verification takes Omise a
 * day or two, so nothing here is urgent; the interval is set by the transfer
 * poll, where a seller asking "has it gone yet" deserves an answer that is not
 * an hour old:
 *   asterisk/15 * * * * cd /srv/thaiauction && /usr/bin/npm run payouts:reconcile >> /var/log/thaiauction-payouts.log 2>&1
 */
import {
  backfillRecipients,
  reconcileRecipients,
  reconcileTransfers,
  recipientPayoutsEnabled,
} from "../lib/payouts";

async function main() {
  if (!recipientPayoutsEnabled()) {
    console.log("[reconcile-payouts] PAYOUT_RECIPIENTS_ENABLED is not set — nothing to do");
    return;
  }

  const stamp = new Date().toISOString();
  const created = await backfillRecipients();
  const recipients = await reconcileRecipients();
  const transfers = await reconcileTransfers();

  console.log(
    `[reconcile-payouts] ${stamp} recipients created ${created.created}/${created.considered}, ` +
      `checked ${recipients.checked} (verified ${recipients.verified}, failed ${recipients.failed}), ` +
      `transfers checked ${transfers.checked} (sent ${transfers.sent}, paid ${transfers.paid}, ` +
      `failed ${transfers.failed}, adopted ${transfers.adopted})`,
  );
}

main()
  .catch((error) => {
    console.error("[reconcile-payouts] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
