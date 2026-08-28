import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

/**
 * Storage for identity documents.
 *
 * Deliberately a separate module, a separate directory and a separate serving
 * route from lib/uploads.ts. Product images are public and cached forever; an
 * ID card is the most sensitive thing this application will ever hold. Sharing
 * any of that machinery would mean one mistake in the product-image path could
 * expose identity documents, so there is no shared root, no shared key format
 * and no shared route.
 *
 * UPLOAD_DIR_KYC must point somewhere different from UPLOAD_DIR.
 */

const DEFAULT_KYC_DIR = path.join(process.cwd(), "storage", "kyc");

export function kycRoot(): string {
  return process.env.UPLOAD_DIR_KYC || DEFAULT_KYC_DIR;
}

export const MAX_KYC_UPLOAD_BYTES = 12 * 1024 * 1024;

/**
 * Kept larger and less compressed than product images (which are 1600px at
 * quality 82): an admin has to read the name and ID number off the card, and
 * over-compression turns small print into mush.
 */
const MAX_EDGE_PX = 2400;
const WEBP_QUALITY = 92;

/** "kyc/<userId>/<uuid>.webp" — the only shape produced or accepted. */
const KYC_KEY = /^kyc\/[A-Za-z0-9_-]+\/[a-f0-9-]{36}\.webp$/;

export function isKycKey(key: string): boolean {
  return KYC_KEY.test(key);
}

/** The user a key belongs to, or null if the key is malformed. */
export function kycKeyOwner(key: string): string | null {
  if (!isKycKey(key)) return null;
  return key.split("/")[1] ?? null;
}

export class KycUploadError extends Error {}

/**
 * Resolve a key to a path inside the KYC root, refusing anything that escapes.
 * The pattern check runs first, so "..", absolute paths and encoded separators
 * never reach here; the prefix comparison is the backstop.
 */
export function resolveKycKey(key: string): string | null {
  if (!isKycKey(key)) return null;

  const root = path.resolve(kycRoot());
  const full = path.resolve(root, key);

  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

/**
 * Validate, normalise and store one identity document.
 *
 * Same defence as product images: sharp parses the bytes, so a file that is not
 * a real JPEG/PNG/WebP fails to decode whatever it claims to be, and it is
 * re-encoded, so what lands on disk is an image sharp itself produced. The
 * filename is a fresh UUID, never the uploader's.
 */
export async function storeKycDocument(
  userId: string,
  file: File,
): Promise<string> {
  if (file.size === 0) throw new KycUploadError("ไฟล์ว่าง");
  if (file.size > MAX_KYC_UPLOAD_BYTES) {
    throw new KycUploadError(
      `ไฟล์ใหญ่เกิน ${Math.round(MAX_KYC_UPLOAD_BYTES / 1024 / 1024)}MB`,
    );
  }

  const input = Buffer.from(await file.arrayBuffer());

  let format: string | undefined;
  try {
    format = (await sharp(input, { failOn: "error" }).metadata()).format;
  } catch {
    throw new KycUploadError("ไฟล์นี้ไม่ใช่รูปภาพที่รองรับ");
  }
  if (!format || !["jpeg", "png", "webp"].includes(format)) {
    throw new KycUploadError("รองรับเฉพาะไฟล์ JPG, PNG และ WebP");
  }

  let processed: Buffer;
  try {
    processed = await sharp(input, { failOn: "error" })
      .rotate()
      .resize({
        width: MAX_EDGE_PX,
        height: MAX_EDGE_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch {
    throw new KycUploadError("ประมวลผลรูปไม่สำเร็จ");
  }

  const dir = path.join(kycRoot(), "kyc", userId);
  // 0o700: even on a shared host, only the account running the app can list
  // or read this directory.
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const name = `${randomUUID()}.webp`;
  await writeFile(path.join(dir, name), processed, { mode: 0o600 });

  return `kyc/${userId}/${name}`;
}

/**
 * Erase a stored document. Best-effort: a file that is already gone is fine,
 * since the goal is that it no longer exists.
 */
export async function deleteKycDocument(key: string | null): Promise<void> {
  if (!key) return;
  const full = resolveKycKey(key);
  if (full) await rm(full, { force: true });
}
