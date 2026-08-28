"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { signIn } from "@/lib/auth-client";
import { btnPrimary } from "@/lib/button";

const inputClass = "rounded-lg border border-black/15 px-3 py-2";

/**
 * Sign in with an email and password.
 *
 * The account itself is still created through Google — `disableSignUp` keeps
 * the public sign-up endpoint closed — so this only serves people who added a
 * password afterwards, or who set one through the reset flow.
 *
 * The error is deliberately one sentence for every failure. Better Auth
 * distinguishes "no such user" from "wrong password", and passing that
 * through would hand anyone a way to test whether an address has an account
 * here, which is the same thing /forgot-password is careful not to reveal.
 */
export function PasswordSignInForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    setPending(true);
    setError(null);

    const { error } = await signIn.email({
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    });

    if (error) {
      setError("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
      setPending(false);
      return;
    }

    router.push(redirectTo);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">อีเมล</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">รหัสผ่าน</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </label>

      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
      </button>

      {error ? (
        <p role="alert" className="text-sm text-brand">
          {error}
        </p>
      ) : null}

      <Link
        href="/forgot-password"
        className="self-center text-sm text-ink/60 underline-offset-4 hover:underline"
      >
        ลืมรหัสผ่าน?
      </Link>
    </form>
  );
}
