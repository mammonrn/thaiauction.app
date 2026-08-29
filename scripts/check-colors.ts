/**
 * The colour rules from CLAUDE.md, as assertions.
 *
 *   npm run check:colors
 *
 * A Tailwind class that resolves to the wrong colour still typechecks and
 * still lints clean — that is how `bg-foreground` silently killed 28 buttons
 * once, and how `red-600` lived next to a `#c41e2a` brand for three batches.
 * Neither tsc nor ESLint can see any of it, so this file is the only thing
 * standing between the palette and the next well-meant `text-green-700`.
 *
 * Pure file scan: no database, no server, no browser. Run it before pushing
 * anything that touches a colour.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         ${detail}`}`);
}

/** Walked by hand: node:fs globSync is not in this project's @types/node. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

const files = [...walk("app"), ...walk("components"), ...walk("lib")];
const sources = files.map((f) => [f, readFileSync(f, "utf8")] as const);

// 1. No Tailwind palette colour anywhere.
const PALETTE = /\b(?:text|bg|border|ring|from|to|via|fill|stroke|shadow|accent|decoration|outline)-(?:red|green|amber|yellow|blue|indigo|slate|gray|grey|zinc|neutral|stone|orange|lime|emerald|teal|cyan|sky|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
const palette = sources.flatMap(([f, s]) => [...s.matchAll(PALETTE)].map((m) => `${f}: ${m[0]}`));
check("no Tailwind palette colours", palette.length === 0, palette.join("\n         "));

// 2. Gold is the price and the focus ring, nowhere else.
const goldUse = sources.flatMap(([f, s]) =>
  [...s.matchAll(/\b(?:text|bg|border|fill|stroke)-gold\b/g)].map((m) => `${f}: ${m[0]}`),
);
const GOLD_ALLOWED = ["components/price-window.tsx", "app/page.tsx"];
const goldStray = goldUse.filter((u) => !GOLD_ALLOWED.some((a) => u.startsWith(a)));
check("gold is only on price figures", goldStray.length === 0, goldStray.join("\n         "));

// 3. No status colour on a button.
const onButton = sources.flatMap(([f, s]) =>
  [...s.matchAll(/btn[A-Za-z]*[^\n]{0,120}?\b(?:bg|text)-(?:success|warning|info)\b/g)].map((m) => `${f}: ${m[0]}`),
);
check("no button carries a status colour", onButton.length === 0, onButton.join("\n         "));

// 4. lib/button.ts uses brand tones only.
const button = readFileSync("lib/button.ts", "utf8");
check("lib/button.ts uses brand tones only",
  !/\b(?:bg|text|border)-(?:success|warning|info|gold)\b/.test(button));

// 5. Exactly eight colour tokens, no more.
const css = readFileSync("app/globals.css", "utf8");
const tokens = [...css.matchAll(/--color-([a-z-]+):/g)].map((m) => m[1]).sort();
const EXPECTED = ["brand", "brand-dark", "gold", "info", "ink", "paper", "success", "warning"].sort();
check(`exactly eight colour tokens (${tokens.length})`,
  JSON.stringify(tokens) === JSON.stringify(EXPECTED), tokens.join(", "));

// 6. Every status colour clears AA on paper.
function srgb(c: number) { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function lum(hex: string) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
function ratio(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const PAPER = "#f7f7f7";
for (const name of ["brand", "success", "warning", "info", "ink"]) {
  const hex = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`))![1];
  const r = ratio(hex, PAPER);
  check(`${name} clears AA on paper (${r.toFixed(2)}:1)`, r >= 4.5, hex);
}

console.log(
  failures === 0
    ? "\nall colour rules hold"
    : `\n${failures} RULE(S) BROKEN — see CLAUDE.md "Color System"`,
);
process.exit(failures === 0 ? 0 : 1);
