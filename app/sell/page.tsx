import Link from "next/link";
import Image from "next/image";

import { formatBaht } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { imageUrl } from "@/lib/uploads";

const STATUS_LABEL: Record<string, string> = {
  draft: "ฉบับร่าง",
  active: "กำลังประมูล",
  ended: "จบแล้ว",
  cancelled: "ยกเลิก",
};

export default async function SellPage() {
  const { user } = await requireSession("/sell");

  const items = await prisma.auctionItem.findMany({
    where: { sellerId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      images: true,
      currentPrice: true,
      status: true,
      endTime: true,
      category: { select: { name: true } },
      _count: { select: { bids: true } },
    },
  });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Link
            href="/"
            className="text-sm text-ink/60 underline-offset-4 hover:underline"
          >
            ← กลับหน้าแรก
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            สินค้าของฉัน
          </h1>
        </div>
        <Link
          href="/sell/new"
          className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
        >
          ลงสินค้าใหม่
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/20 px-5 py-12 text-center">
          <p className="font-medium">ยังไม่มีสินค้า</p>
          <p className="mt-1 text-sm text-ink/60">
            กด “ลงสินค้าใหม่” เพื่อเริ่มลงประมูลชิ้นแรก
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-4 rounded-xl bg-white p-4"
            >
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-black/5">
                {item.images[0] ? (
                  <Image
                    src={imageUrl(item.images[0])}
                    alt=""
                    fill
                    sizes="80px"
                    className="object-cover"
                    unoptimized
                  />
                ) : null}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{item.title}</span>
                  <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs">
                    {STATUS_LABEL[item.status] ?? item.status}
                  </span>
                </div>
                <span className="text-sm text-ink/60">
                  {item.category.name} · {formatBaht(item.currentPrice)} ·{" "}
                  {item._count.bids} การเสนอราคา
                </span>
              </div>

              <div className="flex shrink-0 gap-2">
                {item.status === "active" ? (
                  <Link
                    href={`/auctions/${item.id}`}
                    className="rounded-lg border border-black/15 px-3 py-1.5 text-sm transition hover:bg-black/5"
                  >
                    ดูหน้าสาธารณะ
                  </Link>
                ) : null}
                <Link
                  href={`/sell/${item.id}/edit`}
                  className="rounded-lg border border-black/15 px-3 py-1.5 text-sm transition hover:bg-black/5"
                >
                  จัดการ
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
