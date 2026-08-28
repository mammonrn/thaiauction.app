/**
 * Image constants and key helpers shared by client and server.
 *
 * Deliberately free of any server-only import: `lib/uploads.ts` pulls in sharp
 * and is marked "server-only", so a client component that needed these limits
 * would drag the whole image pipeline into the browser bundle (and fail to
 * build). Anything both sides need lives here instead.
 */

export const MAX_IMAGES_PER_ITEM = 10;
export const MIN_IMAGES_PER_ITEM = 1;

/** A stored file is "items/<itemId>/<uuid>.webp" or "staging/<userId>/<uuid>.webp". */
export const STAGING_KEY = /^staging\/[A-Za-z0-9_-]+\/[a-f0-9-]{36}\.webp$/;
export const ITEM_KEY = /^items\/[A-Za-z0-9_-]+\/[a-f0-9-]{36}\.webp$/;

export function isStagingKey(key: string): boolean {
  return STAGING_KEY.test(key);
}

export function isItemKey(key: string): boolean {
  return ITEM_KEY.test(key);
}

/** Public URL for a stored key. */
export function imageUrl(key: string): string {
  return `/api/images/${key}`;
}
