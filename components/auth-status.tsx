import Image from "next/image";
import Link from "next/link";

import { SignOutButton } from "@/components/sign-out-button";
import { getSession } from "@/lib/session";

/**
 * Signed-in / signed-out banner.
 *
 * A Server Component, so the session is validated against the database on the
 * server and the page never flashes the wrong state on first paint.
 */
export async function AuthStatus() {
  const session = await getSession();

  if (!session) {
    return (
      <div className="flex w-full items-center justify-between gap-4 rounded-xl border border-black/10 bg-white/60 px-5 py-4 dark:border-white/15 dark:bg-white/5">
        <div>
          <p className="text-sm font-medium">ยังไม่ได้เข้าสู่ระบบ</p>
          <p className="text-sm text-black/60 dark:text-white/60">
            เข้าสู่ระบบเพื่อเสนอราคาและลงสินค้าประมูล
          </p>
        </div>
        <Link
          href="/login"
          className="shrink-0 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
        >
          เข้าสู่ระบบ
        </Link>
      </div>
    );
  }

  const { user } = session;

  return (
    <div className="flex w-full items-center justify-between gap-4 rounded-xl border border-black/10 bg-white/60 px-5 py-4 dark:border-white/15 dark:bg-white/5">
      <div className="flex items-center gap-3">
        {user.image ? (
          <Image
            src={user.image}
            alt=""
            width={40}
            height={40}
            className="rounded-full"
            unoptimized
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-black/10 text-sm font-medium dark:bg-white/15"
          >
            {(user.name ?? user.email).charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <p className="text-sm font-medium">
            เข้าสู่ระบบแล้ว: {user.name ?? user.email}
          </p>
          <p className="text-sm text-black/60 dark:text-white/60">
            {user.email}
          </p>
        </div>
      </div>
      <SignOutButton />
    </div>
  );
}
