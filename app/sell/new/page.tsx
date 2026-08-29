import Link from "next/link";

import { CategoryIcon, sortCategories } from "@/lib/category-icons";
import { prisma } from "@/lib/prisma";
import { requireVerifiedSeller } from "@/lib/seller";

export const metadata = { title: "เลือกหมวดหมู่" };

/**
 * Step one of listing something: what is it?
 *
 * A category was the first field of a long form, which is the wrong shape for
 * the question. It is the one answer that changes nothing else on screen but
 * decides where the listing lives, and it is answerable in a glance — so it
 * gets its own screen, as a grid you point at rather than a select you scroll.
 *
 * Icons carry the scanning here; the labels confirm. Grids of pure text force
 * reading every cell, which is exactly what a seller holding a phone with one
 * hand will not do.
 */
export default async function ChooseCategoryPage() {
  // Redirects to /account/phone when the seller has no verified number.
  await requireVerifiedSeller("/sell/new");

  const categories = sortCategories(
    await prisma.category.findMany({ select: { id: true, name: true, slug: true } }),
  );

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-2">
        <Link
          href="/sell"
          className="text-sm text-ink/60 underline-offset-4 hover:underline"
        >
          ← สินค้าของฉัน
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          ลงขายอะไรดี?
        </h1>
      </div>

      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3">
        {categories.map((category) => (
          <li key={category.id}>
            <Link
              href={`/sell/new/${category.slug}`}
              className="flex h-full flex-col items-center gap-2 rounded-xl bg-white px-2 py-4 text-center transition-colors hover:bg-brand/[.06]"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand/[.08] text-brand">
                <CategoryIcon slug={category.slug} className="h-6 w-6" />
              </span>
              <span className="text-xs leading-tight text-ink/80">
                {category.name}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
