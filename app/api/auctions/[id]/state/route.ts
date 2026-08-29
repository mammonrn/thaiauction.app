import { minimumBid } from "@/lib/auction-rules";
import { settleIfExpired } from "@/lib/bidding";
import { maskName } from "@/lib/mask-name";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Live state for an auction, polled by the detail page.
 *
 * Polling a small JSON endpoint rather than SSE or WebSockets: this is a single
 * VPS running one Node process, and a few-second delay on a price is fine for
 * an auction that runs for hours. Sockets would add connection management and a
 * sticky-session constraint for no benefit at this size.
 *
 * Reading also settles an auction whose clock has run out, so ordinary traffic
 * closes most auctions without waiting for the sweep.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  await settleIfExpired(id);

  const item = await prisma.auctionItem.findFirst({
    where: { id, deletedAt: null, status: { in: ["active", "ended", "cancelled"] } },
    select: {
      currentPrice: true,
      bidIncrement: true,
      buyNowPrice: true,
      status: true,
      endTime: true,
      endedAt: true,
      endReason: true,
      winner: { select: { name: true } },
      _count: { select: { bids: true } },
      bids: {
        orderBy: { amount: "desc" },
        take: 1,
        select: { bidder: { select: { name: true } } },
      },
    },
  });

  if (!item) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return Response.json(
    {
      currentPrice: item.currentPrice,
      minimumBid: minimumBid({
        currentPrice: item.currentPrice,
        bidIncrement: item.bidIncrement,
        buyNowPrice: item.buyNowPrice,
      }),
      buyNowPrice: item.buyNowPrice,
      bidCount: item._count.bids,
      status: item.status,
      endReason: item.endReason,
      endTime: item.endTime?.toISOString() ?? null,
      endedAt: item.endedAt?.toISOString() ?? null,
      leader: item.bids[0] ? maskName(item.bids[0].bidder.name) : null,
      winner: item.winner ? maskName(item.winner.name) : null,
      // So the countdown measures against the server's clock, not a device
      // whose time may be wrong.
      serverNow: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
