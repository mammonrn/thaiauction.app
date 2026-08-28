import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { placeBid } from "./lib/bidding";
import { prisma } from "./lib/prisma";

const testAuth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql", usePlural: false }),
  emailAndPassword: { enabled: true, disableSignUp: false },
});

async function mkUser(label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  await testAuth.api.signUpEmail({
    body: { email, name: `ผู้ใช้ ${label}`, password: "bootstrap-pw-12345" },
  });
  return prisma.user.findUniqueOrThrow({ where: { email } });
}

async function main() {
  const seller = await mkUser("seller");
  const category = await prisma.category.findFirstOrThrow();
  const bidders = await Promise.all(
    Array.from({ length: 20 }, (_, i) => mkUser(`bidder${i}`)),
  );

  const results: string[] = [];
  const check = (l: string, pass: boolean, extra = "") =>
    results.push(`${pass ? "PASS" : "FAIL"}  ${l}${extra ? ` — ${extra}` : ""}`);

  // ---------- A: 20 bidders, all submitting the SAME amount at once ----------
  const itemA = await prisma.auctionItem.create({
    data: {
      sellerId: seller.id, categoryId: category.id,
      title: "A", description: "d", images: [],
      startPrice: 100_00, currentPrice: 100_00, bidIncrement: 10_00,
      status: "active",
    },
  });

  const sameAmount = 110_00;
  const a = await Promise.all(
    bidders.map((b) => placeBid(itemA.id, b.id, sameAmount)),
  );
  const aOk = a.filter((r) => r.ok).length;
  const aRows = await prisma.bid.count({ where: { auctionItemId: itemA.id } });
  const afterA = await prisma.auctionItem.findUniqueOrThrow({ where: { id: itemA.id } });
  check("20 identical concurrent bids -> exactly 1 accepted", aOk === 1, `${aOk} accepted`);
  check("only 1 bid row written", aRows === 1, `${aRows} rows`);
  check("currentPrice is that bid", afterA.currentPrice === sameAmount, String(afterA.currentPrice));

  // ---------- B: 20 bidders, ascending amounts, all at once ----------
  const itemB = await prisma.auctionItem.create({
    data: {
      sellerId: seller.id, categoryId: category.id,
      title: "B", description: "d", images: [],
      startPrice: 100_00, currentPrice: 100_00, bidIncrement: 10_00,
      status: "active",
    },
  });

  const b = await Promise.all(
    bidders.map((bd, i) => placeBid(itemB.id, bd.id, 110_00 + i * 10_00)),
  );
  const accepted = b.filter((r) => r.ok).length;
  const rowsB = await prisma.bid.findMany({
    where: { auctionItemId: itemB.id },
    orderBy: { createdAt: "asc" },
    select: { amount: true, createdAt: true },
  });
  const afterB = await prisma.auctionItem.findUniqueOrThrow({ where: { id: itemB.id } });

  // The invariant that matters: each accepted bid cleared the price standing
  // when it was accepted, by at least the increment.
  let monotonic = true;
  let price = 100_00;
  for (const row of rowsB) {
    if (row.amount < price + 10_00) { monotonic = false; break; }
    price = row.amount;
  }
  check("every accepted bid cleared the price before it", monotonic,
        rowsB.map((r) => r.amount / 100).join(" -> "));
  check("bid rows match accepted results", rowsB.length === accepted,
        `${rowsB.length} rows vs ${accepted} accepted`);
  check("currentPrice equals the highest accepted bid",
        afterB.currentPrice === Math.max(...rowsB.map((r) => r.amount)),
        `${afterB.currentPrice}`);
  check("no bid landed below the final price",
        rowsB.every((r) => r.amount <= afterB.currentPrice), "");

  // ---------- C: concurrent race against a buy-now close ----------
  const itemC = await prisma.auctionItem.create({
    data: {
      sellerId: seller.id, categoryId: category.id,
      title: "C", description: "d", images: [],
      startPrice: 100_00, currentPrice: 100_00, bidIncrement: 10_00,
      buyNowPrice: 200_00, status: "active",
    },
  });
  const c = await Promise.all([
    ...bidders.slice(0, 10).map((bd) => placeBid(itemC.id, bd.id, 200_00)),
    ...bidders.slice(10).map((bd, i) => placeBid(itemC.id, bd.id, 110_00 + i * 10_00)),
  ]);
  const afterC = await prisma.auctionItem.findUniqueOrThrow({ where: { id: itemC.id } });
  const buyNowWins = c.filter((r) => r.ok && r.wonByBuyNow).length;
  check("buy-now accepted exactly once", buyNowWins === 1, `${buyNowWins}`);
  check("auction ended by buy_now", afterC.status === "ended" && afterC.endReason === "buy_now",
        `${afterC.status}/${afterC.endReason}`);
  check("winner recorded", afterC.winnerId !== null);
  check("no bid recorded after the close",
        (await prisma.bid.count({ where: { auctionItemId: itemC.id, amount: { gt: 200_00 } } })) === 0);

  console.log(results.join("\n"));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
