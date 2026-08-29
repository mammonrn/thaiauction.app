import "server-only";

import { activeBansFor, type ActiveBan } from "@/lib/bans";
import { prisma } from "@/lib/prisma";

/**
 * Everyone who has an account, in one list.
 *
 * ONE ROW PER PERSON. The obvious alternative — a buyers page and a sellers
 * page — puts anyone who does both in two places, and then the two pages
 * disagree about how many members there are. Roles are badges on a row, not
 * separate lists, so "how many members" has one answer and a dual-role account
 * is visibly one account.
 *
 * The two roles are defined by what somebody has DONE, not by what they could
 * do:
 *
 *   buyer  — has bid at least once. Not "has a verified phone": verifying a
 *            number is something you do before bidding, and counting it would
 *            make everyone who got as far as the OTP a buyer.
 *   seller — has passed KYC. Not "has a listing": approval is the moment the
 *            marketplace accepted them as a seller, and someone approved who
 *            has not got round to listing is still a seller.
 *
 * Neither is exclusive, and neither is required — an account that signed up and
 * stopped has no badge and is still in the list, because it is still a member.
 */

/** What a row is, once both questions have been asked of it. */
export type MemberRole = "buyer" | "seller" | "both" | "none";

/**
 * What the filter can ask for.
 *
 * "buyer" means HAS the buyer role, not "is only a buyer" — an admin looking
 * for people who bid wants everyone who bids, including the ones who also
 * sell. "both" then narrows to the overlap. The filters deliberately overlap;
 * making them exclusive would mean the seller filter hid half the sellers.
 */
export type RoleFilter = "all" | "buyer" | "seller" | "both";

export function parseRoleFilter(value: string | undefined): RoleFilter {
  return value === "buyer" || value === "seller" || value === "both"
    ? value
    : "all";
}

/**
 * Rows per page.
 *
 * Small enough that the page stays one screen of scrolling on a phone, which
 * is what the count is for: the alternative — every member at once — is a page
 * that works until the marketplace succeeds and then stops working.
 */
export const MEMBERS_PER_PAGE = 25;

export type MemberKyc = "approved" | "pending" | "rejected";

export type MemberRow = {
  id: string;
  name: string;
  email: string;
  /** The first number they verified, or null. */
  phone: string | null;
  phoneVerified: boolean;
  role: MemberRole;
  /**
   * The state of their LATEST identity submission, or null if they never made
   * one. Shown for anyone who has submitted rather than only for sellers:
   * restricted to sellers it could only ever read "ผ่านแล้ว", since passing is
   * what makes someone a seller — and "รอตรวจ" and "ไม่ผ่าน" are the two
   * states an admin actually needs to see from here.
   */
  kyc: MemberKyc | null;
  /** Every ban in force on this account right now. */
  bans: ActiveBan[];
  createdAt: Date;
};

export type MemberPage = {
  rows: MemberRow[];
  total: number;
  page: number;
  pageCount: number;
};

/** Digits only, so "081-234-5678" and "0812345678" find the same person. */
function phoneDigits(search: string): string {
  return search.replace(/\D/g, "");
}

/**
 * The member list, searched, filtered and paginated.
 *
 * The role filter is expressed as relation conditions rather than a stored
 * column, so it can never disagree with the badges: the same two facts decide
 * both. It costs a subquery each, which on an admin page reading twenty-five
 * rows is the right trade against a denormalised column that goes stale the
 * first time somebody bids.
 */
export async function listMembers(params: {
  search?: string;
  role?: RoleFilter;
  page?: number;
}): Promise<MemberPage> {
  const search = (params.search ?? "").trim();
  const role = params.role ?? "all";
  const page = Math.max(1, params.page ?? 1);

  const hasBid = { bids: { some: {} } };
  const isApproved = {
    sellerVerifications: { some: { status: "approved" as const } },
  };

  const roleWhere =
    role === "buyer"
      ? hasBid
      : role === "seller"
        ? isApproved
        : role === "both"
          ? { AND: [hasBid, isApproved] }
          : {};

  const digits = phoneDigits(search);
  const searchWhere = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
          // Only when the query looks like part of a number: a bare "0" would
          // otherwise match every Thai mobile in the table.
          ...(digits.length >= 3
            ? [{ verifiedPhones: { some: { phone: { contains: digits } } } }]
            : []),
        ],
      }
    : {};

  const where = { AND: [roleWhere, searchWhere] };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      // Newest first: an admin opening this page is usually looking at who has
      // just arrived, and the alphabet answers no question anyone has.
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * MEMBERS_PER_PAGE,
      take: MEMBERS_PER_PAGE,
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        verifiedPhones: {
          orderBy: { verifiedAt: "asc" },
          take: 1,
          select: { phone: true },
        },
        // Every submission, not just the newest: the badge asks "was one ever
        // approved" and the column asks "what happened to the last one", and a
        // person can have both a rejection and an approval. There are never
        // more than a handful of rows per account.
        sellerVerifications: {
          orderBy: { submittedAt: "desc" },
          select: { status: true },
        },
        _count: { select: { bids: true } },
      },
    }),
  ]);

  const bans = await activeBansFor(users.map((user) => user.id));

  const rows: MemberRow[] = users.map((user) => {
    const isBuyer = user._count.bids > 0;
    const isSeller = user.sellerVerifications.some(
      (entry) => entry.status === "approved",
    );

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.verifiedPhones[0]?.phone ?? null,
      phoneVerified: user.verifiedPhones.length > 0,
      role:
        isBuyer && isSeller
          ? "both"
          : isBuyer
            ? "buyer"
            : isSeller
              ? "seller"
              : "none",
      kyc: user.sellerVerifications[0]?.status ?? null,
      bans: bans.get(user.id) ?? [],
      createdAt: user.createdAt,
    };
  });

  return {
    rows,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / MEMBERS_PER_PAGE)),
  };
}

export const ROLE_LABEL: Record<MemberRole, string> = {
  buyer: "ผู้ซื้อ",
  seller: "ผู้ขาย",
  both: "ผู้ซื้อ · ผู้ขาย",
  none: "ยังไม่เริ่มใช้งาน",
};

export const ROLE_FILTER_LABEL: Record<RoleFilter, string> = {
  all: "ทั้งหมด",
  buyer: "ผู้ซื้อ",
  seller: "ผู้ขาย",
  both: "ทั้งสอง",
};

export const KYC_LABEL: Record<MemberKyc, string> = {
  approved: "ผ่านแล้ว",
  pending: "รอตรวจ",
  rejected: "ไม่ผ่าน",
};
