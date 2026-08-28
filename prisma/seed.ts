import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

/**
 * Default marketplace categories.
 *
 * `slug` is ASCII on purpose: it becomes the URL segment (/category/amulets),
 * which keeps links, analytics and shared URLs readable instead of
 * percent-encoded Thai.
 */
const CATEGORIES = [
  { name: "ภาพเขียนศิลปะ", slug: "art-paintings" },
  { name: "นาฬิกา", slug: "watches" },
  { name: "โทรศัพท์", slug: "phones" },
  { name: "อุปกรณ์ไอที", slug: "it-gadgets" },
  { name: "ของสะสม", slug: "collectibles" },
  { name: "พระเครื่อง", slug: "amulets" },
  { name: "Art Toys", slug: "art-toys" },
  { name: "การ์ดสะสม", slug: "trading-cards" },
  { name: "กระเป๋า/รองเท้าแบรนด์เนม", slug: "brand-bags-shoes" },
  { name: "กล้อง", slug: "cameras" },
  { name: "ต้นไม้ด่าง", slug: "variegated-plants" },
  { name: "เครื่องประดับ", slug: "jewelry" },
] as const;

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill in the password.",
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    // upsert keyed on the unique slug, so re-running the seed is safe: it
    // renames an existing category rather than creating a duplicate.
    for (const category of CATEGORIES) {
      await prisma.category.upsert({
        where: { slug: category.slug },
        update: { name: category.name },
        create: category,
      });
    }

    const total = await prisma.category.count();
    console.log(`Seeded ${CATEGORIES.length} categories (${total} total).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
