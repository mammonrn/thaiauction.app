import Link from "next/link";
import { notFound } from "next/navigation";

import { createAuctionAction } from "@/app/sell/actions";
import { AuctionForm } from "@/components/auction-form";
import { CategoryIcon } from "@/lib/category-icons";
import { relistSource } from "@/lib/failed-deal";
import { satangToBaht } from "@/lib/money";
import { requireVerifiedSeller } from "@/lib/seller";
import { imageUrl } from "@/lib/uploads";
import { MAX_IMAGES_PER_ITEM } from "@/lib/uploads";

export const metadata = { title: "ลงขายใหม่" };

/**
 * List a failed deal again, with the old listing filled in.
 *
 * The ORDINARY listing flow: the same form, the same Server Action, the same
 * validation. All this page does is arrive with the boxes already full, and
 * every one of them is editable before the seller confirms — a relist is a new
 * listing, not a repeat, and the price that failed to sell is often exactly the
 * thing to change.
 *
 * The old listing is not touched. Its bids, its strike and its place in the
 * seller's history stay where they are; this creates a new item beside it.
 *
 * Refused while a second-chance offer is live, because the same object cannot
 * be promised to a bidder and back on the block at the same time. The seller is
 * sent back to /sell rather than shown a form that would be refused on submit.
 */
export default async function RelistPage({
  params,
}: PageProps<"/sell/relist/[id]">) {
  const { user } = await requireVerifiedSeller("/sell");
  const { id } = await params;

  const result = await relistSource(id, user.id);
  // Not theirs, not in that state, or already promised to somebody: all answer
  // the same way, as everywhere else something is addressable by a guessable id.
  if (!result.ok) notFound();
  const { source } = result;

  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-2">
        <Link
          href="/sell"
          className="text-sm text-ink/60 underline-offset-4 hover:underline"
        >
          ← สินค้าของฉัน
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">ลงขายใหม่</h1>
        <p className="text-sm text-ink/60">
          กรอกข้อมูลเดิมไว้ให้แล้ว แก้ได้ทุกช่องก่อนยืนยัน · รายการเดิมยังอยู่ในประวัติ
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-xl bg-white px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/[.08] text-brand">
          <CategoryIcon slug={source.categorySlug} className="h-5 w-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs text-ink/50">หมวดหมู่</span>
          <span className="truncate font-medium">{source.categoryName}</span>
        </span>
      </div>

      <div className="rounded-xl bg-white p-4 sm:p-6">
        <AuctionForm
          action={createAuctionAction}
          category={{ id: source.categoryId, name: source.categoryName }}
          maxImages={MAX_IMAGES_PER_ITEM}
          now={now}
          draftLabel="บันทึกฉบับร่าง"
          canPublish
          initial={{
            categoryId: source.categoryId,
            condition: source.condition,
            title: source.title,
            description: source.description,
            startPrice: String(satangToBaht(source.startPrice)),
            buyNowPrice:
              source.buyNowPrice === null ? "" : String(satangToBaht(source.buyNowPrice)),
            bidIncrement: String(satangToBaht(source.bidIncrement)),
            // Deliberately not carried over: the old auction's clock has no
            // bearing on the new one, and a stale date would be the one field
            // a seller forgets to change.
            timed: false,
            endTime: "",
            images: source.images.map((key) => ({ key, url: imageUrl(key) })),
          }}
        />
      </div>
    </main>
  );
}
