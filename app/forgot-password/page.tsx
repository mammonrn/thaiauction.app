import Link from "next/link";
import { redirect } from "next/navigation";

import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { getSession } from "@/lib/session";

export const metadata = { title: "ลืมรหัสผ่าน" };

/**
 * Reset a password without being signed in.
 *
 * The code goes to a number the account has already verified, never to one
 * typed into this page — otherwise the form would hand out password resets to
 * whoever supplies a phone.
 */
export default async function ForgotPasswordPage() {
  const session = await getSession();
  if (session) redirect("/account/security");

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-xl bg-white p-6 sm:p-8">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            ลืมรหัสผ่าน
          </h1>
          <p className="text-sm text-ink/60">
            กรอกอีเมลของบัญชี ระบบจะส่งรหัส OTP ไปยังเบอร์มือถือที่คุณยืนยันไว้
          </p>
        </div>

        <ForgotPasswordForm />

        <Link
          href="/login"
          className="text-center text-sm text-ink/60 underline-offset-4 hover:underline"
        >
          กลับไปหน้าเข้าสู่ระบบ
        </Link>
      </div>
    </main>
  );
}
