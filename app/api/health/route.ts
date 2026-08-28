import { prisma } from "@/lib/prisma";

/**
 * Health check that proves the app can actually reach PostgreSQL.
 *
 * `force-dynamic` matters here: Prisma queries are invisible to Next.js's
 * prerender analysis (unlike `fetch`), so without this the handler could be
 * evaluated at build time — where DATABASE_URL may not exist — and then serve a
 * stale, cached "ok" forever.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const categoryCount = await prisma.category.count();

    return Response.json({
      status: "ok",
      database: "connected",
      categoryCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Log the full error server-side only. The response deliberately omits it:
    // Prisma connection errors can echo the DATABASE_URL, credentials included.
    console.error("[health] database check failed:", error);

    return Response.json(
      {
        status: "error",
        database: "unreachable",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
