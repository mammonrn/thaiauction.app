import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatBaht } from "@/lib/money";
import { formatThaiDateTime } from "@/lib/thai-datetime";
import { prisma } from "@/lib/prisma";
import { imageUrl } from "@/lib/uploads";

/** Rendered on the server, so "time left" is computed against server time. */
function timeLeft(endTime: Date | null): string {
  if (!endTime) return "ไม่ระบุเวลาจบ — ผู้ขายเป็นผู้ปิดการประมูล";

  const ms = endTime.getTime() - Date.now();
  if (ms <= 0) return "หมดเวลาแล้ว";

  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);

  if (days > 0) return `เหลืออีก ${days} วัน ${hours} ชั่วโมง`;
  if (hours > 0) return `เหลืออีก ${hours} ชั่วโมง ${minutes} นาที`;
  return `เหลืออีก ${minutes} นาที`;
}

export default async function AuctionDetailPage({
  params,
}: PageProps<"/auctions/[id]">) {
  const { id } = await params;

  // Drafts are private: this page only ever resolves a published listing, so a
  // leaked draft id shows nothing.
  const item = await prisma.auctionItem.findFirst({
    where: { id, status: { in: ["active", "ended"] } },
    include: {
      category: { select: { name: true, slug: true } },
      seller: { select: { name: true, image: true } },
      _count: { select: { bids: true } },
    },
  });

  if (!item) notFound();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-16">
      <Link
        href="/"
        className="text-sm text-black/60 underline-offset-4 hover:underline dark:text-white/60"
      >
        ← กลับหน้าแรก
      </Link>

      <div className="grid gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="relative aspect-square overflow-hidden rounded-xl bg-black/5 dark:bg-white/10">
            {item.images[0] ? (
              <Image
                src={imageUrl(item.images[0])}
                alt={item.title}
                fill
                sizes="(min-width: 768px) 50vw, 100vw"
                className="object-cover"
                priority
                unoptimized
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-black/40 dark:text-white/40">
                ไม่มีรูปภาพ
              </div>
            )}
          </div>

          {item.images.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {item.images.slice(1).map((key) => (
                <div
                  key={key}
                  className="relative h-20 w-20 overflow-hidden rounded-lg border border-black/10 dark:border-white/15"
                >
                  <Image
                    src={imageUrl(key)}
                    alt=""
                    fill
                    sizes="80px"
                    className="object-cover"
                    unoptimized
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="text-sm text-black/60 dark:text-white/60">
              {item.category.name}
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">
              {item.title}
            </h1>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-black/10 p-5 dark:border-white/15">
            <span className="text-sm text-black/60 dark:text-white/60">
              ราคาปัจจุบัน
            </span>
            <span className="text-3xl font-semibold">
              {formatBaht(item.currentPrice)}
            </span>
            <span className="text-sm text-black/60 dark:text-white/60">
              เปิดที่ {formatBaht(item.startPrice)} · {item._count.bids} การเสนอราคา
            </span>
            {item.buyNowPrice !== null ? (
              <span className="mt-2 text-sm">
                ซื้อทันทีที่ {formatBaht(item.buyNowPrice)}
              </span>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">
              {item.status === "ended" ? "จบการประมูลแล้ว" : timeLeft(item.endTime)}
            </span>
            {item.endTime ? (
              <span className="text-xs text-black/50 dark:text-white/50">
                จบ {formatThaiDateTime(item.endTime)}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-3 border-t border-black/10 pt-5 dark:border-white/15">
            {item.seller.image ? (
              <Image
                src={item.seller.image}
                alt=""
                width={40}
                height={40}
                className="rounded-full"
                unoptimized
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/10 text-sm font-medium dark:bg-white/15"
              >
                {item.seller.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex flex-col">
              <span className="text-sm font-medium">{item.seller.name}</span>
              <span className="text-xs text-black/50 dark:text-white/50">
                ผู้ขาย · ยืนยันเบอร์โทรแล้ว
              </span>
            </div>
          </div>

          {/* Bidding lands in the next phase. */}
          <p className="rounded-lg border border-dashed border-black/20 px-4 py-3 text-sm text-black/60 dark:border-white/20 dark:text-white/60">
            ระบบเสนอราคาจะเปิดให้ใช้งานเร็วๆ นี้
          </p>
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">รายละเอียดสินค้า</h2>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-black/80 dark:text-white/80">
          {item.description}
        </p>
      </section>
    </main>
  );
}
