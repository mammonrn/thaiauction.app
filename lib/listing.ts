import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Reading the marketplace.
 *
 * Shared by the home grid and the search results so both obey exactly the same
 * visibility rule: only `active` listings, never drafts. This module is
 * read-only — it adds no behaviour to bidding, settlement or payment.
 */

export const PAGE_SIZE = 24;

export const SORTS = {
  newest: "ใหม่ล่าสุด",
  ending: "ใกล้หมดเวลา",
  cheapest: "ราคาต่ำสุด",
  dearest: "ราคาสูงสุด",
} as const;

export type SortKey = keyof typeof SORTS;

export function parseSort(value: string | undefined): SortKey {
  return value && value in SORTS ? (value as SortKey) : "newest";
}

/**
 * Auctions with no closing time sort LAST under "ใกล้หมดเวลา".
 *
 * They are open-ended, so they are never the most urgent thing on the page;
 * without `nulls: "last"` PostgreSQL would rank them first and the sort would
 * say the opposite of what it promises.
 */
function orderBy(sort: SortKey): Prisma.AuctionItemOrderByWithRelationInput[] {
  switch (sort) {
    case "ending":
      return [{ endTime: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }];
    case "cheapest":
      return [{ currentPrice: "asc" }, { createdAt: "desc" }];
    case "dearest":
      return [{ currentPrice: "desc" }, { createdAt: "desc" }];
    default:
      return [{ createdAt: "desc" }];
  }
}

export type ListingQuery = {
  categorySlug?: string;
  search?: string;
  sort: SortKey;
  page: number;
};

const CARD_FIELDS = {
  id: true,
  title: true,
  images: true,
  currentPrice: true,
  endTime: true,
  condition: true,
  category: { select: { name: true, slug: true } },
  _count: { select: { bids: true } },
} as const;

export type ListingCard = Prisma.AuctionItemGetPayload<{
  select: typeof CARD_FIELDS;
}>;

export async function findListings(query: ListingQuery): Promise<{
  items: ListingCard[];
  total: number;
  pageCount: number;
}> {
  const where: Prisma.AuctionItemWhereInput = {
    status: "active",
    // Settlement is lazy — an auction stays `active` until someone reads it or
    // the sweep runs — so a listing filtered on status alone briefly shows
    // items reading "หมดเวลาแล้ว" as though they could still be bid on. This
    // is a display filter only; nothing here settles anything.
    OR: [{ endTime: null }, { endTime: { gt: new Date() } }],
    ...(query.categorySlug ? { category: { slug: query.categorySlug } } : {}),
    // Case-insensitive substring match. Thai has no case, so `insensitive`
    // only matters for the Latin titles that appear alongside; a trigram or
    // full-text index is the answer if this ever gets slow, not a bigger query.
    ...(query.search
      ? { title: { contains: query.search, mode: "insensitive" } }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.auctionItem.findMany({
      where,
      orderBy: orderBy(query.sort),
      skip: (query.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: CARD_FIELDS,
    }),
    prisma.auctionItem.count({ where }),
  ]);

  return { items, total, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

/** The closing-soonest live auctions, for the home page rail. */
export async function findClosingSoon(take = 8): Promise<ListingCard[]> {
  return prisma.auctionItem.findMany({
    where: { status: "active", endTime: { not: null, gt: new Date() } },
    orderBy: { endTime: "asc" },
    take,
    select: CARD_FIELDS,
  });
}

export async function findCategoriesWithCounts() {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    select: {
      name: true,
      slug: true,
      _count: { select: { auctionItems: { where: { status: "active" } } } },
    },
  });
  // A category with nothing live in it is a dead end, so it is not offered.
  return categories.filter((c) => c._count.auctionItems > 0);
}
