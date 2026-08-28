import { revalidatePath } from "next/cache";

import { MAX_UPLOAD_BYTES } from "@/lib/image-keys";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { UploadError, deleteAvatar, storeAvatar } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * Profile pictures, as a route handler rather than a Server Action.
 *
 * This is the bug the owner hit on a phone: a Server Action body is capped at
 * 1MB, and a photo straight off a phone camera is 3–8MB. Next refuses the
 * request before any of our code runs, so there is nothing to catch and no
 * message to show — the browser just reports that the page could not load.
 *
 * Raising `serverActions.bodySizeLimit` would have worked too, but it would
 * have raised the cap for EVERY action in the app, and it would have made
 * avatars the one upload path that does not look like the others. Item images
 * (app/api/uploads) and identity documents (app/api/kyc/submit) are already
 * route handlers for exactly this reason; this makes three out of three.
 *
 * Scoped by construction: the user id comes from the session and the file is
 * written under that id, so there is no identifier a caller could substitute.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  const userId = session.user.id;

  // Cheap pre-check so an oversized body is refused before it is buffered.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES * 1.1) {
    return Response.json(
      { error: `ไฟล์ใหญ่เกิน ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB` },
      { status: 413 },
    );
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("avatar");
    if (value instanceof File) file = value;
  } catch {
    return Response.json({ error: "อ่านไฟล์ไม่สำเร็จ" }, { status: 400 });
  }
  if (!file || file.size === 0) {
    return Response.json({ error: "กรุณาเลือกไฟล์รูป" }, { status: 400 });
  }

  const current = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { avatarKey: true },
  });

  let key: string;
  try {
    key = await storeAvatar(userId, file);
  } catch (error) {
    if (error instanceof UploadError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("[avatar] upload failed:", error);
    return Response.json(
      { error: "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" },
      { status: 500 },
    );
  }

  await prisma.user.update({ where: { id: userId }, data: { avatarKey: key } });

  // Only after the row points at the new file, so a failure between the two
  // leaves a stale file rather than a broken picture.
  if (current.avatarKey) await deleteAvatar(current.avatarKey);

  revalidatePath("/account");
  return Response.json({ ok: true, message: "เปลี่ยนรูปโปรไฟล์แล้ว" });
}

/** Drop the uploaded picture and fall back to the one from Google. */
export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  const userId = session.user.id;

  const current = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { avatarKey: true },
  });
  if (!current.avatarKey) {
    return Response.json({ error: "ยังไม่ได้อัปโหลดรูปโปรไฟล์" }, { status: 400 });
  }

  await prisma.user.update({ where: { id: userId }, data: { avatarKey: null } });
  await deleteAvatar(current.avatarKey);

  revalidatePath("/account");
  return Response.json({
    ok: true,
    message: "ลบรูปโปรไฟล์แล้ว — กลับไปใช้รูปจาก Google",
  });
}
