import Link from "next/link";
import { redirect } from "next/navigation";

import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { PasswordSignInForm } from "@/components/password-sign-in-form";
import { getSession } from "@/lib/session";

/**
 * Only relative, single-slash paths are accepted as a post-login destination,
 * so `?redirectTo=https://evil.example` cannot turn this into an open redirect.
 */
function safeRedirectTo(value: string | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const session = await getSession();
  const { redirectTo } = await searchParams;

  const target = safeRedirectTo(
    typeof redirectTo === "string" ? redirectTo : undefined,
  );

  // Already signed in — nothing to do here.
  if (session) {
    redirect(target);
  }

  return (
    // flex-1 rather than min-h-screen: the page now sits between a header and
    // a footer, so a full viewport height would push both off the screen.
    <main className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-xl bg-white p-6 sm:p-8">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            เข้าสู่ระบบ
          </h1>
          <p className="text-sm text-ink/60">
            เข้าสู่ระบบเพื่อลงประมูลและเสนอราคาสินค้า
          </p>
        </div>

        <GoogleSignInButton redirectTo={target} />

        {/* Google first, because it is how every account here is created —
            `disableSignUp` keeps the password endpoint closed to new users.
            The password form is for people who added one afterwards, and it
            had been missing entirely: an account could set a password on the
            security page and then have nowhere to type it. */}
        <div className="flex items-center gap-3 text-xs text-ink/45">
          <span className="h-px flex-1 bg-black/10" />
          หรือ
          <span className="h-px flex-1 bg-black/10" />
        </div>

        <PasswordSignInForm redirectTo={target} />

        <p className="text-center text-xs leading-relaxed text-ink/50">
          บัญชีใหม่สมัครผ่าน Google เท่านั้น
          <br />
          ตั้งรหัสผ่านเพิ่มได้ในหน้าความปลอดภัยหลังเข้าสู่ระบบแล้ว
        </p>

        <Link
          href="/"
          className="text-center text-sm text-ink/60 underline-offset-4 hover:underline"
        >
          กลับหน้าแรก
        </Link>
      </div>
    </main>
  );
}
