/**
 * Image constants and key helpers shared by client and server.
 *
 * Deliberately free of any server-only import: `lib/uploads.ts` pulls in sharp
 * and is marked "server-only", so a client component that needed these limits
 * would drag the whole image pipeline into the browser bundle (and fail to
 * build). Anything both sides need lives here instead.
 */

export const MAX_IMAGES_PER_ITEM = 8;
export const MIN_IMAGES_PER_ITEM = 1;

/**
 * Stored files, by shape:
 *   items/<itemId>/<uuid>.webp          the display image
 *   items/<itemId>/<uuid>.thumb.webp    its ~400px thumbnail
 *   staging/<userId>/<uuid>.webp        an upload not yet attached to an item
 *   avatars/<userId>/<uuid>.webp        a profile picture
 *
 * These patterns are a security control, not a convention: resolveKey refuses
 * anything that does not match, which is what stops "..", absolute paths and
 * encoded separators from ever reaching the filesystem. The `.thumb` segment
 * is optional so one pattern covers a display image and its thumbnail.
 */
export const STAGING_KEY = /^staging\/[A-Za-z0-9_-]+\/[a-f0-9-]{36}(\.thumb)?\.webp$/;
export const ITEM_KEY = /^items\/[A-Za-z0-9_-]+\/[a-f0-9-]{36}(\.thumb)?\.webp$/;
export const AVATAR_KEY = /^avatars\/[A-Za-z0-9_-]+\/[a-f0-9-]{36}\.webp$/;

export function isStagingKey(key: string): boolean {
  return STAGING_KEY.test(key);
}

export function isItemKey(key: string): boolean {
  return ITEM_KEY.test(key);
}

export function isAvatarKey(key: string): boolean {
  return AVATAR_KEY.test(key);
}

/**
 * The thumbnail that belongs to a display key.
 *
 * Derived rather than stored: one image always has exactly one thumbnail, so a
 * second column would only be a way for the two to disagree.
 */
export function thumbKey(key: string): string {
  return key.replace(/\.webp$/, ".thumb.webp");
}

/** Thumbnail URL for a display key, for cards and grids. */
export function thumbUrl(key: string): string {
  return imageUrl(thumbKey(key));
}

/** Public URL for a stored key. */
export function imageUrl(key: string): string {
  return `/api/images/${key}`;
}
