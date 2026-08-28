import Link from "next/link";
import { notFound } from "next/navigation";

import { updateAuctionAction } from "@/app/sell/actions";
import { AuctionForm } from "@/components/auction-form";
import { PublishControls } from "@/components/publish-controls";
import { editLockReason, isEditable } from "@/lib/auction-rules";
import { satangToBaht } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { MAX_IMAGES_PER_ITEM, imageUrl } from "@/lib/uploads";

/** "2026-08-28T14:30" for a datetime-local input, in local time. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
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
    include: { _count: { select: { bids: true } } },
  });

  if (!item) notFound();

  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const editable = isEditable({
    status: item.status,
    bidCount: item._count.bids,
  });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-2">
        <Link
          href="/sell"
          className="text-sm text-black/60 underline-offset-4 hover:underline dark:text-white/60"
        >
          ← กลับรายการสินค้าของฉัน
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{item.title}</h1>
        {created ? (
          <p className="text-sm text-green-700 dark:text-green-400">
            บันทึกฉบับร่างแล้ว ตรวจทานอีกครั้งแล้วกดเผยแพร่ได้เลย
          </p>
        ) : null}
      </div>

      <PublishControls itemId={item.id} status={item.status} />

      {editable ? (
        <AuctionForm
          action={updateAuctionAction}
          categories={categories}
          maxImages={MAX_IMAGES_PER_ITEM}
          submitLabel="บันทึกการแก้ไข"
          initial={{
            itemId: item.id,
            categoryId: item.categoryId,
            title: item.title,
            description: item.description,
            startPrice: String(satangToBaht(item.startPrice)),
            buyNowPrice:
              item.buyNowPrice === null ? "" : String(satangToBaht(item.buyNowPrice)),
            timed: item.endTime !== null,
            endTime: item.endTime ? toLocalInput(item.endTime) : "",
            images: item.images.map((key) => ({ key, url: imageUrl(key) })),
          }}
        />
      ) : (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-5 py-4 text-sm text-amber-800 dark:text-amber-300">
          {editLockReason({ status: item.status, bidCount: item._count.bids })}
        </p>
      )}
    </main>
  );
}
