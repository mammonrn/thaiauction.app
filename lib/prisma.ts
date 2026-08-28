import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Why a global singleton?
 *
 * In development, Next.js hot-reloads modules on every file save. A plain
 * module-level `new PrismaClient()` would therefore run again on each reload,
 * and every instance opens its own PostgreSQL connection pool. Old instances
 * are not garbage-collected while their sockets are alive, so after a few dozen
 * saves Postgres starts rejecting connections with "too many clients already"
 * (default max_connections is 100).
 *
 * `globalThis` survives hot reload, so caching the client there makes every
 * reload reuse the same pool. In production the module is evaluated once per
 * server instance, so a module-scoped variable is used instead and nothing is
 * attached to the global object.
 *
 * Why lazy?
 *
 * `next build` imports every route module to collect its configuration. If the
 * client were constructed at import time, that import would throw on any
 * machine without DATABASE_URL (CI, a fresh clone, Docker image build) and fail
 * the build — even though the route only ever queries at request time. Creating
 * the client on first property access keeps the module import side-effect free.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

let productionClient: PrismaClient | undefined;

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill in the password.",
    );
  }

  // Prisma 7 talks to PostgreSQL through a driver adapter rather than a bundled
  // query engine binary, so the pg pool is created explicitly here.
  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["error"],
  });
}

function getPrismaClient(): PrismaClient {
  if (process.env.NODE_ENV === "production") {
    return (productionClient ??= createPrismaClient());
  }
  return (globalForPrisma.prisma ??= createPrismaClient());
}

/**
 * Shared Prisma client. Use it exactly like a normal `PrismaClient`
 * (`prisma.category.count()`); the real instance is created on first use.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    // Never instantiate just because something probed for a thenable — e.g.
    // `await`-ing a value that happens to be this object.
    if (property === "then") return undefined;

    const client = getPrismaClient();
    const value = Reflect.get(client, property, receiver);

    return typeof value === "function" ? value.bind(client) : value;
  },
});
