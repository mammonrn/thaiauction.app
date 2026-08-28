import Link from "next/link";

import { PhoneVerification } from "@/components/phone-verification";
import { isStubMode } from "@/lib/thaibulksms";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export default async function PhonePage() {
  const { user } = await requireSession("/account/phone");

  const verified = await prisma.verifiedPhone.findMany({
    where: { userId: user.id },
    orderBy: { verifiedAt: "desc" },
    select: { phone: true, verifiedAt: true },
  });

  // isStubMode() throws if the flag is set in production; treat that as "off"
  // here so the page still renders and the actions report the real error.
  let stubMode = false;
  try {
    stubMode = isStubMode();
  } catch {
    stubMode = false;
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-2">
        <Link
          href="/account"
          className="text-sm text-black/60 underline-offset-4 hover:underline dark:text-white/60"
        >
          ← กลับหน้าบัญชีของฉัน
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          ยืนยันเบอร์โทรศัพท์
        </h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          ยืนยันเบอร์เพื่อให้ผู้ซื้อ-ผู้ขายติดต่อกันได้จริง
        </p>
      </div>

      <PhoneVerification
        stubMode={stubMode}
        verified={verified.map((entry) => ({
          phone: entry.phone,
          verifiedAt: entry.verifiedAt.toLocaleDateString("th-TH", {
            year: "numeric",
            month: "short",
            day: "numeric",
          }),
        }))}
      />
    </main>
  );
}
