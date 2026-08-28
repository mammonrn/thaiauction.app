/**
 * Postcode -> area lookup, entirely client-side.
 *
 * The index is ~272 KB of JSON (~59 KB gzipped) and is loaded with a dynamic
 * import, so it is code-split into its own chunk: a visitor who never types a
 * postcode never downloads it, and the address page's initial bundle is
 * unchanged. Once loaded it stays in module memory, so every later lookup is a
 * synchronous object access with no network or server round-trip.
 *
 * It is exposed as an external store (subscribe/getSnapshot) rather than
 * component state, so a component can read it with useSyncExternalStore and
 * derive everything during render. That keeps the form free of effects that
 * would otherwise have to copy resolved values into state and re-render.
 *
 * Data: kongvut/thai-province-data (MIT). See scripts/build-postcode-index.mjs.
 */

export type PostcodeArea = {
  subDistrict: string;
  district: string;
  province: string;
};

type PostcodeIndex = {
  /** Province names. */
  p: string[];
  /** Districts as [name, provinceIndex]. */
  d: [string, number][];
  /** Postcode -> [[subDistrictName, districtIndex], ...] */
  z: Record<string, [string, number][]>;
};

let cached: PostcodeIndex | null = null;
let loading = false;
const listeners = new Set<() => void>();

/** True for a syntactically valid Thai postcode (5 digits, never leading 0). */
export function isLookupablePostalCode(code: string): boolean {
  return /^[1-9]\d{4}$/.test(code);
}

/**
 * Begin downloading the index if it isn't already here or on its way.
 *
 * Safe to call repeatedly; call it from an event handler (e.g. the postcode
 * field's onChange), never during render.
 */
export function ensureIndexLoaded(): void {
  if (cached || loading) return;
  loading = true;

  import("@/lib/data/thai-postcodes.json")
    .then((mod) => {
      cached = mod.default as unknown as PostcodeIndex;
    })
    .catch((error) => {
      // A failed chunk load must not break the form: the fields stay manual.
      console.error("[postcode] failed to load index:", error);
    })
    .finally(() => {
      loading = false;
      for (const listener of listeners) listener();
    });
}

export function subscribeToIndex(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getIndexSnapshot(): PostcodeIndex | null {
  return cached;
}

/** The server never has the index, so the form renders in its manual state. */
export function getServerIndexSnapshot(): null {
  return null;
}

/**
 * All areas served by a postcode.
 *
 * Returns [] for a malformed code, for a code absent from the dataset, and
 * while the index is still loading. The caller treats all three the same way:
 * leave the fields alone and let the user type. An unknown postcode is never an
 * error, since the dataset can lag new administrative areas.
 */
export function lookupPostalCode(
  index: PostcodeIndex | null,
  code: string,
): PostcodeArea[] {
  if (!index || !isLookupablePostalCode(code)) return [];

  const entries = index.z[code];
  if (!entries) return [];

  return entries.map(([subDistrict, districtIdx]) => {
    const [districtName, provinceIdx] = index.d[districtIdx];
    return {
      subDistrict,
      district: districtName,
      province: index.p[provinceIdx],
    };
  });
}

/** Distinct values, preserving dataset order. */
export function unique(values: string[]): string[] {
  return [...new Set(values)];
}
