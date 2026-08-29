@AGENTS.md

# House rules

These outlive any one task. They were each written after the same mistake was
found twice, so treat a violation as a bug rather than a matter of taste.

Nothing here is enforceable by `tsc` or ESLint — a Tailwind class that stops
resolving still typechecks, and a paragraph nobody needed still renders. The
only check is reading the diff against these rules, and looking at the result
on a 390px screen before calling it done.

## Design tokens

**Every control draws its styling from `lib/button.ts`.** A button that
invents its own colours drifts out of the theme the moment the theme moves,
which is exactly how "ออกจากระบบ" and "ติดตั้งแอป" ended up as bare white boxes
on a page where nothing else was a bare white box.

- Use `btnPrimary` / `btnSecondary` / `btnGhost` / `btnDanger` (and the `Sm`
  variants). If none of them fits, add a token — do not write the classes
  inline.
- Colours come from the `@theme` tokens in `app/globals.css`: `brand`,
  `brand-dark`, `gold`, `ink`, `paper`. **Never use Tailwind's own palette for
  a brand colour** — `red-600` is #dc2626 against a brand of #c41e2a, close
  enough that it reads as a mistake rather than a choice. Amber and green are
  allowed, because they are genuinely different signals rather than near-misses
  of the brand.
- `btnGoogle` is the one white control, and only because Google's branding
  rules require it. It lives in `lib/button.ts` so the exception is visible as
  a decision instead of turning up later as another stray white box.

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
