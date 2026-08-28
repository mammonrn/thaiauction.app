"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { btnSecondary } from "@/lib/button";
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
      className={btnSecondary}
    >
      {pending ? "กำลังออกจากระบบ…" : "ออกจากระบบ"}
    </button>
  );
}
