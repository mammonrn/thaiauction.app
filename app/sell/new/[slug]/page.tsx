import Link from "next/link";
import { notFound } from "next/navigation";

import { createAuctionAction } from "@/app/sell/actions";
import { AuctionForm } from "@/components/auction-form";
import { DEFAULT_BID_INCREMENT_SATANG } from "@/lib/auction-rules";
import { CategoryIcon } from "@/lib/category-icons";
import { satangToBaht } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { requireVerifiedSeller } from "@/lib/seller";
import { MAX_IMAGES_PER_ITEM } from "@/lib/uploads";

/**
 * Step two: everything else, with the category already answered.
 *
 * The slug is in the URL rather than a query string so the back button returns
 * to the picker, and so a half-filled form survives a reload.
 */
export default async function NewAuctionPage({
  params,
}: PageProps<"/sell/new/[slug]">) {
  await requireVerifiedSeller("/sell/new");
  const { slug } = await params;

  const category = await prisma.category.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true },
  });
  if (!category) notFound();

  // Request time, handed to the date picker so its "too soon" hint is measured
  // against the same clock the Server Action validates with.
  //
  // react-hooks/purity targets client components that may re-render at any
  // moment. This is an async Server Component on a dynamic route: it runs once
  // per request, and reading the clock is exactly what it should do.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-2">
        <Link
          href="/sell/new"
          className="text-sm text-ink/60 underline-offset-4 hover:underline"
        >
          ← เลือกหมวดหมู่
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">ลงสินค้าประมูล</h1>
      </div>

      {/* The answer from step one, kept visible and changeable. A choice that
          disappears once made leaves the seller wondering what they picked. */}
      <Link
        href="/sell/new"
        className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 transition-colors hover:bg-brand/[.04]"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/[.08] text-brand">
          <CategoryIcon slug={category.slug} className="h-5 w-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs text-ink/50">หมวดหมู่</span>
          <span className="truncate font-medium">{category.name}</span>
        </span>
        <span className="shrink-0 text-sm text-brand">เปลี่ยน</span>
      </Link>

      <div className="rounded-xl bg-white p-4 sm:p-6">
        <AuctionForm
          action={createAuctionAction}
          category={category}
          maxImages={MAX_IMAGES_PER_ITEM}
          now={now}
          draftLabel="บันทึกฉบับร่าง"
          canPublish
          initial={{
            categoryId: category.id,
            condition: "",
            title: "",
            description: "",
            startPrice: "",
            buyNowPrice: "",
            bidIncrement: String(satangToBaht(DEFAULT_BID_INCREMENT_SATANG)),
            timed: false,
            endTime: "",
            images: [],
          }}
        />
      </div>
    </main>
  );
}
