import { MAX_IMAGES_PER_ITEM, MIN_IMAGES_PER_ITEM } from "@/lib/image-keys";

/**
 * When a listing may still be changed.
 *
 * A draft is private, so it is freely editable. Once published, editing is
 * allowed only while nobody has bid: the moment a bid exists, the price and
 * description are what someone committed money against, and letting the seller
 * rewrite them afterwards is the classic bait-and-switch. An ended or cancelled
 * auction is history and is never edited.
 *
 * This deliberately locks the whole listing rather than only the price fields.
 * Swapping the photos or the description changes what was bid on just as much
 * as changing the number does.
 */
export type EditableCheck = {
  status: "draft" | "active" | "ended" | "cancelled";
  bidCount: number;
};

export function isEditable({ status, bidCount }: EditableCheck): boolean {
  if (status === "draft") return true;
  if (status === "active") return bidCount === 0;
  return false;
}

export function editLockReason({ status, bidCount }: EditableCheck): string {
  if (status === "active" && bidCount > 0) {
    return "มีผู้เสนอราคาแล้ว จึงแก้ไขไม่ได้ เพื่อความเป็นธรรมกับผู้ประมูล";
  }
  if (status === "ended") return "การประมูลจบแล้ว";
  if (status === "cancelled") return "รายการนี้ถูกยกเลิกแล้ว";
  return "แก้ไขไม่ได้";
}

export const MAX_TITLE = 140;
export const MAX_DESCRIPTION = 5000;
/** 1 satang minimum, and a ceiling that fits comfortably in Int. */
export const MAX_PRICE_SATANG = 1_000_000_00;
/** A timed auction must run at least this long, so it cannot close instantly. */
export const MIN_DURATION_MS = 60 * 60 * 1000;
/**
 * And no longer than a year from when the listing was created. An auction open
 * for years is indistinguishable from an abandoned one, and it would pin the
 * seller's obligation open indefinitely.
 */
export const MAX_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Default bid step: ฿10.
 *
 * Low enough not to shut out cheap listings, high enough that bidding does not
 * crawl up in single satang. Sellers can change it per item, and the column
 * carries the same value as its default so rows created before this field
 * existed behave sensibly.
 */
export const DEFAULT_BID_INCREMENT_SATANG = 1000;
/** ฿1 — anything smaller makes the step meaningless. */
export const MIN_BID_INCREMENT_SATANG = 100;

export type AuctionDraftInput = {
  categoryId: string;
  title: string;
  description: string;
  startPriceSatang: number;
  buyNowPriceSatang: number | null;
  bidIncrementSatang: number;
  endTime: Date | null;
  images: string[];
  /** When the listing was created; the one-year cap is measured from here. */
  createdAt?: Date;
};

export type AuctionFieldErrors = Partial<
  Record<
    | "categoryId"
    | "title"
    | "description"
    | "startPrice"
    | "buyNowPrice"
    | "bidIncrement"
    | "endTime"
    | "images",
    string
  >
>;

/**
 * Validate a listing. `requireImages` is false while saving a draft, so a
 * seller can save progress, and true when publishing.
 */
export function validateAuctionInput(
  input: AuctionDraftInput,
  { requireImages }: { requireImages: boolean },
): AuctionFieldErrors {
  const errors: AuctionFieldErrors = {};

  if (!input.categoryId) errors.categoryId = "กรุณาเลือกหมวดหมู่";

  if (!input.title.trim()) errors.title = "กรุณากรอกชื่อสินค้า";
  else if (input.title.length > MAX_TITLE)
    errors.title = `ชื่อสินค้าต้องไม่เกิน ${MAX_TITLE} ตัวอักษร`;

  if (!input.description.trim()) errors.description = "กรุณากรอกรายละเอียด";
  else if (input.description.length > MAX_DESCRIPTION)
    errors.description = `รายละเอียดต้องไม่เกิน ${MAX_DESCRIPTION} ตัวอักษร`;

  if (!Number.isInteger(input.startPriceSatang) || input.startPriceSatang < 1) {
    errors.startPrice = "ราคาเริ่มต้นต้องมากกว่า 0";
  } else if (input.startPriceSatang > MAX_PRICE_SATANG) {
    errors.startPrice = "ราคาเริ่มต้นสูงเกินกำหนด";
  }

  if (input.buyNowPriceSatang !== null) {
    if (!Number.isInteger(input.buyNowPriceSatang) || input.buyNowPriceSatang < 1) {
      errors.buyNowPrice = "ราคาซื้อทันทีไม่ถูกต้อง";
    } else if (input.buyNowPriceSatang > MAX_PRICE_SATANG) {
      errors.buyNowPrice = "ราคาซื้อทันทีสูงเกินกำหนด";
    } else if (
      !errors.startPrice &&
      input.buyNowPriceSatang <= input.startPriceSatang
    ) {
      // Otherwise buy-now would undercut the opening bid and the auction is
      // over before it starts.
      errors.buyNowPrice = "ราคาซื้อทันทีต้องสูงกว่าราคาเริ่มต้น";
    }
  }

  if (
    !Number.isInteger(input.bidIncrementSatang) ||
    input.bidIncrementSatang < MIN_BID_INCREMENT_SATANG
  ) {
    errors.bidIncrement = "ขั้นต่ำการเพิ่มราคาต้องอย่างน้อย 1 บาท";
  } else if (input.bidIncrementSatang > MAX_PRICE_SATANG) {
    errors.bidIncrement = "ขั้นต่ำการเพิ่มราคาสูงเกินกำหนด";
  } else if (
    input.buyNowPriceSatang !== null &&
    !errors.startPrice &&
    !errors.buyNowPrice &&
    input.bidIncrementSatang > input.buyNowPriceSatang - input.startPriceSatang
  ) {
    // Otherwise the very first legal bid already exceeds the buy-now price, so
    // no one could ever bid without overshooting it.
    errors.bidIncrement =
      "ขั้นต่ำการเพิ่มราคาสูงเกินไป จนบิดครั้งแรกจะเกินราคาซื้อทันที";
  }

  if (input.endTime) {
    const now = Date.now();
    const remaining = input.endTime.getTime() - now;
    // Measured from when the listing was created, not from now, so editing a
    // draft days later cannot quietly extend the window past a year.
    const fromCreation = input.endTime.getTime() - (input.createdAt ?? new Date(now)).getTime();

    if (Number.isNaN(input.endTime.getTime())) {
      errors.endTime = "วันเวลาที่จบไม่ถูกต้อง";
    } else if (remaining < MIN_DURATION_MS) {
      errors.endTime = "เวลาจบต้องห่างจากตอนนี้อย่างน้อย 1 ชั่วโมง";
    } else if (fromCreation > MAX_DURATION_MS) {
      errors.endTime = "เวลาจบต้องไม่เกิน 1 ปีนับจากวันที่สร้างรายการ";
    }
  }

  if (input.images.length > MAX_IMAGES_PER_ITEM) {
    errors.images = `อัปโหลดได้ไม่เกิน ${MAX_IMAGES_PER_ITEM} รูป`;
  } else if (requireImages && input.images.length < MIN_IMAGES_PER_ITEM) {
    errors.images = "กรุณาอัปโหลดรูปอย่างน้อย 1 รูป";
  }

  return errors;
}


/* ------------------------------------------------------------------ bidding */

export type BidContext = {
  currentPrice: number;
  bidIncrement: number;
  buyNowPrice: number | null;
};

/**
 * The smallest bid that will be accepted right now.
 *
 * Normally current + increment. When a buy-now price exists and that step would
 * land above it, buy-now itself becomes the only acceptable amount: bids above
 * buy-now are refused, so without this special case the increment could put the
 * item out of reach and nobody could bid at all.
 */
export function minimumBid(ctx: BidContext): number {
  const stepped = ctx.currentPrice + ctx.bidIncrement;
  if (ctx.buyNowPrice !== null && stepped > ctx.buyNowPrice) {
    return ctx.buyNowPrice;
  }
  return stepped;
}

export type BidRejection =
  | "below_minimum"
  | "above_buy_now"
  | "not_an_amount";

/** Pure amount check, shared by the form hint and the transaction. */
export function checkBidAmount(
  amount: number,
  ctx: BidContext,
): BidRejection | null {
  if (!Number.isInteger(amount) || amount <= 0) return "not_an_amount";

  // Checked before the minimum: when buy-now is the only legal amount, an
  // overshoot should be reported as "too high", not "too low".
  if (ctx.buyNowPrice !== null && amount > ctx.buyNowPrice) {
    return "above_buy_now";
  }

  if (amount < minimumBid(ctx)) return "below_minimum";

  return null;
}

/** True when this amount closes the auction outright. */
export function isBuyNowBid(amount: number, ctx: BidContext): boolean {
  return ctx.buyNowPrice !== null && amount >= ctx.buyNowPrice;
}

/**
 * How long a winner has to pay before losing the item.
 *
 * Lives here, next to the other auction rules, because both the server (which
 * enforces it) and the pages (which count down to it) need the same number.
 */
export const PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PAYMENT_WINDOW_HOURS = PAYMENT_WINDOW_MS / (60 * 60 * 1000);

/** When the deadline falls for an offer made at `from`. */
export function paymentDeadline(from: Date): Date {
  return new Date(from.getTime() + PAYMENT_WINDOW_MS);
}
