import Link from "next/link";

import { PhoneVerification } from "@/components/phone-verification";
import { isStubMode } from "@/lib/thaibulksms";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export default async function PhonePage({
  searchParams,
}: PageProps<"/account/phone">) {
  const { user } = await requireSession("/account/phone");
  const { reason, next } = await searchParams;

  // Only a relative, single-slash path is accepted, so ?next= cannot be turned
  // into an open redirect back out of the site.
  const backTo =
    typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
      ? next
      : null;

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
    <main className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link
          href="/account"
          className="text-sm text-ink/60 underline-offset-4 hover:underline sm:hidden"
        >
          ← กลับหน้าบัญชีของฉัน
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          ยืนยันเบอร์โทรศัพท์
        </h1>
        <p className="text-sm text-ink/60">
          ยืนยันเบอร์เพื่อให้ผู้ซื้อ-ผู้ขายติดต่อกันได้จริง
        </p>

        {reason === "sell" ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
            ต้องยืนยันเบอร์โทรก่อนจึงจะลงสินค้าประมูลได้
            เพื่อให้ผู้ซื้อติดต่อผู้ขายได้จริง
            {backTo ? (
              <>
                {" "}
                <Link href={backTo} className="underline underline-offset-4">
                  กลับไปหน้าลงสินค้า
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="rounded-xl bg-white p-4 sm:p-6">
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
      </div>
    </main>
  );
}
