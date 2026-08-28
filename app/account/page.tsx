import Image from "next/image";
import Link from "next/link";

import { SignOutButton } from "@/components/sign-out-button";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export default async function AccountPage() {
  const { user } = await requireSession("/account");

  // Small counts to give each link a sense of state, rather than a bare list.
  const [addressCount, credentialAccount, verifiedPhoneCount] = await Promise.all([
    prisma.shippingAddress.count({ where: { userId: user.id } }),
    prisma.account.findFirst({
      where: { userId: user.id, providerId: "credential" },
      select: { password: true },
    }),
    prisma.verifiedPhone.count({ where: { userId: user.id } }),
  ]);

  const hasPassword = Boolean(credentialAccount?.password);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-2">
        <Link
          href="/"
          className="text-sm text-black/60 underline-offset-4 hover:underline dark:text-white/60"
        >
          ← กลับหน้าแรก
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">บัญชีของฉัน</h1>
      </div>

      <section className="flex items-center gap-4 rounded-xl border border-black/10 p-5 dark:border-white/15">
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
            className="flex h-16 w-16 items-center justify-center rounded-full bg-black/10 text-xl font-medium dark:bg-white/15"
          >
            {user.name.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="flex flex-col gap-0.5">
          <p className="text-lg font-medium">{user.name}</p>
          <p className="text-sm text-black/60 dark:text-white/60">
            {user.email}
          </p>
          {user.emailVerified ? (
            <p className="text-xs text-green-700 dark:text-green-400">
              ยืนยันอีเมลแล้ว
            </p>
          ) : null}
        </div>
      </section>

      <nav className="flex flex-col gap-3">
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
      className="flex items-center justify-between gap-4 rounded-xl border border-black/10 px-5 py-4 transition hover:bg-black/[.03] dark:border-white/15 dark:hover:bg-white/5"
    >
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-sm text-black/60 dark:text-white/60">
          {detail}
        </span>
      </span>
      <span aria-hidden="true" className="text-black/40 dark:text-white/40">
        →
      </span>
    </Link>
  );
}
