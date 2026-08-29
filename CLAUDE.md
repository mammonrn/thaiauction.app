@AGENTS.md

# House rules

These outlive any one task. They were each written after the same mistake was
found twice, so treat a violation as a bug rather than a matter of taste.

Almost none of this is enforceable by `tsc` or ESLint — a Tailwind class that
stops resolving still typechecks, and a paragraph nobody needed still renders.
The colour rules are the exception: `npm run check:colors` asserts them, and it
is the only automated check the palette has. Run it before pushing anything
that touches a colour.

Everything else is checked by reading the diff against these rules, and by
looking at the result on a 390px screen before calling it done.

## Color System

**Eight colours. Every one has exactly one job, and nothing outside this table
is a colour.** Adding a ninth requires a role that none of these can fill —
not a shade someone wanted, and not "this one needed to be a bit different".

| Token | Hex | Job — and nothing else |
|---|---|---|
| `brand` | `#C41E2A` | The brand, and primary/secondary/danger buttons via `lib/button.ts`. Also carries **errors**: the brand is red, so a second red would be a near-miss rather than a distinction. |
| `brand-dark` | `#8B0000` | The header band, and the hover/solid weight of brand buttons. |
| `gold` | `#F0B429` | **Price figures and the focus ring. Nothing else.** Not the wordmark, not a countdown, not a highlight. This is the one rule most likely to be broken by accident, because gold is the prettiest colour here. |
| `ink` | `#1A1A1A` | Type, rules, icons, and dark surfaces (the price window, the closing-soon rail). Ink is **structure**, so an ink surface can be as large as the layout needs. |
| `paper` | `#F7F7F7` | The page ground. Cards are white on it. |
| `success` | `#1E7D45` | Status text and badges: verified, paid, saved, approved. |
| `warning` | `#8C6024` | Status text and badges: pending, expiring, needs attention, name mismatch. |
| `info` | `#2B5182` | In-body links on a neutral ground, and system notices where nothing is wrong. |

Tints and borders are made from these with an opacity modifier — `bg-success/12`,
`border-warning/35` — never by picking a lighter colour from somewhere else.

### The rules

- **Never use Tailwind's own palette for anything in this table.** `red-600` is
  `#dc2626` against a brand of `#c41e2a`: close enough to read as a mistake
  rather than a choice. The same goes for `green-700` and `amber-600` now that
  `success` and `warning` exist. Tailwind's neutrals (`black/10`, `white/85`)
  are fine — they are transparency, not colour.
- **`success` / `warning` / `info` are text and badges only.** Never a button
  fill, never decoration, never a large surface. A green button would put a
  colour that means "this happened" on a control that means "do this".
- **Every control draws its styling from `lib/button.ts`.** A button that
  invents its own colours drifts out of the theme the moment the theme moves,
  which is exactly how "ออกจากระบบ" and "ติดตั้งแอป" ended up as bare white boxes
  on a page where nothing else was a bare white box. Use `btnPrimary` /
  `btnSecondary` / `btnGhost` / `btnDanger` / `btnLink` (and the `Sm` variants).
  If none fits, add a token — do not write the classes inline.
- `btnGoogle` is the one white control, and only because Google's branding
  rules require it. It lives in `lib/button.ts` so the exception is visible as
  a decision instead of turning up later as another stray white box.
- **A status is not an action.** If something is finished, verified or paid, it
  is `success` — not `brand`. Three brand-red progress bars once made a
  completed account the loudest thing on the account page, which put the accent
  colour on a state instead of on the next thing to do.

### 60-30-10

Roughly 60% ground, 30% structure, 10% accent — measured on **one viewport at
390px**, not on a full-page render. A fixed red header is 12% of a phone screen
and 2% of a long page, so a full-page measurement passes everything and means
nothing.

- **ground** — paper and card white
- **structure** — ink: type, rules, icons, and dark surfaces
- **accent** — brand, gold, and the three status colours

The number that actually constrains anything is the accent share. **Over ~15%
the accent has become the ground** and no longer marks anything; **under ~4%
there is no focal point.** Every page should currently land between those.

Two things this metric cannot tell you, so do not chase it blindly:

- Structure measures low (1-3%) on form and content pages, because their
  structure is thin type rather than filled areas. That is the design — white
  cards on near-white paper, separated by shadow and hairlines — not a fault to
  paint over. Do not invent a secondary surface to move a number.
- Product photography is content, not palette. Measure the chrome on
  image-less fixtures; a page full of red handbags is not a design problem.

The one page that genuinely broke this was the home page, where a brand-dark
closing-soon rail under a brand-dark header put **31.5%** of the first viewport
under the accent. Moving the rail to ink took it to **5.6%** and gave the page
the structure layer it was missing — the gold prices read better on ink than
they ever did on red.

## Content & copy rules

**The UI states what is true and what you can do. Explanations of policy live
in `/privacy`, and nowhere else.** The app had grown a habit of explaining its
own reasoning on screen — why a photo was deleted, how commission is
calculated, what the lock is for — until the reasoning outweighed the facts and
every page read like a terms document.

- A status is a status: "ยืนยันตัวตนแล้ว · 28 สิงหาคม 2569". Not "ยืนยันตัวตนแล้ว
  · รูปบัตรถูกลบออกจากระบบแล้ว" — the retention rule is in the policy, and
  restating it here makes the reader parse a sentence to find a date.
- **Prose over one line is a smell.** Before writing it, ask whether the reader
  can act on it right now. If not, cut it or move it to `/privacy`. If yes,
  get it into one line.
- An instruction that changes what someone does *at that moment* is not policy
  and stays — "ปิดทับช่องศาสนาก่อนถ่าย" is an action. The reason it matters is
  policy and goes.
- Say a thing once per screen. A heading, a paragraph explaining the heading,
  and a list saying it a third time is one fact wearing three hats.
- Terms a seller has already accepted are not repeated as ambient warnings.
  The commission is agreed once at `/sell/terms`; after that it appears only as
  a figure in a payout breakdown.

**Two places are legally required and must not be trimmed:** the commission
terms at `/sell/terms`, and the actual deducted figures in the payout summary.
Cut around them, never through them.

## Confirm dialogs

Destructive or hard-to-reverse actions confirm first, through the shared
`components/confirm-dialog.tsx` — one component, so the app has one way of
asking rather than four inline "ยืนยัน?" spans that each look slightly
different.

- One line saying what happens, in the same voice as the rest of the UI. Not a
  warning, not an apology: "รายการนี้จะถูกลบถาวร".
- The confirm button carries the meaning of the action — `btnDanger` when
  something is destroyed, `btnPrimary` when it is merely significant — and it
  is labelled with the verb, not "ตกลง". The button that says "ลบ" produces a
  result that says "ลบแล้ว".
- Reversible actions do not get a dialog. A confirm on everything trains people
  to dismiss confirms.
