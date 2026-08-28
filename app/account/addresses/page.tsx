import Link from "next/link";

import { AddressManager } from "@/components/address-manager";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export default async function AddressesPage() {
  const { user } = await requireSession("/account/addresses");

  const addresses = await prisma.shippingAddress.findMany({
    where: { userId: user.id },
    // Default first, then newest — the address most likely to be used is on top.
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      recipientName: true,
      phone: true,
      addressLine: true,
      subDistrict: true,
      district: true,
      province: true,
      postalCode: true,
      isDefault: true,
    },
  });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-2">
        <Link
          href="/account"
          className="text-sm text-black/60 underline-offset-4 hover:underline dark:text-white/60"
        >
          ← กลับหน้าบัญชีของฉัน
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">ที่อยู่จัดส่ง</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          จัดการที่อยู่สำหรับจัดส่งสินค้าที่คุณชนะประมูล
        </p>
      </div>

      <AddressManager addresses={addresses} />
    </main>
  );
}
