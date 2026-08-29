"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { btnDanger } from "@/lib/button";
import { signOut } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);

  async function signOutNow() {
    setPending(true);
    await signOut();
    setAsking(false);
    // Refresh so Server Components re-read the (now absent) session.
    router.refresh();
    setPending(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAsking(true)}
        disabled={pending}
        className={btnDanger}
      >
        {pending ? "กำลังออกจากระบบ…" : "ออกจากระบบ"}
      </button>

      <ConfirmDialog
        open={asking}
        title="ออกจากระบบ?"
        detail="ต้องเข้าสู่ระบบใหม่เพื่อเสนอราคาหรือลงขาย"
        confirmLabel="ออกจากระบบ"
        pending={pending}
        onCancel={() => setAsking(false)}
        onConfirm={() => void signOutNow()}
      />
    </>
  );
}
