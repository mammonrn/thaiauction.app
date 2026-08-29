/**
 * One drawn icon per category, and the order they are shown in.
 *
 * Drawn here rather than stored on the row, because an icon is a component and
 * a database column would only ever hold a name that pointed back to this file.
 * Adding a category means adding a row (prisma/seed.ts) and an entry here; a
 * category with no entry falls back to the generic tag, so a seed that runs
 * ahead of a deploy degrades rather than crashes.
 *
 * ONE SET, ONE HAND. Every glyph is stroke-only on a 24x24 grid at 1.6 weight
 * with round caps and joins, sized to fill roughly the middle 18px, and drawn
 * in `currentColor` so the grid can tint them. That constraint matters more
 * than any individual glyph being clever: a set where one icon is filled, one
 * is 2px, and one is drawn edge-to-edge reads as clip art, and this is the
 * first screen a seller sees.
 *
 * Reference screenshots showed a competitor's set. These are redrawn from the
 * subject — the object itself — not traced from those images.
 */
import type { ReactNode } from "react";

/**
 * Each glyph is the CONTENTS of an svg, not a component.
 *
 * `const Icon = categoryIcon(slug)` followed by `<Icon />` creates a component
 * during render, which the React Compiler refuses and which would remount the
 * icon on every pass. A fragment of paths has no such problem: one stable
 * <CategoryIcon> element does the lookup and the drawing.
 */
type Glyph = ReactNode;

/** Amulet — the arched frame Thai amulets are cased in, with its cord loop. */
const Amulet: Glyph = (
  <>
    <path d="M12 3c3.2 0 5 2.2 5 5.4V19a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V8.4C7 5.2 8.8 3 12 3Z" />
    <circle cx="12" cy="10" r="2.2" />
    <path d="M9.5 16.5h5" />
  </>
);

/** Watch — case between two strap stubs. */
const Watch: Glyph = (
  <>
    <circle cx="12" cy="12" r="4.8" />
    <path d="M12 10v2.2l1.5 1" />
    <path d="M9.6 7.4 9 3.6h6l-.6 3.8M9.6 16.6 9 20.4h6l-.6-3.8" />
  </>
);

/** Phone and tablet, overlapped. */
const Phone: Glyph = (
  <>
    <rect x="3" y="3" width="10" height="14" rx="1.8" />
    <path d="M6.5 14h3" />
    <path d="M15 8h5a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-2" />
  </>
);

/** Laptop — lid, hinge, base. */
const Computer: Glyph = (
  <>
    <rect x="5" y="4.5" width="14" height="10" rx="1.4" />
    <path d="M2.5 18.5h19M9 18.5l.5-2h5l.5 2" />
  </>
);

/** Camera — body, lens, viewfinder bump. */
const Camera: Glyph = (
  <>
    <path d="M3 8.5h3l1.6-2.4h8.8L18 8.5h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13.5" r="3.4" />
  </>
);

/** Framed canvas with a horizon. */
const Art: Glyph = (
  <>
    <rect x="3" y="4" width="18" height="16" rx="1.4" />
    <path d="M3 15.5 8 11l3.5 3L15 10l6 5.5" />
    <circle cx="8.5" cy="8" r="1.3" />
  </>
);

/** Vinyl-style disc, standing in for collectibles generally. */
const Collectible: Glyph = (
  <>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.2" />
  </>
);

/** Art toy — a blocky figure, which is what the category actually is. */
const ArtToy: Glyph = (
  <>
    <rect x="7" y="3.5" width="10" height="8" rx="3" />
    <path d="M9.8 7.2h.01M14.2 7.2h.01" />
    <path d="M8.5 11.5h7l1 9h-9l1-9Z" />
  </>
);

/** Two cards, fanned. */
const TradingCard: Glyph = (
  <>
    <rect x="8" y="4" width="11" height="15" rx="1.6" />
    <path d="M6 6.5 4.2 7.1a1 1 0 0 0-.65 1.25l3.2 10.2" />
    <path d="M11.5 9.5h4M11.5 13h4" />
  </>
);

/** Handbag. */
const Bag: Glyph = (
  <>
    <path d="M4 8h16l-1.1 11.2a1 1 0 0 1-1 .8H6.1a1 1 0 0 1-1-.8L4 8Z" />
    <path d="M8.5 10.5V7a3.5 3.5 0 0 1 7 0v3.5" />
  </>
);

/** Trainer, side on. */
const Shoe: Glyph = (
  <>
    <path d="M2.5 16.5V11l4 .5 3.5-3 2 3.5 6.5 1.6a3 3 0 0 1 2.3 2.9v1H2.5Z" />
    <path d="M2.5 19.5h19" />
  </>
);

/** T-shirt. */
const Clothing: Glyph = (
  <>
    <path d="M9 4 4 6.5l1.8 4L8 10v10h8V10l2.2.5L20 6.5 15 4a3 3 0 0 1-6 0Z" />
  </>
);

/** Ring with a stone. */
const Jewelry: Glyph = (
  <>
    <circle cx="12" cy="15" r="5.5" />
    <path d="m9 7.5 3-4 3 4-3 3.2-3-3.2ZM9 7.5h6" />
  </>
);

/** Variegated leaf — the split colour is the whole point of the category. */
const Plant: Glyph = (
  <>
    <path d="M20 4c0 8-4.5 12-9 12a5.6 5.6 0 0 1-5.6-5.6C5.4 6.5 11 4 20 4Z" />
    <path d="M4 21c1.5-4.5 4.8-8 9.5-10.5" />
  </>
);

/** Acoustic guitar. */
const Instrument: Glyph = (
  <>
    <path d="M10.2 11.2a4.4 4.4 0 1 0 3.6 3.6 4.2 4.2 0 1 0-3.6-3.6Z" />
    <circle cx="12" cy="14.5" r="1.6" />
    <path d="m14.8 9.2 5-5M17.6 4.2l2.2 2.2" />
  </>
);

/** Football. */
const Sports: Glyph = (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m12 7.2 3.6 2.6-1.4 4.3H9.8L8.4 9.8 12 7.2Z" />
    <path d="M12 3.5v3.7M19.6 9.4l-4 .4M17 19l-2.8-4.9M7 19l2.8-4.9M4.4 9.4l4 .4" />
  </>
);

/** Bicycle. */
const Bicycle: Glyph = (
  <>
    <circle cx="5.5" cy="16.5" r="3.5" />
    <circle cx="18.5" cy="16.5" r="3.5" />
    <path d="M5.5 16.5 9 8h4l3 8.5M9 8h5.5M12.5 16.5H9" />
  </>
);

/** Scooter — the Thai city motorbike, not a sports bike. */
const Motorcycle: Glyph = (
  <>
    <circle cx="5.5" cy="17" r="3" />
    <circle cx="18.5" cy="17" r="3" />
    <path d="M8.5 17h7l-1.5-6.5H9L7 14" />
    <path d="M13 10.5h3.5l2 6.5M9 6h3l.8 4.5" />
  </>
);

/** Car, three-quarter silhouette flattened to a side profile. */
const Car: Glyph = (
  <>
    <path d="M3 15.5v-2.2l1.8-4A2 2 0 0 1 6.7 8h10.6a2 2 0 0 1 1.9 1.3l1.8 4v2.2" />
    <path d="M3 15.5h18M4.5 15.5v1.8M19.5 15.5v1.8" />
    <circle cx="7.5" cy="17.5" r="1.8" />
    <circle cx="16.5" cy="17.5" r="1.8" />
  </>
);

/** Wheel — parts and trim. */
const CarPart: Glyph = (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5v5.5M20.5 12H15M7.8 18.6l3-5.2M3.5 12H9M16.2 18.6l-3-5.2" />
  </>
);

/** Feeding bottle. */
const Baby: Glyph = (
  <>
    <path d="M10 6.5h4v2.2a4 4 0 0 1 1.5 3.1V19a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2v-7.2A4 4 0 0 1 10 8.7V6.5Z" />
    <path d="M11 3.5h2v3h-2zM9 13.5h6M9 16.5h6" />
  </>
);

/** Cosmetics bottle with a pump. */
const Beauty: Glyph = (
  <>
    <rect x="7.5" y="9" width="9" height="12" rx="2" />
    <path d="M10.5 9V6.5h3V9M13.5 4.5h3v2h-3" />
  </>
);

/** House with a potted plant beside it. */
const Home: Glyph = (
  <>
    <path d="M3 11 9.5 5.5 16 11v8.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V11Z" />
    <path d="M19 20.5v-4M19 16.5a2.5 2.5 0 0 1 2.5-2.5M19 16.5A2.5 2.5 0 0 0 16.5 14" />
  </>
);

/** Washing machine, standing in for appliances. */
const Appliance: Glyph = (
  <>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <circle cx="12" cy="14" r="4" />
    <path d="M7 6.5h.01M10 6.5h.01" />
  </>
);

/** Game controller. */
const Game: Glyph = (
  <>
    <path d="M8 8h8a5 5 0 0 1 5 5v1.5a3.5 3.5 0 0 1-6.3 2.1l-.7-1h-4l-.7 1A3.5 3.5 0 0 1 3 14.5V13a5 5 0 0 1 5-5Z" />
    <path d="M7.5 12.5h2M8.5 11.5v2M15.5 12h.01M17.5 13.5h.01" />
  </>
);

/** Stacked books. */
const Books: Glyph = (
  <>
    <path d="M4 5.5h4.5v14H4zM9.5 5.5H14v14H9.5z" />
    <path d="m15.3 6.6 3.9 1-3.2 12.2-3.4-.9" />
  </>
);

/** Fallback: the ticket tag the listing cards already use. */
const Tag: Glyph = (
  <>
    <path d="M12.5 3H20a1 1 0 0 1 1 1v7.5l-9 9a1.5 1.5 0 0 1-2.1 0l-6.4-6.4a1.5 1.5 0 0 1 0-2.1l9-9Z" />
    <circle cx="17" cy="7" r="1.4" />
  </>
);

/**
 * Slug -> glyph. Order here is the order the picker shows.
 *
 * Sorted by what a Thai auction seller is most likely to be holding, not
 * alphabetically: amulets and collectibles are what this marketplace is for,
 * so they lead; vehicles are the long tail and sit at the end.
 */
const GLYPHS: Record<string, Glyph> = {
  amulets: Amulet,
  collectibles: Collectible,
  "art-toys": ArtToy,
  "trading-cards": TradingCard,
  "art-paintings": Art,
  watches: Watch,
  jewelry: Jewelry,
  "brand-bags-shoes": Bag,
  shoes: Shoe,
  fashion: Clothing,
  phones: Phone,
  "it-gadgets": Computer,
  cameras: Camera,
  games: Game,
  "musical-instruments": Instrument,
  sports: Sports,
  "books-hobbies": Books,
  "variegated-plants": Plant,
  "home-garden": Home,
  appliances: Appliance,
  "health-beauty": Beauty,
  "mother-baby": Baby,
  bicycles: Bicycle,
  motorcycles: Motorcycle,
  cars: Car,
  "car-parts": CarPart,
};

const ORDER = Object.keys(GLYPHS);

export function CategoryIcon({
  slug,
  className,
}: {
  slug: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {GLYPHS[slug] ?? Tag}
    </svg>
  );
}

/**
 * Sort categories into the curated order, with anything unknown last.
 *
 * Alphabetical order by Thai name puts "อะไหล่รถ" next to "อสังหา" and buries
 * พระเครื่อง in the middle, which is backwards for a marketplace whose first
 * listings are amulets.
 */
export function sortCategories<T extends { slug: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ai = ORDER.indexOf(a.slug);
    const bi = ORDER.indexOf(b.slug);
    return (ai === -1 ? ORDER.length : ai) - (bi === -1 ? ORDER.length : bi);
  });
}
