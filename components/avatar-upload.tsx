"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { btnGhost, btnSecondarySm } from "@/lib/button";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/image-keys";

type Result = { ok: boolean; message: string };

/**
 * Change your profile picture.
 *
 * Posts to app/api/avatar rather than a Server Action, because a phone photo
 * is several megabytes and an action's body is capped at 1MB — see the route
 * for the full story. Everything here follows from that: fetch instead of
 * useActionState, and router.refresh() to pull the new picture back down.
 *
 * The file input is hidden behind a labelled button — the browser's default
 * "Choose File / No file chosen" is untranslatable and sits outside the theme,
 * which is exactly the kind of stray control this codebase treats as a bug.
 *
 * Submitting on change rather than behind a second "upload" press: choosing a
 * picture IS the intent, and a confirm step adds nothing to an undo-able change.
 */
export function AvatarUpload({
  src,
  name,
  hasUpload,
}: {
  src: string | null;
  name: string;
  hasUpload: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  // One message slot for both operations, so a failed upload cannot mask the
  // result of the removal that follows it.
  const [result, setResult] = useState<Result | null>(null);

  async function send(request: Promise<Response>) {
    setPending(true);
    setResult(null);
    try {
      const response = await request;

      // nginx answers an over-limit body with its own HTML error page, not
      // our JSON, so the status has to be readable on its own. Without this
      // the user would see "อัปโหลดไม่สำเร็จ" for a file that is merely too
      // big, which tells them nothing about what to do next.
      if (response.status === 413) {
        setResult({ ok: false, message: `ไฟล์ใหญ่เกิน ${MAX_UPLOAD_MB}MB` });
        return;
      }

      const body = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        error?: string;
      } | null;

      if (!response.ok || !body?.ok) {
        setResult({
          ok: false,
          message: body?.error ?? "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
        });
        return;
      }

      setResult({ ok: true, message: body.message ?? "บันทึกแล้ว" });
      router.refresh();
    } catch {
      // A dropped mobile connection lands here, and "the network failed" is
      // the honest message — retrying is the right advice, unlike for a file
      // that will always be too large.
      setResult({
        ok: false,
        message: "เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่",
      });
    } finally {
      setPending(false);
      if (input.current) input.current.value = "";
    }
  }

  function upload(file: File) {
    // Checked here as well as on the server: refusing a 12MB photo before it
    // is sent saves a phone user a long upload that was always going to fail.
    if (file.size > MAX_UPLOAD_BYTES) {
      setResult({ ok: false, message: `ไฟล์ใหญ่เกิน ${MAX_UPLOAD_MB}MB` });
      if (input.current) input.current.value = "";
      return;
    }
    const body = new FormData();
    body.append("avatar", file);
    void send(fetch("/api/avatar", { method: "POST", body }));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        {src ? (
          <Image
            src={src}
            alt=""
            width={64}
            height={64}
            className="h-16 w-16 rounded-full object-cover"
            // Google avatar URLs are external and not in next.config
            // remotePatterns, so skip the optimiser rather than 500 on them.
            unoptimized
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-black/10 text-xl font-medium"
          >
            {name.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <label
            className={`${btnSecondarySm} cursor-pointer ${
              pending ? "pointer-events-none opacity-60" : ""
            }`}
          >
            {pending ? "กำลังอัปโหลด…" : "เปลี่ยนรูปโปรไฟล์"}
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={pending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload(file);
              }}
            />
          </label>

          {hasUpload ? (
            <button
              type="button"
              disabled={pending}
              className={btnGhost}
              onClick={() => void send(fetch("/api/avatar", { method: "DELETE" }))}
            >
              ใช้รูปจาก Google
            </button>
          ) : null}
        </div>
      </div>

      {result ? (
        <p
          role="status"
          className={`text-sm ${result.ok ? "text-green-700" : "text-brand"}`}
        >
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
