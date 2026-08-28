import Link from "next/link";

import { SetPasswordForm } from "@/components/set-password-form";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

/**
 * Password and sign-in methods.
 *
 * Rewritten to say each thing once. The previous version had a heading, a
 * paragraph explaining the heading, and a list — three ways of saying "you
 * signed in with Google and you have not set a password", which is one fact.
 */
export default async function SecurityPage() {
  const { user } = await requireSession("/account/security");

  const accounts = await prisma.account.findMany({
    where: { userId: user.id },
    select: { providerId: true, password: true },
  });

  // Better Auth stores one `accounts` row per sign-in method. A password exists
  // only when the "credential" row has a non-null password hash.
  const hasPassword = accounts.some(
    (account) => account.providerId === "credential" && account.password,
  );
  const hasGoogle = accounts.some((account) => account.providerId === "google");

  return (
    <main className="flex w-full flex-col gap-5">
      <Link
        href="/account"
        className="text-sm text-ink/60 underline-offset-4 hover:underline sm:hidden"
      >
        ← บัญชีของฉัน
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          ความปลอดภัยของบัญชี
        </h1>
        <p className="text-sm text-ink/60">{user.email}</p>
      </header>

      <section className="flex flex-col divide-y divide-black/[.06] overflow-hidden rounded-xl bg-white">
        <Fact
          title="เข้าสู่ระบบด้วย Google"
          detail={hasGoogle ? "เชื่อมไว้แล้ว" : "ยังไม่ได้เชื่อม"}
        />
        <Fact
          title="รหัสผ่าน"
          detail={
            hasPassword
              ? "ตั้งไว้แล้ว — เข้าสู่ระบบด้วยอีเมลและรหัสผ่านได้"
              : "ยังไม่ได้ตั้ง"
          }
        />
      </section>

      {hasPassword ? (
        <p className="text-sm text-ink/60">
          ลืมรหัสผ่าน? ออกจากระบบแล้วใช้{" "}
          <Link href="/forgot-password" className="underline underline-offset-4">
            ลืมรหัสผ่าน
          </Link>{" "}
          ที่หน้าเข้าสู่ระบบ ระบบจะส่งรหัส OTP ไปยังเบอร์ที่คุณยืนยันไว้
        </p>
      ) : (
        <section className="flex flex-col gap-4 rounded-xl bg-white p-4 sm:p-6">
          <p className="text-sm text-ink/60">
            ตั้งรหัสผ่านไว้เพื่อเข้าสู่ระบบด้วยอีเมลได้ โดยไม่ต้องพึ่ง Google
          </p>
          <SetPasswordForm />
        </section>
      )}
    </main>
  );
}

function Fact({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5">
      <span className="font-medium">{title}</span>
      <span className="text-sm text-ink/55">{detail}</span>
    </div>
  );
}
