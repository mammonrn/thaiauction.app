import Link from "next/link";

import { SetPasswordForm } from "@/components/set-password-form";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export default async function SecurityPage() {
  const { user } = await requireSession("/account/security");

  // Better Auth stores one `accounts` row per sign-in method. A password exists
  // only when the "credential" row has a non-null password hash.
  const credentialAccount = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
    select: { password: true },
  });

  const hasPassword = Boolean(credentialAccount?.password);

  const linkedProviders = await prisma.account.findMany({
    where: { userId: user.id },
    select: { providerId: true },
  });

  return (
    <main className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          ความปลอดภัยของบัญชี
        </h1>
        <p className="text-sm text-ink/60">{user.email}</p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">วิธีเข้าสู่ระบบที่เชื่อมไว้</h2>
        <ul className="flex flex-col gap-1 text-sm text-ink/70">
          {linkedProviders.map(({ providerId }) => (
            <li key={providerId}>
              {providerId === "credential" ? "อีเมล + รหัสผ่าน" : providerId}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">
            {hasPassword ? "รหัสผ่าน" : "ตั้งรหัสผ่านเพิ่ม"}
          </h2>
          <p className="text-sm text-ink/60">
            {hasPassword
              ? "บัญชีนี้ตั้งรหัสผ่านไว้แล้ว สามารถเข้าสู่ระบบด้วยอีเมลและรหัสผ่านได้"
              : "ตั้งรหัสผ่านเพื่อให้เข้าสู่ระบบด้วยอีเมลได้ โดยไม่ต้องพึ่ง Google"}
          </p>
        </div>

        {hasPassword ? null : <SetPasswordForm />}
      </section>

      <Link
        href="/"
        className="text-sm text-ink/60 underline-offset-4 hover:underline sm:hidden"
      >
        กลับหน้าแรก
      </Link>
    </main>
  );
}
