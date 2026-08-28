This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Database (Prisma + PostgreSQL)

### Setup

1. Copy the environment template and fill in the real password:

   ```bash
   cp .env.example .env
   ```

   `.env` is git-ignored. Never commit real credentials.
   If the password contains special characters (`@ : / ? # [ ] %`), URL-encode
   them — e.g. `p@ss` becomes `p%40ss`.

2. Apply the schema and load the default categories:

   ```bash
   npm run prisma:migrate   # development: creates/applies migrations
   npm run prisma:seed      # inserts the 12 default categories (idempotent)
   ```

   On a production/VPS deployment use `npm run prisma:deploy` instead, which
   applies existing migrations without generating new ones.

3. Verify the connection:

   ```bash
   npm run dev
   curl http://localhost:3000/api/health
   # {"status":"ok","database":"connected","categoryCount":12,...}
   ```

   The endpoint returns HTTP 503 with `"database":"unreachable"` if PostgreSQL
   cannot be reached.

### Database user permissions

`prisma migrate dev` needs a *shadow database* to detect schema drift, so the
database user must be allowed to create databases:

```sql
ALTER ROLE thaiauction_app CREATEDB;
```

This is only required for `migrate dev`. `prisma migrate deploy` (production)
does not use a shadow database, so the production role does not need `CREATEDB`.

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run prisma:generate` | Regenerate the client into `generated/prisma` (also runs on `npm install`) |
| `npm run prisma:migrate` | Create and apply a migration (development) |
| `npm run prisma:deploy` | Apply existing migrations (production) |
| `npm run prisma:seed` | Insert the default categories |
| `npm run prisma:studio` | Open Prisma Studio |

### Conventions

- **Money is stored as integer satang** (1 baht = 100 satang), never floats.
  Use the helpers in `lib/money.ts` to convert and format.
- **The generated client is not committed** (`generated/prisma` is git-ignored);
  it is rebuilt by the `postinstall` hook.
- **`DATABASE_URL` is read only from the environment.** It is deliberately absent
  from `prisma/schema.prisma`; `prisma.config.ts` supplies it.

## Authentication (Better Auth)

Sign-in is handled by [Better Auth](https://better-auth.com) 1.7.2, backed by
the same PostgreSQL database via the Prisma adapter.

### Setup

1. Add the auth variables to `.env` (see `.env.example`):

   ```
   BETTER_AUTH_SECRET=...   # openssl rand -base64 32
   BETTER_AUTH_URL=...      # public origin, no trailing slash
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```

2. In the Google Cloud Console, add this **authorised redirect URI** exactly:

   ```
   <BETTER_AUTH_URL>/api/auth/callback/google
   ```

3. Apply the migration:

   ```bash
   npm run prisma:deploy   # production
   npm run prisma:migrate  # development
   ```

### How it works

| Piece | Responsibility |
| --- | --- |
| `lib/auth.ts` | Server config. Reads every secret from the environment. |
| `lib/auth-client.ts` | Browser client. Uses the current origin, so `BETTER_AUTH_URL` is never exposed to the client. |
| `app/api/auth/[...all]` | Mounts all Better Auth endpoints. |
| `lib/session.ts` | `getSession()` / `requireSession()` — the real, database-backed check. |
| `proxy.ts` | Optimistic cookie check only. **Not** a security boundary. |

### Protecting a route

Add the path to `PROTECTED_ROUTES` in `proxy.ts` for the fast redirect, then do
the authoritative check inside the page:

```ts
const { user } = await requireSession("/sell");
```

The proxy check exists only to avoid rendering a page for an obviously
signed-out visitor. Next.js documents that layer as unsuitable for
authorization on its own, so `requireSession()` is what actually protects data.

### Sessions

Sessions live in the `sessions` table, with no cookie cache. Every request
re-validates against the database, so signing out or revoking a session takes
effect immediately.

### Adding a password to a Google account

Password **sign-up** is disabled (`emailAndPassword.disableSignUp`). The only
way a password enters the system is a signed-in user visiting
`/account/security`, which calls `setPassword`. That endpoint is declared
`serverOnly` in Better Auth, so it is invoked from a Server Action rather than
the browser client. It adds a second `accounts` row with providerId
`credential`; the Google row is left untouched, and the user can then sign in
either way.

### Account linking

`accountLinking.trustedProviders` is `["google"]`, and
`requireLocalEmailVerified` is left at its default (`true`). Google sign-in
links to an existing user only when both Google and the local record consider
the email verified, so a pre-registered unverified account cannot capture
someone else's Google identity.

### Version note

`@better-auth/cli` (used to generate the auth models) is published only up to
1.4.21 and is marked deprecated, while the library is 1.7.2. Its output was
missing `accounts.issuer` and the `(issuer, accountId)` unique index, which
breaks sign-in at runtime. If you regenerate the schema with that CLI, re-check
those against the library's own `getAuthTables()` before migrating.

## Account pages

| Route | Purpose |
| --- | --- |
| `/account` | Profile (name, email, Google avatar) and links to the sections below |
| `/account/addresses` | Shipping address CRUD |
| `/account/security` | Add a password to a Google-only account |

All three call `requireSession()`, so they are protected by the real
database-backed check, not just the optimistic `proxy.ts` redirect.

### Shipping addresses

Mutations are Server Actions in `app/account/addresses/actions.ts`. Each one
resolves the target row through `findOwnedAddress()`, which puts `userId` in the
`WHERE` clause instead of reading the row and comparing afterwards — so a
guessed id matches nothing and there is no gap between the check and the write.

**One default per user** is enforced in two places:

1. `setDefaultAddressAction` clears the existing default and sets the new one
   inside a single `prisma.$transaction`, in that order.
2. A partial unique index in the database is the backstop:

   ```sql
   CREATE UNIQUE INDEX "shipping_addresses_one_default_per_user"
     ON "shipping_addresses" ("userId") WHERE "isDefault";
   ```

Prisma's schema language cannot express a `WHERE` clause on an index, so that
index lives in a hand-written migration and is deliberately **absent from
`schema.prisma`**. This does not upset Prisma: `migrate status` reports the
schema up to date, and `migrate dev --create-only` generates an empty migration
rather than trying to drop the index.

Related behaviour: the first address saved becomes the default automatically,
and deleting the default promotes the oldest remaining address in the same
transaction, so a user with any addresses always has one selected.

### Validation

`lib/address-validation.ts` carries no `"use client"` or `"use server"`
directive, so the same rules run in the browser for feedback and on the server
where they are enforced. The Server Action never trusts the client checks.

- **Phone** — mobile `0[6/8/9]` + 8 digits (10 total), or landline `0[2-7]` + 7
  digits (9 total). `+66` / `0066` prefixes and spaces, dashes, dots and
  parentheses are stripped before validating, and the normalised form is stored.
- **Postal code** — exactly 5 digits, never starting with 0.

Note for anyone adding another form: React 19 resets an uncontrolled form once
its action resolves. A failing action must echo the submitted values back in its
state (see `AddressActionState.values`) or the user loses everything they typed.

## Postcode auto-fill

Typing a 5-digit postcode in the address form fills in จังหวัด / อำเภอ / ตำบล.
The lookup is entirely client-side — no runtime call to any external service.

### Dataset, source and license

| | |
| --- | --- |
| Source | [kongvut/thai-province-data](https://github.com/kongvut/thai-province-data) |
| File | `api/latest/sub_district_with_district_and_province.json` |
| License | **MIT** — commercial use permitted |
| Bundled as | `lib/data/thai-postcodes.json` |
| Regenerate | `node scripts/build-postcode-index.mjs` |

The upstream `LICENSE` is MIT (Copyright © 2025 Kongvut Sangkla), which permits
use, modification and distribution including commercially, provided the
copyright notice and permission notice are retained. Keep the attribution in
`scripts/build-postcode-index.mjs` and in the generated file's `source` /
`license` fields if the data is redistributed.

An alternative, `Sellsuki/thai-address-database`, was considered and rejected:
it declares ISC only in `package.json` with no LICENSE file in the published
package, and derives from a WTFPL upstream. Both are usable commercially, but
kongvut's ships a real license file, names its copyright holder, is still
maintained, and documents its provenance.

### Why the index is rebuilt rather than used as-is

The upstream file is **6.2 MB**: it embeds the full province and district
record inside each of the 7,452 sub-district rows, plus timestamps, English
names and coordinates this project does not use. `scripts/build-postcode-index.mjs`
de-duplicates provinces and districts into lookup tables and drops the unused
columns, giving **272 KB (59 KB gzipped)** — small enough to ship to the
browser. It is loaded with a dynamic `import()`, so it lands in its own chunk
and is fetched only when an address form is opened.

### Why resolution is per field

Thailand has only **955 postcodes** for 7,452 sub-districts, so a postcode is a
coarse key:

| A postcode identifies… | Share of postcodes |
| --- | --- |
| the province | 99.2% |
| the district | 81.8% |
| the sub-district | **3.5%** |

Filling all three only when all three are certain would auto-fill almost
nothing. So each field is resolved on its own: filled when the postcode leaves
exactly one possibility, and presented as a dropdown of the real candidates
when it does not. Nothing is guessed.

Every field stays editable, and each dropdown carries an "อื่นๆ (กรอกเอง)"
option that swaps it for a text box — the dataset can lag new administrative
areas. An unrecognised postcode is not an error: the fields stay manual and a
note explains why.

### Implementation notes

`lib/postcode-lookup.ts` exposes the index as an external store
(`subscribe`/`getSnapshot`) read with `useSyncExternalStore`, and every resolved
value is derived during render. Storing them in state and syncing with effects
would trip the React Compiler's `set-state-in-effect` rule and cause cascading
re-renders.

Two cascade rules are load-bearing, both found by testing:

- A candidate list falls back to the unscoped postcode when scoping by the
  value above it matches nothing. Without this, typing a province the dataset
  does not know blanks the district — which is `required`, so the form silently
  refuses to save.
- Choosing a real area prunes a narrower pick that cannot sit inside it, but
  only when the chosen value exists in the dataset, so a hand-typed value never
  discards what the user entered.

## Phone verification (Thaibulksms OTP)

`/account/phone` verifies a Thai mobile number by SMS.

### Credentials

Both are required — **every** OTP call carries `key` and `secret` in its request
body:

```
THAIBULKSMS_API_KEY
THAIBULKSMS_API_SECRET
```

> These are the **OTP** credentials, issued in the OTP console at
> <https://otp-manager.thaibulksms.com>. They are **not** the Send-SMS API
> key/secret: that is a different product at `api-v2.thaibulksms.com` using HTTP
> Basic auth. Using the SMS pair here returns `Application not found.`

### The API

Taken from Thaibulksms' own OTP manual
([PDF](https://assets.thaibulksms.com/documents/Thaibulksms-otp.pdf)) and their
official Node client [`thaibulksms-api`](https://www.npmjs.com/package/thaibulksms-api),
published by 1Moby Co., Ltd. — the company that owns Thaibulksms.

| | |
| --- | --- |
| Request | `POST https://otp.thaibulksms.com/v2/otp/request` — `{ key, secret, msisdn }` |
| → | `{ status: "success", token, refno }` |
| Verify | `POST https://otp.thaibulksms.com/v2/otp/verify` — `{ key, secret, token, pin }` |
| → | `{ status: "success", message: "Code is correct." }` |

**Thaibulksms generates, sends, times out and checks the PIN.** This app never
generates or stores a code — only the opaque `token`. The PIN's real lifetime is
whatever the OTP console is configured for (its SMS says "Valid for 5 minutes").

Notable provider errors, mapped to Thai messages in `lib/thaibulksms.ts`:
`Code is invalid.`, `Token is expire.`, `Application not found.`,
`ERROR_MSISDN_EXCEEDED_LIMIT` (115) and `ERROR_INSUFFICIENT_CREDIT` (116, HTTP 423).

### Where "verified" lives

`verified_phones`, keyed `(userId, phone)` — not on the user and not on each
address. One user legitimately has several numbers (their own and a
recipient's), the same number is often reused across addresses and should not
cost a second SMS, and this keeps a record of when each was proved.

### Limits

Applied **before** the provider is called, so abuse never becomes a billed SMS
(`lib/otp-policy.ts`):

| Limit | Value |
| --- | --- |
| Resend cooldown | 60 s |
| Sends per number | 5 per hour |
| Wrong PINs per challenge | 5, then the challenge is dead |
| Local expiry | 5 min |

The send limits are keyed on the **phone number**, not the account, so they
cannot be sidestepped by switching accounts and one account cannot spam a
stranger's handset.

Verification looks the token up server-side from the caller's own newest live
challenge; the client only ever sends the number and 6 digits. Consuming the
challenge and writing the verified number happen in one transaction, so a token
cannot be replayed and a number cannot be marked verified without one.

### Testing without spending credit

Since Thaibulksms generates the PIN, there is no way to log the real code. For
development and staging:

```
OTP_STUB_MODE="stub-sms-no-real-otp"   # then the code is 000000
```

The value must match exactly; anything else is rejected rather than ignored, so
a leftover `1` cannot silently disable SMS verification. It is deliberately not
tied to `NODE_ENV` — `next start` always runs as production, which would make
stub mode unusable on a staging build. Every stubbed call logs a warning.
**Never set this on the production VPS.**

### What still needs testing on the VPS

The real SMS round-trip cannot be exercised here: it needs live credentials and
sends a real, billed message. On the VPS, with `OTP_STUB_MODE` unset, confirm
that the SMS arrives, that its `refno` matches the one shown on screen, and that
the code verifies.

## Selling (auction listings)

| Route | Purpose |
| --- | --- |
| `/sell` | The seller's own listings, drafts included |
| `/sell/new` | Create a listing (saved as a draft) |
| `/sell/[id]/edit` | Edit, publish or delete a draft |
| `/auctions/[id]` | Public detail page (active and ended only) |

### Verified phone required

`/sell/new` and publishing both call `requireVerifiedSeller()`, which needs at
least one row in `verified_phones`. Listing an item is where a stranger is asked
to send money, so a seller has to be reachable by more than a throwaway email.
Sellers without one are redirected to
`/account/phone?reason=sell&next=/sell/new`, which explains why and links back.
`next` accepts only a relative single-slash path, so it cannot become an open
redirect.

### When a listing can be edited

| State | Editable |
| --- | --- |
| `draft` | Yes — it is private |
| `active`, no bids | Yes |
| `active`, has bids | **No** |
| `ended` / `cancelled` | No |

Once a bid exists the **whole** listing locks, not just the price: changing the
photos or description alters what someone committed money against just as much
as changing the number. The rule lives in `lib/auction-rules.ts` and is
re-checked inside the Server Action, not merely used to hide the form — a tab
opened before the first bid cannot post an edit after it.

### Image uploads

Stored **outside the project directory**, at `UPLOAD_DIR`:

```
UPLOAD_DIR="/var/lib/thaiauction/uploads"
```

Keep it outside so a redeploy, rebuild or `git clean` cannot delete uploads, and
back that directory up — it is the one piece of state not in PostgreSQL. It
defaults to `./storage/uploads` (git-ignored) for local development.

```
<UPLOAD_DIR>/staging/<userId>/<uuid>.webp   before the listing is saved
<UPLOAD_DIR>/items/<itemId>/<uuid>.webp     after
```

**Validation is by content, never by name.** sharp parses the bytes, so a file
that is not a real JPEG/PNG/WebP fails to decode whatever its extension or
`Content-Type` claims. It is then re-encoded to WebP, so what lands on disk is
an image sharp itself produced — a real image with a payload appended does not
survive the round trip. Filenames are fresh UUIDs, never the uploader's, so a
name can carry no path and no second extension. `rotate()` applies the EXIF
orientation before the metadata is dropped, which keeps phone photos upright and
strips the GPS coordinates many cameras embed.

| Limit | Value |
| --- | --- |
| Max per file | 10 MB |
| Images per item | 1–10 |
| Longest edge | 1600px |
| Stored format | WebP, quality 82 |

A 4000×3000 JPEG comes out at roughly 5% of its original size.

Uploads go one file per request to `/api/uploads`, not through the form action:
a Server Action body is capped at 1MB by default and ten untouched phone photos
are far past any sane cap. Each file lands in the caller's staging area and is
moved into `items/<itemId>/` on save — which is also what proves the caller owns
the file it is claiming. Orphaned staged files are swept after 24 hours on the
next upload by the same user.

Images are served by `/api/images/[...key]`, which pattern-checks the key and
confirms the resolved path is inside the upload root, so a crafted key cannot
walk out of it. Item images are public and cached immutably; staging images are
private to their owner. For production, that route can be put behind nginx
serving `UPLOAD_DIR` directly if the extra hop matters.

### Client/server split

`lib/uploads.ts` is `server-only` and pulls in sharp. Anything the browser also
needs — the image limits, key shapes and `imageUrl()` — lives in
`lib/image-keys.ts` instead. Importing the former from a client component drags
sharp into the browser bundle and fails the build.

### Bid increment

Each listing carries `bidIncrement`, the smallest step a new bid must clear the
current price by, stored as **Int satang** like every other price. Default
**฿10** — low enough not to shut out cheap listings, high enough that bidding
does not crawl up in single satang. The column default matches, so rows created
before the field existed behave sensibly.

Beyond requiring at least ฿1, one rule is worth noting: when a buy-now price is
set the step may not exceed `buyNowPrice - startPrice`. Otherwise the very first
legal bid already overshoots buy-now and nobody could bid at all.

The value is only stored for now; the bidding system will enforce it.

### Thai date and time

**Native `<input type="datetime-local">` cannot be reformatted.** Tested in
Chromium under browser locale `th-TH`, with `lang="th"` and even
`lang="th-TH-u-ca-buddhist"`, it still rendered:

```
08/28/2026, 02:30 PM
```

Gregorian year, AM/PM, US field order. The `lang` attribute has no effect —
the format comes from the browser and OS, not the page, and no attribute or CSS
changes it. So `components/thai-datetime-picker.tsx` replaces it with five plain
`<select>`s: day, full Thai month, พ.ศ. year, 00–23 hour, minute, with a live
`28 สิงหาคม 2569 เวลา 14:30 น.` preview.

Selects rather than a calendar popup: the format stays entirely under our
control, they are keyboard- and screen-reader-friendly without a focus trap to
maintain, and mobile gets the platform's own picker wheels.

Two details worth keeping:

- The posted value is the **exact instant as a UTC ISO string**, not a local
  wall-clock string. The stored time therefore no longer depends on the server's
  timezone matching the seller's. Database values stay UTC; only presentation is
  Thai.
- The picker receives the current time as a **prop from its Server Component
  parent**. The React Compiler purity rules reject `Date.now()` during render,
  and it also means the form's "too soon" hint is measured against the same
  clock the Server Action validates with, so the two cannot disagree.

Month names come from `Intl` rather than being typed out, so they cannot drift
from the platform's spelling, and switching to a shorter month clamps the day
instead of producing 31 กุมภาพันธ์. Formatting helpers live in
`lib/thai-datetime.ts` and are used by the public auction page too.

### Publish confirmation

Publishing opens a review dialog listing the images, title, category, both
prices, the bid increment and the closing time, and publishes only on a second
confirmation. Once a bid lands the listing cannot be edited at all, so this is
the seller's last chance to catch a wrong price or photo.

Built on native `<dialog>`, which provides focus trapping, Esc-to-close and
background inertness that a div-based modal would have to reimplement.

## Bidding

### Concurrency

Every bid and every close runs inside a transaction that first takes a row lock:

```sql
SELECT ... FROM auction_items WHERE id = $1 FOR UPDATE
```

PostgreSQL serialises simultaneous bidders on that row, so the second one reads
the price the first **committed**, not the stale price it saw on arrival.
Checking `currentPrice` in application code alone would not work — both requests
would read the same value and both would pass. The existing unique index on
`(auctionItemId, amount)` is a second line of defence, so even a path that
skipped the lock could not record two bids at one amount.

Verified two ways against a throwaway database:

- **20 parallel transactions** — 20 identical bids produced exactly one accepted
  bid and one row; 20 ascending bids produced a strictly rising sequence, each
  clearing the previous price by at least the increment, with the losers of each
  race correctly rejected rather than overwriting a higher price.
- **8 concurrent browsers over real HTTP** — all clicking bid at the same amount
  at once produced exactly one recorded bid and one success message.

### Bid rules

| Rule | Why |
| --- | --- |
| Verified phone required | A bid commits the bidder to pay; the seller must be able to reach the winner |
| Seller cannot bid on their own item | Shill bidding |
| Current leader cannot raise their own bid | It only inflates the price they will pay |
| `amount >= currentPrice + bidIncrement` | The seller's step |
| `amount <= buyNowPrice` | Bids may not exceed the advertised buy-now price |

Where `currentPrice + bidIncrement` would land **above** buy-now, buy-now itself
becomes the only acceptable amount. Without that special case the increment
could put the item out of reach and nobody could bid at all.

A bid equal to buy-now ends the auction immediately with that bidder as winner.

### Settlement

The outcome is **recorded, not derived** — `endedAt`, `endReason` and `winnerId`
are written when the auction stops, so it stays a fixed fact.

| Trigger | Result |
| --- | --- |
| `endTime` passes | `ended`, winner = highest bidder or none |
| Bid at buy-now | `ended`, reason `buy_now` |
| Seller ends early, with bids | `ended`, highest bidder wins |
| Seller ends early, no bids | `cancelled`, no winner — a withdrawal, not a sale |

**Expiry is handled lazily plus a sweep.** Viewing an auction, or polling its
live state, settles it — which covers everything anyone is actually looking at.
For auctions that end with nobody watching:

```bash
npm run auctions:settle
```

A script rather than an HTTP endpoint, so cron runs it with the `DATABASE_URL`
the app already has: no public route to protect and no shared secret to manage.
It is idempotent, so a missed run costs nothing. Suggested crontab:

```
*/5 * * * * cd /srv/thaiauction && /usr/bin/npm run auctions:settle >> /var/log/thaiauction-settle.log 2>&1
```

### Live prices

The detail page polls a small JSON endpoint every 5s, paused while the tab is
hidden. On a single VPS running one Node process, SSE or WebSockets would add
connection management and a sticky-session constraint to save a few seconds on
an auction that runs for hours. The countdown is measured against the server's
clock, sent with each poll, so a device with the wrong time still shows the
right remaining time.

Note for anyone extending this: the panel adopts fresh server props during
render. Ending an auction happens in a sibling component, and without that sync
the price panel keeps its mounted state and shows a stale "active" until the
next poll.

### Bid history privacy

Bidder names are masked to a first character — `ส***`, or `คุณ` for your own
bids. A full name beside a bid amount invites approaching the underbidder
off-platform or working out a rival's budget.

### Auction length

Capped at one year, measured from the listing's `createdAt` rather than from
now, so editing a draft weeks later cannot quietly extend the window.

## Seller identity verification (KYC)

A seller uploads a photo of their national ID card; an administrator looks at it
and approves or rejects. No automated face matching.

| Route | Who |
| --- | --- |
| `/account/verification` | The seller — submit, see status, resubmit if rejected |
| `/admin/verifications` | Administrators only |
| `/api/kyc/submit` | Upload (owner) |
| `/api/kyc/[...key]` | Read a document — **owner or admin only** |

### Two steps: reference data, then the card

Approving an ID card means saying *this card belongs to this person*, so the
reviewer needs something to compare it against. `/account/verification` asks for
it first:

- **ขั้นที่ 1** — `firstName`, `lastName`, `dateOfBirth` on `users`.
- **ขั้นที่ 2** — the card image, offered only once step 1 is complete.

These are columns on `users`, not on `seller_verifications`, and they are **kept
permanently** — unlike the image, which is erased on decision. They are ordinary
personal data rather than s.26 sensitive data, and they are what an approval
actually attests to: an approval that outlived the name it was granted for would
mean nothing.

`name` is left alone. Better Auth takes it from the Google profile and a nickname
there is fine — it is just not what is printed on the card.

`dateOfBirth` is a date, not a moment, so it is stored at **UTC midnight** and
the calendar date cannot shift when rendered in another timezone.

#### The 18+ rule is a seller rule only

`lib/identity.ts` holds the rules and is imported by both the client form and the
server, so one definition governs both:

- a date of birth may not be in the future;
- a seller must have completed 18 years **on the day they submit**.

Someone under 18 is told so plainly, and told in the same breath that buying and
bidding still work. The check lives on the KYC path only — nothing in the buyer
flow reads `dateOfBirth`, so an ordinary buyer never supplies one and is never
age-gated.

It is enforced in three places, because the first two can be bypassed: the form
(a `max` on the date input, plus inline errors), `saveIdentityAction`, and
`/api/kyc/submit`, which re-reads the stored row and refuses the document if the
identity is incomplete or underage. That endpoint is directly callable, so it
cannot assume the page gated it.

#### Editing is locked during and after review

`canEditIdentity` refuses edits while a request is **pending or approved**.
Pending matters as much as approved: a reviewer is comparing exactly this data
against the card, and a value that changes mid-review makes the comparison
meaningless. The rule is re-checked inside the action, so a stale tab cannot
write through a form the server would no longer render.

#### The reviewer sees it beside the card

`/admin/verifications` prints the declared name and date of birth — with the age
worked out — **above** the image, so the reviewer reads what to expect and then
checks the card against it, rather than reading the card and rationalising a
match.

This data is read only for the signed-in user's own row, or by an admin on the
review page. No public page or API selects it: the auction page and
`/api/auctions/[id]/state` name their user columns explicitly (`name`, `image`),
and it is not registered as a Better Auth `additionalField`, so it never reaches
a session payload either.

### Who is an admin

```
ADMIN_EMAILS="you@example.com,someone@else.com"
```

Deliberately **not** a column on `users`. Admin rights then live outside the
database, so someone who gains write access to PostgreSQL still cannot make
themselves an admin and read other people's ID cards — worth more here than
being able to change the list without a restart. An unset or empty value grants
nobody. Only `lib/admin.ts` decides, so moving to a role column later touches one
file.

A signed-in non-admin gets **404, not 403** — there is no reason to confirm to a
stranger that an admin area exists.

### Storage is completely separate from product images

```
UPLOAD_DIR      /var/lib/thaiauction/uploads   public product photos
UPLOAD_DIR_KYC  /var/lib/thaiauction/kyc       identity documents
```

Separate directory, separate key shape, separate module (`lib/kyc-storage.ts`)
and separate route. Product images are public and cached for a year; sharing any
of that machinery would mean one mistake in the product-image path could expose
an ID card. Create the directory restricted to the app account:

```bash
sudo install -d -m 700 -o <app-user> -g <app-group> /var/lib/thaiauction/kyc
```

Documents go through sharp exactly as product images do — decoded, so a file
that is not a real image fails, then re-encoded, so nothing smuggled inside
survives — but at **2400px / quality 92** rather than 1600px / 82, because a
reviewer has to read the print on the card.

Reading a document requires being its owner or an admin; anyone else gets 404,
so a guessed key cannot even confirm a document exists. The key alone is not
authority: the document must still be attached to a live submission, so a key
stops resolving the moment a decision clears it. Responses are `no-store,
private` with `no-referrer` and `nosniff`, and the review UI renders the image
`unoptimized` so Next's image optimiser cannot copy the card into its own cache
outside the protected directory.

### Retention (PDPA)

**The image is erased the moment a decision is made** — approve or reject alike.
`documentKey` is cleared and `documentDeletedAt` stamped as evidence the rule
ran. What survives is the audit trail: who decided, when, and the reason for a
refusal.

Consequences worth knowing:

- A rejected seller must upload again, since their previous image is gone. This
  is intended.
- Uploading again replaces any pending request and erases its image, so **at
  most one document per person exists at any time**.
- A seller can withdraw a pending request themselves and have the image erased
  without waiting for a reviewer.
- The declared name and date of birth are **not** erased with the image. They are
  ordinary personal data and the record of what was approved; removing them is an
  erasure request, handled outside this flow.
- Because files are erased on decision, **do not back up `UPLOAD_DIR_KYC`** —
  or if you must, use a backup that expires faster than your retention promise.
  A backup would otherwise outlive the deletion.

The upload page asks sellers to cover the **ศาสนา** field before photographing.
It appears on some Thai ID cards, is sensitive personal data under PDPA s.26
with stricter handling requirements, and is not needed to check identity.

> This reflects a data-minimisation reading of PDPA and is not legal advice. If
> you later need to retain documents to satisfy a specific obligation (AML,
> dispute evidence), revisit the policy with counsel before changing it.

### Badges

`components/seller-badges.tsx` renders two distinct badges. A **verified phone**
means a number was proved reachable; **verified identity** means a human checked
a government ID. They are worded and coloured differently on purpose — letting
them read alike would overstate what the weaker one proves.

## Payments (Omise)

The winner pays through Omise, by card or PromptPay QR. The marketplace
receives the money, keeps 10%, and transfers the rest to the seller by hand.

| Route | Who |
| --- | --- |
| `/auctions/[id]/pay` | The auction's current winner, nobody else |
| `/api/payments/[id]/state` | The payer only — poll target |
| `/admin/payouts` | Administrators only |
| `/account/bank` | The seller — where their share is sent |

```
OMISE_PUBLIC_KEY   pkey_...   safe in the browser; tokenises cards
OMISE_SECRET_KEY   skey_...   server only, never sent to a client
```

`OMISE_ALLOW_LIVE=1` is required before a live (non-`skey_test_`) key will be
used at all, so a production key dropped into a staging `.env` fails loudly
instead of moving real money.

### Card data never reaches this server

The browser tokenises with Omise.js against the **public** key; what arrives at
the Server Action is a `tokn_...` handle. This is the only way to accept cards
without a PCI-DSS licence, and it is enforced structurally rather than by
convention: **the card inputs have no `name` attribute**, so they cannot be
serialised into a Server Action's FormData even if the submit handler were
wrong. The action reads no field but `token`.

### Omise is the only authority on whether money moved

Payment status is written **exclusively** from a Retrieve Charge response
(`GET /charges/{id}`). Nothing the browser reports is believed.

There is deliberately **no webhook endpoint**. Omise's own docs say deliveries
are not guaranteed to be retried and that verifying through the API is the
alternative, so the API is used as the single source of truth rather than as a
second one — which also means no third secret to manage and no public endpoint
to protect. Confirmation happens in two places:

- the pay page polls `/api/payments/[id]/state`, and each poll makes the server
  re-ask Omise — this is what turns a scanned QR into a settled auction;
- `npm run auctions:settle` reconciles anything nobody is watching.

### Money is split from Omise's real numbers

The Charge object carries `fee`, `fee_vat` and `net`, where net is
"funding_amount after fees, interest and VAT deducted". Commission is taken
from `net` — what the marketplace actually received — not from what the buyer
paid:

```
amount      what the buyer paid (the winning bid)
− fee       Omise's fee          } straight from the Charge,
− fee_vat   VAT on that fee      } never estimated
= net
− commission   10% of net, FLOORED
= sellerNet
```

Integer satang throughout, and 10% is integer division, never `0.1 *`. The
commission is floored so rounding never falls in the platform's favour, and
`sellerNet` is computed by subtraction, so the parts always sum to exactly
`net` with no satang unaccounted for.

### Double payment is prevented by PostgreSQL, not by an if-statement

Two partial unique indexes, written by hand because Prisma cannot express them:

```sql
UNIQUE (auctionItemId) WHERE status = 'successful'  -- one payment, ever
UNIQUE (auctionItemId) WHERE status = 'pending'     -- one live attempt
```

An application-level "has this been paid?" check is not enough — two concurrent
requests both pass it. Only one can win a unique index. Verified by firing 12
simultaneous attempts at one auction: one accepted, eleven refused, and exactly
**one** charge created at the gateway.

The one-pending rule exists because **Omise's expire endpoint does not cover
PromptPay**, so a QR that has been handed out cannot be recalled. Refusing to
open a second attempt is the only way to be sure a buyer is not charged twice.
PromptPay charges therefore carry a short gateway-enforced `expires_at`, so
"wait for the first attempt to resolve" is always bounded.

A charge is created in two steps — reserve the row, then call Omise, then
record the id — and the row is claimed *before* any charge exists, so two
clicks cannot both reach the gateway. Every charge carries its payment row id
in `metadata`, so the reconcile sweep can find and adopt a charge created just
before a crash rather than leaving money unaccounted for.

### What the PromptPay QR actually is

Omise does not return a bare QR square. `download_uri` serves a **740x1050
portrait SVG payment slip** carrying the PromptPay branding, the amount and the
code. It is rendered at a fixed width with automatic height — forcing it into a
square stretches it by about 40%, and a non-uniformly distorted QR does not
scan.

The stored URI is Omise's own `api.omise.co/charges/.../downloads/...` address,
which **302-redirects to a presigned S3 link valid for 60 seconds**. That
redirect resolves without credentials, so a plain `<img src>` works; storing the
redirect target instead would save a URL that dies a minute later.

### Fee rates differ by method

Observed on the test API: a card charge is billed at about **3.65%** plus VAT,
PromptPay at about **1.65%**. This is exactly why the commission is computed
from the charge's own `net` rather than from a rate constant — a hard-coded
percentage would be wrong for one of the two methods, and would silently drift
if Omise repriced.

PromptPay charges also carry populated `fee`/`net` while still `pending`. Those
are not recorded: money has not moved yet, and only a `successful` charge
writes the split.

### The 24-hour rule and the re-offer chain

A winner has 24 hours to pay. If they do not:

1. a **strike** is recorded against them;
2. the item is offered to the next highest bidder, **at their own bid** — they
   never offered the forfeited price, so charging it would invent a bid nobody
   made, and `currentPrice` moves down with the offer;
3. that person gets their own fresh 24 hours;
4. when nobody is left, the auction ends `unpaid`.

Skipped when choosing the next holder: anyone who already forfeited this
auction (their strike row is the record, so the chain cannot loop back), and
anyone already banned.

Run from the existing settlement script, in a deliberate order:

```
npm run auctions:settle    # 1. close expired auctions
                           # 2. reconcile payments against Omise
                           # 3. forfeit lapsed deadlines
```

Reconciling **before** judging deadlines is the important part: a payment that
landed while nobody was watching must be seen first, or a buyer who paid on
time would be struck for not paying.

### Declines

A card settles synchronously, so a decline is reported straight back from the
Server Action rather than left for the browser's next poll to discover.

Omise returns `failure_message` in English. The buyer is shown a Thai
explanation keyed off the stable `failure_code` (`lib/omise-failures.ts`), with
Omise's English as the fallback for unmapped codes. The original English is
still stored — the database keeps what the gateway said, the UI shows what the
buyer can act on.

### Testing against the real API

Test keys are prefixed `pkey_test_` / `skey_test_`. Cards settle immediately;
PromptPay is an offline flow, so a test charge is advanced with Omise's own
test-mode endpoints rather than by scanning anything:

```bash
curl https://api.omise.co/charges/{id}/mark_as_paid   -X POST -u $OMISE_SECRET_KEY:
curl https://api.omise.co/charges/{id}/mark_as_failed -X POST -u $OMISE_SECRET_KEY:
```

The same actions are on the dashboard's yellow **Actions** button. Useful test
cards: `4242424242424242` succeeds, `4111111111140011` returns
`insufficient_fund`.

### Payouts

`/admin/payouts` lists what is owed. Every figure shown is stored, not
recalculated — a page that recomputed them could quietly disagree with what was
actually taken. Marking a transfer requires a bank reference, is guarded on
`payoutStatus` so two admins cannot both record it, and **snapshots the account
paid**: a seller can change their bank details later, and what was paid must
not change with them.

The seller's account name is compared against their KYC name and the result
recorded, but **not enforced**. Thai bank statements carry title prefixes
(นาย/นาง/นางสาว) and inconsistent spacing, so a strict match would refuse
legitimate accounts; `lib/thai-name.ts` normalises both sides and a mismatch
raises a flag for the human releasing the money.

## Anti-shill and strikes

### Refusing the seller bidding on themselves

`placeBid` already rejects the seller's own account. `lib/anti-shill.ts`
catches the same person arriving through a second one, on either signal the
marketplace has already **proved**:

- a phone number verified by SMS on both accounts;
- the same name and date of birth, checked against an ID card by a human.

Both refuse the bid outright, with a message saying which matched. Two accounts
that have both left KYC blank are not a match — they are simply two buyers.

These run *before* the bidding transaction opens, so the auction's row lock is
never held across them. An item's seller never changes, so reading it
beforehand is sound.

### Shared origin is a question, not an answer

Every bid records `ipAddress` and `userAgent`. `/admin/fraud` groups them:
several **different** accounts bidding on **one** seller's items from one
origin. That is what a sock-puppet ring looks like — and also what a family on
one router looks like, so **nothing is blocked automatically**. The page says
so on its face, and a person decides.

### Strikes

Three unpaid wins removes the right to **bid** — nothing else. A struck-out
user can still sign in, browse, and sell; the sanction matches the harm, which
is taking an auction off the market and not paying for it.

Counted from `payment_strikes` rows rather than a column, so there is no
counter that can drift from the events it summarises, and unique on
`(userId, auctionItemId)` so one missed deadline can never count twice however
often the sweep runs.

Visibility: the seller sees a warning badge beside a bidder on **their own**
listing, and admins see everything. It is never public and never exposed by the
live-state API — a seller deciding whether to let an auction run has a real
interest in knowing, and a stranger does not. Users see their own strike count
plainly at `/account/bids`; someone one deadline away from losing the right to
bid should not find out by being refused.

## Privacy and retention

`/privacy` is linked from the footer on every page. It exists because the
marketplace collects IP addresses to detect shill bidding, and PDPA requires
that collection to be disclosed with its purpose and retention.

```
npm run bids:prune    # daily; clears bid origin metadata past its window
```

IP and User-Agent are erased after **180 days**. The bid itself is never
deleted — it is a financial record; its origin is not. The script uses
`updateMany` to null the two columns, never `deleteMany`, and that distinction
is the whole point of it.

## Design system

Red and white, Shopee's arrangement, built from tokens fixed by the brief
rather than invented here.

```
--color-brand       #C41E2A   primary actions, active states, urgency
--color-brand-dark  #8B0000   header, hero band
--color-gold        #F0B429   the price readout and nothing else
--color-ink         #1A1A1A   text, and the readout's housing
--color-paper       #F7F7F7   page background; content sits on white
```

Gold is deliberately rationed. It appears on the price readout and on genuine
urgency, so it never becomes wallpaper — the moment it decorates something, it
stops meaning "this is the number".

### There is no dark theme

The palette has no dark counterpart, and Thai marketplaces are light-only. The
352 `dark:` variants inherited from the starter template were removed rather
than half-translated: a guessed dark palette that fights a fixed brand looks
worse than none. `body` sets the background explicitly, so nothing borrows the
host's colour scheme.

### Type

IBM Plex Sans Thai for everything, IBM Plex Mono for figures. One superfamily,
drawn to sit together, so the two never look bolted on.

The mono is not styling. Prices update while an auction runs, and
`font-variant-numeric: tabular-nums` is what stops every digit shifting sideways
on each poll.

### Two signature elements

**The tear line.** A listing card is a ticket: the photograph on top, a
perforated seam, then what it costs you. The notch marks a real division in the
content rather than decorating an edge. It is drawn on the seam element, not the
card, so it tracks the seam at any card width — which is why a listing card must
never set `overflow-hidden` (the image gets its own rounded wrapper instead).
`--notch-color` matches whatever the card sits on; the default is paper.

**The price window.** A recessed dark readout with gold tabular digits. It is
the one loud element on the page, so everything around it stays quiet, and it is
reserved for where the price is the decision — the grid, search, and the auction
page. On the closing-soon rail the decision is *time*, so the clock takes the
housing there and the price is plain gold type.

### Layout

Header, then content on paper, then footer. On phones the header's actions move
to a bottom tab bar, where Shopee and Lazada have trained Thai shoppers to reach
— hiding "ลงขาย" behind a hamburger would bury the one action that grows the
marketplace. The footer carries bottom padding to clear it.

`/account` gets a sidebar through `app/account/layout.tsx`, so every account
page has it without repeating a nav. On mobile there is no sidebar and the
`/account` index *is* the menu, which is how Shopee behaves.

### Browsing

`/` and `/search` share `lib/listing.ts`, so both obey one visibility rule:
`status = active`, and not past its closing time. Settlement is lazy — an
auction stays `active` until someone reads it or the sweep runs — so filtering
on status alone briefly advertises auctions that have already finished. This is
a display filter; it settles nothing.

Filters, sort and pagination are plain links that rewrite the query string, not
client state. Every view is therefore shareable and back-button-correct, and it
all works before JavaScript loads — which on a Thai mobile connection is most of
the first second. Pagination rather than infinite scroll for the same reason,
plus it does not fight the footer that carries the privacy link.

Search is `contains` on the title. Postgres has no Thai word segmentation, so a
full-text index would not tokenise Thai correctly and would give worse results
for far more work. If it gets slow the answer is a trigram index on `title`.

Under "ใกล้หมดเวลา", auctions with no closing time sort **last**
(`nulls: "last"`). They are open-ended, so they are never the most urgent thing
on the page; the default would rank them first and the sort would say the
opposite of what it promises.
