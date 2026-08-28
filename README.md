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
