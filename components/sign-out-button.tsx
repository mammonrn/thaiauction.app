"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { signOut } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    await signOut();
    // Refresh so Server Components re-read the (now absent) session.
    router.refresh();
    setPending(false);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium transition hover:bg-black/5 disabled:opacity-60"
    >
      {pending ? "กำลังออกจากระบบ…" : "ออกจากระบบ"}
    </button>
  );
}
