import "server-only";

import {
  isReportReason,
  MAX_REPORT_NOTE,
  type ReportReason,
} from "@/lib/moderation-labels";
import { prisma } from "@/lib/prisma";

export {
  isReportReason,
  MAX_REPORT_NOTE,
  REPORT_REASONS,
  REPORT_REASON_LABEL,
  type ReportReason,
} from "@/lib/moderation-labels";

/**
 * Reporting a listing, and taking one down.
 *
 * Nothing here touches lib/bidding.ts. Removing a listing that still owes
 * somebody an item is refused outright rather than reached around — see
 * `deleteItem`.
 */

export type ReportFailure =
  | "not_found"
  | "own_item"
  | "invalid_reason"
  | "note_too_long";

export type ReportResult =
  | { ok: true; alreadyReported: boolean }
  | { ok: false; reason: ReportFailure };

/**
 * Record one person's report of one listing.
 *
 * Reporting twice UPDATES the existing row rather than adding one. The number
 * an admin triages by has to mean "how many different people", or a single
 * determined reporter could push any listing to the top of the queue by
 * pressing the button repeatedly. The unique index on
 * (auctionItemId, reporterId) is what enforces it; the upsert is how a second
 * attempt is handled gracefully instead of erroring.
 *
 * A re-report also reopens a dismissed one: the reporter is saying it is still
 * wrong, and an admin should see it again rather than have it stay filed.
 */
export async function reportItem(params: {
  itemId: string;
  reporterId: string;
  reason: string;
  note?: string;
}): Promise<ReportResult> {
  if (!isReportReason(params.reason)) {
    return { ok: false, reason: "invalid_reason" };
  }

  const note = (params.note ?? "").trim();
  if (note.length > MAX_REPORT_NOTE) {
    return { ok: false, reason: "note_too_long" };
  }

  const item = await prisma.auctionItem.findFirst({
    // A draft is not public and a removed one is already gone; neither is
    // something a stranger should be able to confirm the existence of.
    where: {
      id: params.itemId,
      deletedAt: null,
      status: { in: ["active", "ended", "cancelled"] },
    },
    select: { id: true, sellerId: true },
  });
  if (!item) return { ok: false, reason: "not_found" };

  // Reporting your own listing is either a mistake or an attempt to make the
  // queue meaningless. Either way it is not a signal.
  if (item.sellerId === params.reporterId) {
    return { ok: false, reason: "own_item" };
  }

  const existing = await prisma.itemReport.findUnique({
    where: {
      auctionItemId_reporterId: {
        auctionItemId: item.id,
        reporterId: params.reporterId,
      },
    },
    select: { id: true },
  });

  await prisma.itemReport.upsert({
    where: {
      auctionItemId_reporterId: {
        auctionItemId: item.id,
        reporterId: params.reporterId,
      },
    },
    create: {
      auctionItemId: item.id,
      reporterId: params.reporterId,
      reason: params.reason as ReportReason,
      note: note || null,
    },
    update: {
      reason: params.reason as ReportReason,
      note: note || null,
      status: "open",
      reviewedAt: null,
      reviewedById: null,
    },
  });

  return { ok: true, alreadyReported: existing !== null };
}

export type DeleteItemFailure =
  | "not_found"
  | "already_deleted"
  | "awaiting_payment"
  | "no_reason";

export type DeleteItemResult =
  | { ok: true }
  | { ok: false; reason: DeleteItemFailure };

/**
 * Take a listing down.
 *
 * Soft: the row stays, `deletedAt` is stamped, and every public query filters
 * on it. A hard DELETE would take the bids, payments and reports with it —
 * including the evidence the removal was based on — and would blank a buyer's
 * own history of an auction they took part in.
 *
 * REFUSED while `awaiting_payment`. Somebody has won that item and their
 * 24-hour clock is running; removing it under them would leave a live payment
 * obligation pointing at a listing nobody can see, and a buyer who paid
 * seconds later would have paid for nothing. The admin closes the auction
 * first — the seller's own end-early mechanism, which settles the winner and
 * clears the obligation — and removes it afterwards.
 *
 * That refusal is enforced HERE and not by reaching into lib/bidding.ts: this
 * function only ever declines, and the closing is left to the code that
 * already owns the auction's row lock.
 */
export async function deleteItem(params: {
  itemId: string;
  adminId: string;
  reason: string;
}): Promise<DeleteItemResult> {
  const reason = params.reason.trim();
  if (!reason) return { ok: false, reason: "no_reason" };

  const item = await prisma.auctionItem.findUnique({
    where: { id: params.itemId },
    select: { id: true, deletedAt: true, paymentState: true },
  });
  if (!item) return { ok: false, reason: "not_found" };
  if (item.deletedAt) return { ok: false, reason: "already_deleted" };
  if (item.paymentState === "awaiting_payment") {
    return { ok: false, reason: "awaiting_payment" };
  }

  const { count } = await prisma.auctionItem.updateMany({
    // paymentState is in the WHERE as well as checked above, so a win landing
    // between the read and the write cannot be removed out from under itself.
    where: {
      id: item.id,
      deletedAt: null,
      paymentState: { not: "awaiting_payment" },
    },
    data: {
      deletedAt: new Date(),
      deletedById: params.adminId,
      deletedReason: reason,
    },
  });

  if (count === 0) return { ok: false, reason: "awaiting_payment" };

  // Every open report on it has now been acted on.
  await prisma.itemReport.updateMany({
    where: { auctionItemId: item.id, status: "open" },
    data: { status: "actioned", reviewedAt: new Date(), reviewedById: params.adminId },
  });

  return { ok: true };
}

/** Mark the open reports on a listing as looked at and rejected. */
export async function dismissReports(
  itemId: string,
  adminId: string,
): Promise<{ ok: boolean }> {
  const { count } = await prisma.itemReport.updateMany({
    where: { auctionItemId: itemId, status: "open" },
    data: { status: "dismissed", reviewedAt: new Date(), reviewedById: adminId },
  });
  return { ok: count > 0 };
}

/**
 * Listings with open reports, most-reported first.
 *
 * Counting DISTINCT reporters comes free: the unique index means one row per
 * person per listing, so a plain count already answers "how many people".
 */
export async function reportedItems(limit = 50) {
  const grouped = await prisma.itemReport.groupBy({
    by: ["auctionItemId"],
    where: { status: "open" },
    _count: { auctionItemId: true },
    orderBy: { _count: { auctionItemId: "desc" } },
    take: limit,
  });

  if (grouped.length === 0) return [];

  const items = await prisma.auctionItem.findMany({
    where: { id: { in: grouped.map((row) => row.auctionItemId) } },
    select: {
      id: true,
      title: true,
      images: true,
      status: true,
      paymentState: true,
      deletedAt: true,
      currentPrice: true,
      // Enough for an admin to judge without opening the listing: the cover
      // image, what the seller said it was, and which category they filed it
      // under. A report says a listing is wrong; deciding takes seeing it.
      description: true,
      category: { select: { name: true } },
      seller: { select: { id: true, name: true, email: true } },
      reports: {
        where: { status: "open" },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          reason: true,
          note: true,
          createdAt: true,
          reporter: { select: { name: true, email: true } },
        },
      },
    },
  });

  const byId = new Map(items.map((item) => [item.id, item]));
  return grouped
    .map((row) => {
      const item = byId.get(row.auctionItemId);
      return item ? { item, reportCount: row._count.auctionItemId } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}
