import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EndAuctionButton } from "@/components/end-auction-button";
import { VerificationLevel } from "@/components/verification-level";
import { ImageGallery } from "@/components/image-gallery";
import { avatarUrl } from "@/lib/avatar";
import { VerifyPhoneDialog } from "@/components/verify-phone-dialog";
import { isStubMode } from "@/lib/thaibulksms";
import { isSellerVerified } from "@/lib/seller-verification";
import { LiveAuction } from "@/components/live-auction";
import { minimumBid } from "@/lib/auction-rules";
import { settleIfExpired } from "@/lib/bidding";
import { maskName } from "@/lib/mask-name";
import { countStrikesFor, STRIKE_LIMIT } from "@/lib/strikes";
import { formatBaht } from "@/lib/money";
import { formatThaiDateTime } from "@/lib/thai-datetime";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export default async function AuctionDetailPage({
  params,
}: PageProps<"/auctions/[id]">) {
  const { id } = await params;

  // Close it here if its clock has run out. Ordinary page views are the main
  // way auctions get settled; the cron sweep only catches the ones nobody
  // happens to open.
  await settleIfExpired(id);

  const session = await getSession();

  // Drafts are private: this page only ever resolves a published listing, so a
  // leaked draft id shows nothing. Cancelled ones stay readable so anyone who
  // bid can see what happened.
  const item = await prisma.auctionItem.findFirst({
    where: { id, status: { in: ["active", "ended", "cancelled"] } },
    include: {
      category: { select: { name: true, slug: true } },
      seller: { select: { id: true, name: true, image: true, avatarKey: true } },
      winner: { select: { name: true } },
      _count: { select: { bids: true } },
      bids: {
        orderBy: { amount: "desc" },
        take: 20,
        select: {
          id: true,
          amount: true,
          createdAt: true,
          bidderId: true,
          bidder: { select: { name: true } },
        },
      },
    },
  });

  if (!item) notFound();

  const viewerId = session?.user.id ?? null;
  const isSeller = viewerId === item.seller.id;

  // Payment-history badges are shown ONLY to the seller of this item, on their
  // own listing. A seller deciding whether to let an auction run to the wire
  // has a real interest in knowing a bidder has walked away from a win before;
  // everyone else does not, so this is never rendered publicly and never
  // exposed by the live-state API.
  const bidderStrikes = isSeller
    ? await countStrikesFor(item.bids.map((bid) => bid.bidderId))
    : new Map<string, number>();

  const sellerIdentityVerified = await isSellerVerified(item.seller.id);
  const sellerPhoneVerified =
    (await prisma.verifiedPhone.count({ where: { userId: item.seller.id } })) > 0;

  const verifiedPhones = viewerId
    ? await prisma.verifiedPhone.count({ where: { userId: viewerId } })
    : 0;

  const cannotBid = !viewerId
    ? "เข้าสู่ระบบเพื่อเสนอราคา"
    : isSeller
      ? "คุณเป็นผู้ขายรายการนี้ จึงเสนอราคาไม่ได้"
      : verifiedPhones === 0
        ? "เสนอราคาได้หลังยืนยันเบอร์โทรศัพท์"
        : null;

  // The one blocker a visitor can clear without leaving the page.
  const needsPhone = viewerId !== null && !isSeller && verifiedPhones === 0;

  // isStubMode() throws if the flag is set in production; treat that as "off"
  // so the page still renders and the action reports the real error.
  let stubMode = false;
  try {
    stubMode = isStubMode();
  } catch {
    stubMode = false;
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href="/"
        className="text-sm text-ink/60 underline-offset-4 hover:underline"
      >
        ← กลับหน้าแรก
      </Link>

      <div className="grid gap-8 rounded-xl bg-white p-4 sm:p-6 md:grid-cols-2">
        <ImageGallery keys={item.images} title={item.title} />

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="text-sm text-ink/60">
              {item.category.name}
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">
              {item.title}
            </h1>
          </div>

          <LiveAuction
            itemId={item.id}
            canBid={cannotBid === null}
            reasonCannotBid={cannotBid}
            bidBlockedAction={
              needsPhone ? (
                <VerifyPhoneDialog stubMode={stubMode} />
              ) : null
            }
            initial={{
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
              serverNow: new Date().toISOString(),
            }}
          />

          <p className="text-xs text-ink/50">
            เปิดที่ {formatBaht(item.startPrice)} · เพิ่มขั้นต่ำครั้งละ{" "}
            {formatBaht(item.bidIncrement)}
          </p>

          {/* Seller identity, with the trust badges. This block was lost in an
              earlier refactor of the price panel; restored here because the
              badges belong beside the person, not the price. */}
          <div className="flex items-center gap-3 border-t border-black/10 pt-5">
            {avatarUrl(item.seller) ? (
              <Image
                src={avatarUrl(item.seller)!}
                alt=""
                width={40}
                height={40}
                className="rounded-full"
                unoptimized
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/10 text-sm font-medium"
              >
                {item.seller.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">{item.seller.name}</span>
              <VerificationLevel
                facts={{
                  phoneVerified: sellerPhoneVerified,
                  identityVerified: sellerIdentityVerified,
                }}
              />
            </div>
          </div>

          {isSeller && item.status === "active" ? (
            <EndAuctionButton itemId={item.id} bidCount={item._count.bids} />
          ) : null}
        </div>
      </div>

      {item.bids.length > 0 ? (
        <section className="flex flex-col gap-3 rounded-xl bg-white p-4 sm:p-6">
          <h2 className="text-sm font-medium">
            ประวัติการเสนอราคา ({item._count.bids})
          </h2>
          <ul className="flex flex-col divide-y divide-black/5">
            {item.bids.map((bid, index) => (
              <li
                key={bid.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  {/* Names are masked: a full name next to a bid amount would
                      let anyone approach the underbidder off-platform or work
                      out a rival's budget. Your own bids are labelled. */}
                  <span className={index === 0 ? "font-medium" : undefined}>
                    {bid.bidderId === viewerId
                      ? "คุณ"
                      : maskName(bid.bidder.name)}
                  </span>
                  {index === 0 ? (
                    <span className="rounded-full bg-green-600/10 px-2 py-0.5 text-xs text-green-700">
                      สูงสุด
                    </span>
                  ) : null}
                  {(bidderStrikes.get(bid.bidderId) ?? 0) > 0 ? (
                    <span
                      title="ผู้ใช้รายนี้เคยชนะประมูลแล้วไม่ชำระเงินตามกำหนด (เห็นเฉพาะคุณในฐานะผู้ขาย)"
                      className="rounded-full bg-amber-600/15 px-2 py-0.5 text-xs text-amber-800"
                    >
                      ⚠ เคยไม่ชำระเงิน{" "}
                      {bidderStrikes.get(bid.bidderId)}/{STRIKE_LIMIT}
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">{formatBaht(bid.amount)}</span>
                  <span className="text-xs text-ink/50">
                    {formatThaiDateTime(bid.createdAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2 rounded-xl bg-white p-4 sm:p-6">
        <h2 className="text-sm font-medium">รายละเอียดสินค้า</h2>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink/80">
          {item.description}
        </p>
      </section>
    </main>
  );
}
