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
