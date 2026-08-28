# App icons — replace these with the real logo

These are placeholders reproducing the mark the header uses today. They exist
so the PWA is installable and testable; swap them for the real logo and nothing
else needs changing.

| File | Size | Used by |
| --- | --- | --- |
| `app/icon.png` | 512×512 | Browser tab / favicon (Next.js emits the link) |
| `app/apple-icon.png` | 180×180 | iOS "Add to Home Screen" |
| `public/icon-192.png` | 192×192 | Android home screen |
| `public/icon-512.png` | 512×512 | Android splash / app list |
| `public/icon-maskable-512.png` | 512×512 | Android adaptive icon |

Two things to keep when replacing them:

- **The maskable one needs a safe zone.** Android crops it to a circle, so keep
  the mark inside the middle 80% or the edges get shaved off. The other icons
  are shown as-is and can run closer to the edge.
- **They are opaque, not transparent.** A transparent icon renders as a black
  square on some Android launchers.

The header mark itself is `TicketMark` in `components/site-header.tsx` — it is
inline SVG, not one of these files, so it is replaced separately.
