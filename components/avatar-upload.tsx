"use client";

import Image from "next/image";
import { useActionState, useRef } from "react";

import {
  removeAvatarAction,
  uploadAvatarAction,
  type AvatarActionState,
} from "@/app/account/avatar/actions";
import { btnSecondarySm, btnGhost } from "@/lib/button";

const EMPTY: AvatarActionState = { ok: false, message: null };

/**
 * Change your profile picture.
 *
 * The file input is hidden behind a labelled button — the browser's default
 * "Choose File / No file chosen" is untranslatable and sits outside the theme,
 * which is exactly the kind of stray control this codebase now treats as a bug.
 *
 * Submitting on change rather than behind a second "upload" press: choosing a
 * picture IS the intent, and a confirm step adds nothing to undo-able change.
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
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(uploadAvatarAction, EMPTY);
  const [removeState, removeAction, removing] = useActionState(
    removeAvatarAction,
    EMPTY,
  );

  const message = state.message ?? removeState.message;
  const ok = state.message ? state.ok : removeState.ok;

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
          <form ref={form} action={action}>
            <label className={`${btnSecondarySm} cursor-pointer`}>
              {pending ? "กำลังอัปโหลด…" : "เปลี่ยนรูปโปรไฟล์"}
              <input
                type="file"
                name="avatar"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                disabled={pending}
                onChange={() => form.current?.requestSubmit()}
              />
            </label>
          </form>

          {hasUpload ? (
            <form action={removeAction}>
              <button type="submit" disabled={removing} className={btnGhost}>
                {removing ? "กำลังลบ…" : "ใช้รูปจาก Google"}
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {message ? (
        <p
          role="status"
          className={`text-sm ${ok ? "text-green-700" : "text-red-600"}`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
