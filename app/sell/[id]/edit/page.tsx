import Link from "next/link";
import { notFound } from "next/navigation";

import { updateAuctionAction } from "@/app/sell/actions";
import { AuctionForm } from "@/components/auction-form";
import { PublishControls } from "@/components/publish-controls";
import { editLockReason, isEditable } from "@/lib/auction-rules";
import { formatBaht, satangToBaht } from "@/lib/money";
import {
  formatThaiDateTime,
  thaiDateTimeInputValue,
} from "@/lib/thai-datetime";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { MAX_IMAGES_PER_ITEM, imageUrl } from "@/lib/uploads";

/**
 * "2026-08-28T14:30" to seed the date picker.
 *
 * Bangkok, not the server's timezone: this runs in a Server Component, so on a
 * UTC VPS `getHours()` would seed the picker seven hours behind the closing
 * time the seller actually chose.
 */
function toLocalInput(date: Date): string {
  return thaiDateTimeInputValue(date);
}

export default async function EditAuctionPage({
  params,
  searchParams,
}: PageProps<"/sell/[id]/edit">) {
  const { user } = await requireSession("/sell");
  const { id } = await params;
  const { created } = await searchParams;

  // Scoped to the owner: another seller's id simply does not resolve.
  const item = await prisma.auctionItem.findFirst({
    where: { id, sellerId: user.id },
    include: {
      _count: { select: { bids: true } },
      category: { select: { name: true } },
    },
  });

  if (!item) notFound();

  // Request time, handed to the date picker so its "too soon" hint is measured
  // against the same clock the Server Action validates with.
  //
  // react-hooks/purity targets client components that may re-render at any
  // moment. This is an async Server Component on a dynamic route: it runs once
  // per request, and reading the clock is exactly what it should do.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const editable = isEditable({
    status: item.status,
    bidCount: item._count.bids,
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
        <h1 className="text-2xl font-semibold tracking-tight">{item.title}</h1>
        {created ? (
          <p className="text-sm text-success">
            บันทึกฉบับร่างแล้ว ตรวจทานอีกครั้งแล้วกดเผยแพร่ได้เลย
          </p>
        ) : null}
      </div>

      {/* PublishControls unmounts the moment the item leaves draft, taking its
          success message with it. This banner is the durable confirmation that
          publishing worked, and the way to the live listing. */}
      {item.status === "active" ? (
        <p className="flex flex-wrap items-center gap-2 rounded-xl border border-success/35 bg-success/12 px-5 py-4 text-sm text-success">
          เผยแพร่แล้ว — กำลังประมูลอยู่
          <Link
            href={`/auctions/${item.id}`}
            className="underline underline-offset-4"
          >
            ดูหน้าสาธารณะ
          </Link>
        </p>
      ) : null}

      <PublishControls
        itemId={item.id}
        status={item.status}
        summary={{
          title: item.title,
          categoryName: item.category.name,
          imageUrls: item.images.map(imageUrl),
          startPrice: formatBaht(item.startPrice),
          buyNowPrice:
            item.buyNowPrice === null ? null : formatBaht(item.buyNowPrice),
          bidIncrement: `ครั้งละ ${formatBaht(item.bidIncrement)}`,
          endTimeLabel: item.endTime
            ? formatThaiDateTime(item.endTime)
            : "ไม่ระบุเวลาจบ (ผู้ขายปิดเอง)",
        }}
      />

      {editable ? (
        <div className="rounded-xl bg-white p-4 sm:p-6">
  <AuctionForm
            action={updateAuctionAction}
            categories={categories}
            maxImages={MAX_IMAGES_PER_ITEM}
            now={now}
            draftLabel={
              item.status === "draft" ? "บันทึกฉบับร่าง" : "บันทึกการแก้ไข"
            }
            canPublish={item.status === "draft"}
            initial={{
              itemId: item.id,
              condition: item.condition ?? "",
              categoryId: item.categoryId,
              title: item.title,
              description: item.description,
              startPrice: String(satangToBaht(item.startPrice)),
              buyNowPrice:
                item.buyNowPrice === null ? "" : String(satangToBaht(item.buyNowPrice)),
              bidIncrement: String(satangToBaht(item.bidIncrement)),
              timed: item.endTime !== null,
              endTime: item.endTime ? toLocalInput(item.endTime) : "",
              images: item.images.map((key) => ({ key, url: imageUrl(key) })),
            }}
          />
      </div>
      ) : (
        <p className="rounded-xl border border-warning/35 bg-warning/12 px-5 py-4 text-sm text-warning">
          {editLockReason({ status: item.status, bidCount: item._count.bids })}
        </p>
      )}
    </main>
  );
}
