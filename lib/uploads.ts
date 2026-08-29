import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import {
  MAX_UPLOAD_BYTES,
  isAvatarKey,
  isItemKey,
  isStagingKey,
  thumbKey,
} from "@/lib/image-keys";

export {
  imageUrl,
  MAX_UPLOAD_BYTES,
  isAvatarKey,
  isItemKey,
  isStagingKey,
  thumbKey,
  thumbUrl,
  MAX_IMAGES_PER_ITEM,
  MIN_IMAGES_PER_ITEM,
} from "@/lib/image-keys";

/**
 * Local image storage.
 *
 * Files are kept OUTSIDE the Next.js project directory (UPLOAD_DIR) so a
 * redeploy, rebuild or `git clean` cannot delete user uploads, and so the
 * upload area can be backed up on its own. They are served back through
 * app/api/images, never as static assets.
 */

const DEFAULT_UPLOAD_DIR = path.join(process.cwd(), "storage", "uploads");

export function uploadRoot(): string {
  return process.env.UPLOAD_DIR || DEFAULT_UPLOAD_DIR;
}

/** Longest edge kept; portrait phone shots stay portrait. */
const MAX_EDGE_PX = 1600;
const WEBP_QUALITY = 82;

/**
 * Card-sized copy. Grids show a dozen of these at 220px wide, so serving the
 * 1600px display image there costs a phone user roughly twenty times the bytes
 * for pixels they cannot see.
 */
const THUMB_EDGE_PX = 400;
const THUMB_QUALITY = 78;

/** Profile pictures are square and small; nothing shows one above 128px. */
const AVATAR_PX = 256;

/** Staged files older than this are swept away on the next upload. */
const STAGING_TTL_MS = 24 * 60 * 60 * 1000;

export class UploadError extends Error {}

/**
 * Resolve a key to an absolute path, refusing anything that escapes the upload
 * root. The key is pattern-checked first, so "..", absolute paths and encoded
 * separators never get this far; the realpath comparison is the backstop.
 */
export function resolveKey(key: string): string | null {
  if (!isStagingKey(key) && !isItemKey(key) && !isAvatarKey(key)) return null;

  // turbopackIgnore: the root is an absolute path chosen by the deployment
  // (UPLOAD_DIR points outside the project on the VPS, so uploads survive a
  // redeploy). Turbopack cannot see that at build time, so it assumes the
  // whole project may be read and traces every source file — including
  // /public — into the server bundle. The comment tells it not to; it is a
  // build-tracing hint with no runtime effect. The traversal guard below is
  // untouched: the key is still pattern-checked first, still resolved against
  // this root, and still refused unless it lands inside it.
  const root = path.resolve(/* turbopackIgnore: true */ uploadRoot());
  const full = path.resolve(root, key);

  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

/**
 * Validate and normalise one uploaded image.
 *
 * The file's real content decides whether it is accepted: sharp parses it, and
 * a file that is not a real JPEG/PNG/WebP fails to decode no matter what its
 * name or declared Content-Type says. It is then re-encoded, so what lands on
 * disk is a WebP that sharp itself produced — any payload smuggled inside the
 * original does not survive. `rotate()` applies the EXIF orientation before the
 * metadata is dropped, so sideways phone photos stay upright, and dropping the
 * metadata also removes the GPS coordinates many phones embed.
 */
async function assertRealImage(input: Buffer): Promise<void> {
  let format: string | undefined;

  try {
    format = (await sharp(input, { failOn: "error" }).metadata()).format;
  } catch {
    throw new UploadError("ไฟล์นี้ไม่ใช่รูปภาพที่รองรับ");
  }

  if (!format || !["jpeg", "png", "webp"].includes(format)) {
    throw new UploadError("รองรับเฉพาะไฟล์ JPG, PNG และ WebP");
  }
}

async function processImage(input: Buffer): Promise<Buffer> {
  await assertRealImage(input);

  try {
    return await sharp(input, { failOn: "error" })
      .rotate()
      .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch {
    throw new UploadError("ประมวลผลรูปไม่สำเร็จ");
  }
}

/**
 * The card-sized copy of an image.
 *
 * Made from the ORIGINAL upload rather than from the display WebP, so it is one
 * re-encode from the source instead of two — and it goes through the identical
 * decode-then-re-encode as everything else, so a payload hidden in the original
 * no more survives into a thumbnail than into a display image.
 */
async function processThumbnail(input: Buffer): Promise<Buffer> {
  await assertRealImage(input);

  try {
    return await sharp(input, { failOn: "error" })
      .rotate()
      .resize({ width: THUMB_EDGE_PX, height: THUMB_EDGE_PX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();
  } catch {
    throw new UploadError("ประมวลผลรูปไม่สำเร็จ");
  }
}

/**
 * A profile picture: square, centred on whatever sharp judges most salient.
 *
 * Same decode-and-re-encode contract as every other upload; only the geometry
 * differs. `attention` beats a centre crop for faces, which is what these are.
 */
async function processAvatar(input: Buffer): Promise<Buffer> {
  await assertRealImage(input);

  try {
    return await sharp(input, { failOn: "error" })
      .rotate()
      .resize(AVATAR_PX, AVATAR_PX, { fit: "cover", position: "attention" })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch {
    throw new UploadError("ประมวลผลรูปไม่สำเร็จ");
  }
}

/** Remove a user's stale staged files. Best-effort; never fails the upload. */
async function sweepStaging(userId: string): Promise<void> {
  const dir = path.join(uploadRoot(), "staging", userId);
  try {
    const entries = await readdir(dir);
    const cutoff = Date.now() - STAGING_TTL_MS;
    await Promise.all(
      entries.map(async (name) => {
        const file = path.join(dir, name);
        const info = await stat(file);
        if (info.mtimeMs < cutoff) await rm(file, { force: true });
      }),
    );
  } catch {
    // No staging directory yet, or a race with another upload — nothing to do.
  }
}

/**
 * Store one uploaded image in the user's staging area.
 *
 * Staging is keyed by user id, so the move-into-item step can prove the caller
 * owns the file it is claiming.
 */
export async function stageImage(userId: string, file: File): Promise<string> {
  if (file.size === 0) throw new UploadError("ไฟล์ว่าง");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError(
      `ไฟล์ใหญ่เกิน ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`,
    );
  }

  const original = Buffer.from(await file.arrayBuffer());
  const [processed, thumbnail] = await Promise.all([
    processImage(original),
    processThumbnail(original),
  ]);

  await sweepStaging(userId);

  const dir = path.join(uploadRoot(), "staging", userId);
  await mkdir(dir, { recursive: true });

  // A fresh random name: the user's own filename is never used, so it cannot
  // carry a path, a second extension, or anything the filesystem might act on.
  const name = `${randomUUID()}.webp`;
  await writeFile(path.join(dir, name), processed);
  // The thumbnail's key is derived from the display key, never stored, so the
  // two cannot drift apart.
  await writeFile(path.join(dir, thumbKey(name)), thumbnail);

  return `staging/${userId}/${name}`;
}

/**
 * Move staged files into an item's folder and return their new keys.
 *
 * Keys already belonging to this item are passed through unchanged, so an edit
 * can mix existing images with newly uploaded ones. A staging key belonging to
 * another user is rejected rather than moved.
 */
export async function attachImagesToItem(
  userId: string,
  itemId: string,
  keys: string[],
): Promise<string[]> {
  const itemDir = path.join(uploadRoot(), "items", itemId);
  await mkdir(itemDir, { recursive: true });

  const result: string[] = [];

  for (const key of keys) {
    if (isItemKey(key)) {
      // Only this item's own images may be kept.
      if (!key.startsWith(`items/${itemId}/`)) {
        throw new UploadError("รูปภาพไม่ถูกต้อง");
      }
      result.push(key);
      continue;
    }

    if (!isStagingKey(key) || !key.startsWith(`staging/${userId}/`)) {
      throw new UploadError("รูปภาพไม่ถูกต้อง");
    }

    const from = resolveKey(key);
    if (!from) throw new UploadError("รูปภาพไม่ถูกต้อง");

    const name = path.basename(key);
    await rename(from, path.join(itemDir, name));

    // Move the thumbnail alongside. Tolerated if missing: an image staged
    // before thumbnails existed still attaches, and the backfill script picks
    // it up later.
    const stagedThumb = resolveKey(thumbKey(key));
    if (stagedThumb) {
      await rename(stagedThumb, path.join(itemDir, thumbKey(name))).catch(() => {});
    }

    result.push(`items/${itemId}/${name}`);
  }

  return result;
}

/** Delete stored files. Best-effort: a missing file is not an error. */
export async function deleteImages(keys: string[]): Promise<void> {
  // Each display key takes its thumbnail with it.
  const all = keys.flatMap((key) => [key, thumbKey(key)]);

  await Promise.all(
    all.map(async (key) => {
      const full = resolveKey(key);
      if (full) await rm(full, { force: true });
    }),
  );
}

/**
 * Store a profile picture and return its key.
 *
 * Written straight to its final location rather than through staging: unlike an
 * item image there is no draft step, and the row is updated in the same request.
 */
export async function storeAvatar(userId: string, file: File): Promise<string> {
  if (file.size === 0) throw new UploadError("ไฟล์ว่าง");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError(
      `ไฟล์ใหญ่เกิน ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`,
    );
  }

  const processed = await processAvatar(Buffer.from(await file.arrayBuffer()));

  const dir = path.join(uploadRoot(), "avatars", userId);
  await mkdir(dir, { recursive: true });

  const name = `${randomUUID()}.webp`;
  await writeFile(path.join(dir, name), processed);

  return `avatars/${userId}/${name}`;
}

/** Remove a profile picture file. Best-effort. */
export async function deleteAvatar(key: string): Promise<void> {
  const full = resolveKey(key);
  if (full) await rm(full, { force: true });
}
