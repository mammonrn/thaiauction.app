import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // Prisma 7 no longer runs the seed automatically after a migration.
    // Run it explicitly with `npm run prisma:seed`.
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // The connection string lives ONLY in the environment, never in the repo.
    // Read via process.env (not Prisma's env() helper): env() throws while the
    // config file is being loaded, which would break even offline commands like
    // `prisma generate`. Commands that actually connect still fail loudly.
    url: process.env["DATABASE_URL"],
  },
});
