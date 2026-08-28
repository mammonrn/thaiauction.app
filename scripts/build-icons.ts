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

const MASTER = path.join(process.cwd(), "public", "brand", "logo.png");

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
 * The colour to pad with, sampled from the master's own corner.
 *
 * Taken from the artwork rather than hard-coded to the brand token: the two
 * differ slightly (the export is #C21E1E, the token #C41E2A), and padding with
 * the token would draw a visible seam around the logo.
 */
async function padColour(): Promise<{ r: number; g: number; b: number; alpha: number }> {
  const { data, info } = await sharp(MASTER)
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    r: data[0],
    g: data[1],
    b: data[info.channels >= 3 ? 2 : 0],
    alpha: 1,
  };
}

async function main() {
  const background = await padColour();
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
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[icons] failed:", error);
    process.exit(1);
  });
