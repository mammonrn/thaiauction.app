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
