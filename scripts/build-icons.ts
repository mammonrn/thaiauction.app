/**
 * Build every app icon from the master logo.
 *
 * Run after replacing public/brand/logo.png; it overwrites all five outputs.
 *
 *   npm run icons:build
 *
 * Why a script and not a one-off: the maskable icon has a rule that is easy to
 * get wrong by hand (Android crops it to a circle, so the artwork has to sit
 * inside the middle 80%), and getting it wrong is invisible until someone
 * installs the app and sees a shaved-off gavel.
 *
 * The master is trimmed of its uniform border first. Today's export carries a
 * wide red margin (2000x2000 trims to 1600x1584), so without this the gavel
 * would sit small in the middle of every icon instead of filling it. The same
 * step removes a white margin if the logo is ever re-exported with one.
 */
import path from "node:path";
import sharp from "sharp";

/**
 * The transparent master: white artwork, no background of its own. Compositing
 * it onto the brand token means the icon's red is the SAME red as the header
 * and the buttons — the earlier flattened export was #C21E1E against a token of
 * #C41E2A, close enough to look like a mistake rather than a choice.
 */
const MASTER = path.join(process.cwd(), "public", "brand", "logo-transparent.png");

/** --color-brand from app/globals.css. */
const BRAND = { r: 0xc4, g: 0x1e, b: 0x2a, alpha: 1 };

/** Android's maskable safe zone: artwork must fit the central 80%. */
const MASKABLE_SAFE_FRACTION = 0.8;

type Target = { file: string; size: number; maskable?: boolean };

const TARGETS: Target[] = [
  { file: "app/icon.png", size: 512 },
  { file: "app/apple-icon.png", size: 180 },
  { file: "public/icon-192.png", size: 192 },
  { file: "public/icon-512.png", size: 512 },
  { file: "public/icon-maskable-512.png", size: 512, maskable: true },
];

/**
 * The header mark: the same artwork, white on transparency, no red plate.
 *
 * The header band is already brand-dark, so a red tile there would read as a
 * smudge; white-on-red is the version that holds. Emitted at 4x its 32px
 * display size because the logo is drawn in outline and the hairlines go to
 * mush if the browser has to upscale them on a 3x phone screen.
 */
const MARK = { file: "public/brand/logo-mark.png", size: 128 };

async function main() {
  // The token red, not a colour sampled from the file: the artwork is
  // transparent, so the brand decides the background rather than an export.
  const background = BRAND;
  const trimmed = await sharp(MASTER).trim().toBuffer();

  const before = await sharp(MASTER).metadata();
  const after = await sharp(trimmed).metadata();
  console.log(
    `master ${before.width}x${before.height} → trimmed ${after.width}x${after.height}` +
      (before.width === after.width ? " (no border to trim)" : ""),
  );

  for (const target of TARGETS) {
    // A maskable icon paints the background to the edge and insets only the
    // artwork; an ordinary icon fills the frame with the artwork itself.
    const artwork = target.maskable
      ? Math.round(target.size * MASKABLE_SAFE_FRACTION)
      : target.size;

    const resized = await sharp(trimmed)
      // "contain", not "cover": the trimmed master is 1600x1584, so cropping
      // to a square would shave the arc off one edge. Padding with the sampled
      // background keeps the whole mark, and the padding is invisible because
      // it is the artwork's own red.
      .resize(artwork, artwork, { fit: "contain", background })
      .toBuffer();

    const pad = Math.round((target.size - artwork) / 2);

    await sharp({
      create: {
        width: target.size,
        height: target.size,
        channels: 4,
        // Opaque throughout: a transparent icon renders as a black square on
        // some Android launchers.
        background,
      },
    })
      .composite([{ input: resized, top: pad, left: pad }])
      .flatten({ background })
      // removeAlpha as well as flatten: sharp keeps an (all-opaque) alpha
      // channel otherwise, and some Android launchers treat any alpha channel
      // as a reason to draw the icon on a black plate.
      .removeAlpha()
      .png()
      .toFile(path.join(process.cwd(), target.file));

    console.log(
      `  ${target.file.padEnd(30)} ${target.size}px` +
        (target.maskable ? ` (artwork ${artwork}px, safe zone respected)` : ""),
    );
  }

  await sharp(trimmed)
    .resize(MARK.size, MARK.size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(path.join(process.cwd(), MARK.file));

  console.log(`  ${MARK.file.padEnd(30)} ${MARK.size}px (transparent, for the header)`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[icons] failed:", error);
    process.exit(1);
  });
