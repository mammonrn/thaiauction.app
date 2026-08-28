import Image from "next/image";
import Link from "next/link";

import { SellerBadges } from "@/components/seller-badges";
import { SignOutButton } from "@/components/sign-out-button";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { countStrikes, STRIKE_LIMIT } from "@/lib/strikes";

export default async function AccountPage() {
  const { user } = await requireSession("/account");

  // Small counts to give each link a sense of state, rather than a bare list.
  const [
    addressCount,
    credentialAccount,
    verifiedPhoneCount,
    verification,
    strikes,
    bankAccount,
  ] = await Promise.all([
    prisma.shippingAddress.count({ where: { userId: user.id } }),
    prisma.account.findFirst({
      where: { userId: user.id, providerId: "credential" },
      select: { password: true },
    }),
    prisma.verifiedPhone.count({ where: { userId: user.id } }),
    prisma.sellerVerification.findFirst({
      where: { userId: user.id },
      orderBy: { submittedAt: "desc" },
      select: { status: true },
    }),
    countStrikes(user.id),
    prisma.sellerBankAccount.findUnique({
      where: { userId: user.id },
      select: { id: true },
    }),
  ]);

  const hasBankAccount = bankAccount !== null;

  const hasPassword = Boolean(credentialAccount?.password);

  return (
    <main className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link
          href="/"
          className="text-sm text-ink/60 underline-offset-4 hover:underline sm:hidden"
        >
          ← กลับหน้าแรก
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">บัญชีของฉัน</h1>
      </div>

      <section className="flex items-center gap-4 rounded-xl bg-white p-5">
        {user.image ? (
          <Image
            src={user.image}
            alt=""
            width={64}
            height={64}
            className="rounded-full"
            // Google avatar URLs are external and not in next.config images
            // remotePatterns, so skip the optimiser rather than 500 on them.
            unoptimized
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-black/10 text-xl font-medium"
          >
            {user.name.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="flex flex-col gap-0.5">
          <p className="text-lg font-medium">{user.name}</p>
          <p className="text-sm text-ink/60">
            {user.email}
          </p>
          <SellerBadges
            phoneVerified={verifiedPhoneCount > 0}
            identityVerified={verification?.status === "approved"}
          />
          {user.emailVerified ? (
            <p className="text-xs text-green-700">
              ยืนยันอีเมลแล้ว
            </p>
          ) : null}
        </div>
      </section>

      {/* Two columns on desktop, where the sidebar already handles navigation:
          these cards then read as a status overview ("ยังไม่มีที่อยู่",
          "ยืนยันแล้ว 1 เบอร์") rather than repeating the menu beside them. On
          mobile there is no sidebar, so the single column IS the menu. */}
      <nav className="grid gap-2.5 sm:grid-cols-2">
        <AccountLink
          href="/account/addresses"
          title="ที่อยู่จัดส่ง"
          detail={
            addressCount === 0
              ? "ยังไม่มีที่อยู่ — เพิ่มไว้เพื่อใช้ตอนชนะประมูล"
              : `บันทึกไว้ ${addressCount} ที่อยู่`
          }
        />
        <AccountLink
          href="/account/phone"
          title="เบอร์โทรศัพท์"
          detail={
            verifiedPhoneCount === 0
              ? "ยังไม่ได้ยืนยันเบอร์ — ยืนยันเพื่อให้ติดต่อได้จริง"
              : `ยืนยันแล้ว ${verifiedPhoneCount} เบอร์`
          }
        />
        <AccountLink
          href="/account/verification"
          title="ยืนยันตัวตนผู้ขาย"
          detail={
            verification?.status === "approved"
              ? "ยืนยันตัวตนแล้ว"
              : verification?.status === "pending"
                ? "รอทีมงานตรวจสอบ"
                : verification?.status === "rejected"
                  ? "ถูกปฏิเสธ — ส่งใหม่ได้"
                  : "ส่งบัตรประชาชนเพื่อรับเครื่องหมายรับรอง"
          }
        />
        <AccountLink
          href="/account/bids"
          title="ประวัติการประมูล"
          detail={
            strikes > 0
              ? `มีประวัติไม่ชำระเงิน ${strikes}/${STRIKE_LIMIT} ครั้ง`
              : "รายการที่เคยเสนอราคา ชนะ และชำระเงิน"
          }
        />
        <AccountLink
          href="/account/bank"
          title="บัญชีธนาคาร"
          detail={
            hasBankAccount
              ? "บันทึกไว้แล้ว — ใช้รับเงินเมื่อขายสินค้าได้"
              : "ยังไม่ได้บันทึก — ต้องมีเพื่อรับเงินค่าสินค้า"
          }
        />
        <AccountLink
          href="/account/security"
          title="ความปลอดภัย"
          detail={
            hasPassword
              ? "ตั้งรหัสผ่านไว้แล้ว"
              : "ยังไม่ได้ตั้งรหัสผ่าน — ตอนนี้เข้าสู่ระบบด้วย Google เท่านั้น"
          }
        />
      </nav>

      <div>
        <SignOutButton />
      </div>
    </main>
  );
}

function AccountLink({
  href,
  title,
  detail,
}: {
  href: string;
  title: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-4 rounded-xl bg-white px-5 py-4 transition-colors hover:bg-brand/[.04]"
    >
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-sm text-ink/60">
          {detail}
        </span>
      </span>
      <span aria-hidden="true" className="text-ink/40">
        →
      </span>
    </Link>
  );
}
