import Link from "next/link";

import { AuctionForm } from "@/components/auction-form";
import { createAuctionAction } from "@/app/sell/actions";
import { prisma } from "@/lib/prisma";
import { requireVerifiedSeller } from "@/lib/seller";
import { MAX_IMAGES_PER_ITEM } from "@/lib/uploads";
import { DEFAULT_BID_INCREMENT_SATANG } from "@/lib/auction-rules";
import { satangToBaht } from "@/lib/money";

export default async function NewAuctionPage() {
  // Redirects to /account/phone when the seller has no verified number.
  await requireVerifiedSeller("/sell/new");

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

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-2">
        <Link
          href="/sell"
          className="text-sm text-black/60 underline-offset-4 hover:underline dark:text-white/60"
        >
          ← กลับรายการสินค้าของฉัน
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">ลงสินค้าประมูล</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          บันทึกเป็นฉบับร่างก่อน แล้วค่อยตรวจทานและกดเผยแพร่
        </p>
      </div>

      <AuctionForm
        action={createAuctionAction}
        categories={categories}
        maxImages={MAX_IMAGES_PER_ITEM}
        now={now}
        submitLabel="บันทึกฉบับร่าง"
        initial={{
          categoryId: "",
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
    </main>
  );
}
