/**
 * Generate the missing thumbnail for every stored item image.
 *
 * Images uploaded before thumbnails existed have only a display copy, so a card
 * asking for `<uuid>.thumb.webp` gets a 404 and shows a blank tile. This walks
 * the upload directory and makes the missing ones.
 *
 *   UPLOAD_DIR=/var/lib/thaiauction/uploads npm run images:backfill
 *
 * Safe to re-run: an image that already has a thumbnail is skipped, so a failed
 * run can simply be run again. It reads no database — the filesystem is the
 * whole source of truth for what exists.
 *
 * The thumbnail is made from the stored DISPLAY image rather than an original
 * that no longer exists. That is one extra re-encode versus a fresh upload,
 * which costs a little sharpness and nothing in safety: the display image is
 * already a WebP this app produced.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const THUMB_EDGE_PX = 400;
const THUMB_QUALITY = 78;

function uploadRoot(): string {
  return process.env.UPLOAD_DIR || path.join(process.cwd(), "storage", "uploads");
}

async function listDirs(parent: string): Promise<string[]> {
  try {
    const entries = await readdir(parent, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function main() {
  const root = uploadRoot();
  const itemsDir = path.join(root, "items");

  let made = 0;
  let skipped = 0;
  let failed = 0;

  const items = await listDirs(itemsDir);
  console.log(`[backfill] scanning ${items.length} item folder(s) under ${itemsDir}`);

  for (const item of items) {
    const dir = path.join(itemsDir, item);
    const files = await readdir(dir).catch(() => [] as string[]);

    // Display images only: a thumbnail is not itself thumbnailed.
    const displays = files.filter(
      (name) => name.endsWith(".webp") && !name.endsWith(".thumb.webp"),
    );

    for (const name of displays) {
      const thumb = name.replace(/\.webp$/, ".thumb.webp");
      const thumbPath = path.join(dir, thumb);

      if (await stat(thumbPath).then(() => true).catch(() => false)) {
        skipped += 1;
        continue;
      }

      try {
        await sharp(path.join(dir, name), { failOn: "error" })
          .resize({
            width: THUMB_EDGE_PX,
            height: THUMB_EDGE_PX,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: THUMB_QUALITY })
          .toFile(thumbPath);
        made += 1;
      } catch (error) {
        failed += 1;
        console.error(`  failed: items/${item}/${name}`, error);
      }
    }
  }

  console.log(
    `[backfill] done — created ${made}, already present ${skipped}, failed ${failed}`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[backfill] failed:", error);
  process.exit(1);
});
