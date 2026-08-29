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
  // What this marketplace was built for.
  { name: "พระเครื่อง", slug: "amulets" },
  { name: "ของสะสม", slug: "collectibles" },
  { name: "Art Toys", slug: "art-toys" },
  { name: "การ์ดสะสม", slug: "trading-cards" },
  { name: "ภาพเขียนศิลปะ", slug: "art-paintings" },
  { name: "นาฬิกา", slug: "watches" },
  { name: "เครื่องประดับ", slug: "jewelry" },

  // Fashion.
  { name: "กระเป๋าแบรนด์เนม", slug: "brand-bags-shoes" },
  { name: "รองเท้า", slug: "shoes" },
  { name: "เสื้อผ้า เครื่องแต่งกาย", slug: "fashion" },

  // Electronics. `phones` and `it-gadgets` are renamed rather than replaced:
  // the upsert is keyed on slug, so existing listings keep their category.
  { name: "มือถือ แท็บเล็ต", slug: "phones" },
  { name: "คอมพิวเตอร์ ไอที", slug: "it-gadgets" },
  { name: "กล้อง", slug: "cameras" },
  { name: "เกม", slug: "games" },

  // Hobbies and home.
  { name: "เครื่องดนตรี", slug: "musical-instruments" },
  { name: "กีฬา", slug: "sports" },
  { name: "หนังสือ งานอดิเรก", slug: "books-hobbies" },
  { name: "ต้นไม้ด่าง", slug: "variegated-plants" },
  { name: "บ้านและสวน", slug: "home-garden" },
  { name: "เครื่องใช้ไฟฟ้า", slug: "appliances" },
  { name: "สุขภาพและความงาม", slug: "health-beauty" },
  { name: "แม่และเด็ก", slug: "mother-baby" },

  // Vehicles. Everything here fits under MAX_PRICE_SATANG (฿1,000,000) and can
  // actually change hands; property does not, on either count.
  { name: "จักรยาน", slug: "bicycles" },
  { name: "มอเตอร์ไซค์", slug: "motorcycles" },
  { name: "รถมือสอง", slug: "cars" },
  { name: "อะไหล่รถ ประดับยนต์", slug: "car-parts" },
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
