"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { deleteAvatar, storeAvatar, UploadError } from "@/lib/uploads";

export type AvatarActionState = { ok: boolean; message: string | null };

/**
 * Replace the signed-in user's profile picture.
 *
 * Scoped by construction: the user id comes from the session and the file is
 * written under that id, so there is no identifier a caller could substitute.
 * The image goes through the same decode-and-re-encode as every other upload,
 * so what lands on disk is a WebP this app produced.
 *
 * The previous file is removed only AFTER the row points at the new one, so a
 * failure between the two leaves a stale file rather than a broken picture.
 */
export async function uploadAvatarAction(
  _prev: AvatarActionState,
  formData: FormData,
): Promise<AvatarActionState> {
  const { user } = await requireSession("/account");

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "กรุณาเลือกไฟล์รูป" };
  }

  const current = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { avatarKey: true },
  });

  let key: string;
  try {
    key = await storeAvatar(user.id, file);
  } catch (error) {
    if (error instanceof UploadError) {
      return { ok: false, message: error.message };
    }
    console.error("[avatar] upload failed:", error);
    return { ok: false, message: "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { avatarKey: key },
  });

  if (current.avatarKey) await deleteAvatar(current.avatarKey);

  revalidatePath("/account");
  return { ok: true, message: "เปลี่ยนรูปโปรไฟล์แล้ว" };
}

/** Drop the uploaded picture and fall back to the one from Google. */
export async function removeAvatarAction(
  _prev: AvatarActionState,
): Promise<AvatarActionState> {
  const { user } = await requireSession("/account");

  const current = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { avatarKey: true },
  });
  if (!current.avatarKey) {
    return { ok: false, message: "ยังไม่ได้อัปโหลดรูปโปรไฟล์" };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { avatarKey: null },
  });
  await deleteAvatar(current.avatarKey);

  revalidatePath("/account");
  return { ok: true, message: "ลบรูปโปรไฟล์แล้ว — กลับไปใช้รูปจาก Google" };
}
