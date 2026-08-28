import Link from "next/link";
import { redirect } from "next/navigation";

import { GoogleSignInButton } from "@/components/google-sign-in-button";
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
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">เข้าสู่ระบบ</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          เข้าสู่ระบบเพื่อลงประมูลและเสนอราคาสินค้า
        </p>
      </div>

      <GoogleSignInButton redirectTo={target} />

      <p className="text-center text-xs text-black/50 dark:text-white/50">
        ตอนนี้รองรับการเข้าสู่ระบบด้วย Google เท่านั้น
        <br />
        คุณสามารถตั้งรหัสผ่านเพิ่มได้ภายหลังจากเข้าสู่ระบบแล้ว
      </p>

      <Link
        href="/"
        className="text-center text-sm text-black/60 underline-offset-4 hover:underline dark:text-white/60"
      >
        กลับหน้าแรก
      </Link>
    </main>
  );
}
