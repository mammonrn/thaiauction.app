import { revalidatePath } from "next/cache";

import {
  KycUploadError,
  MAX_KYC_UPLOAD_BYTES,
  deleteKycDocument,
  storeKycDocument,
} from "@/lib/kyc-storage";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Submit an identity document for review.
 *
 * A route handler rather than a Server Action because a photo of an ID card is
 * far past the 1MB default body limit for actions. The document is written and
 * attached to a submission in one step, so a sensitive file never sits around
 * unattached in a staging area waiting to be claimed.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  const userId = session.user.id;

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_KYC_UPLOAD_BYTES * 1.1) {
    return Response.json({ error: "ไฟล์ใหญ่เกินกำหนด" }, { status: 413 });
  }

  // Already approved: nothing to review, and no reason to hold another copy.
  const approved = await prisma.sellerVerification.findFirst({
    where: { userId, status: "approved" },
    select: { id: true },
  });
  if (approved) {
    return Response.json({ error: "บัญชีนี้ยืนยันตัวตนแล้ว" }, { status: 409 });
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("document");
    if (value instanceof File) file = value;
  } catch {
    return Response.json({ error: "อ่านไฟล์ไม่สำเร็จ" }, { status: 400 });
  }
  if (!file) return Response.json({ error: "ไม่พบไฟล์" }, { status: 400 });

  let key: string;
  try {
    key = await storeKycDocument(userId, file);
  } catch (error) {
    if (error instanceof KycUploadError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("[kyc] store failed");
    return Response.json({ error: "อัปโหลดไม่สำเร็จ" }, { status: 500 });
  }

  // Replace any earlier pending request, erasing its image: only one document
  // per person is ever held at a time.
  const superseded = await prisma.sellerVerification.findMany({
    where: { userId, status: "pending" },
    select: { id: true, documentKey: true },
  });

  await prisma.$transaction([
    prisma.sellerVerification.deleteMany({ where: { userId, status: "pending" } }),
    prisma.sellerVerification.create({
      data: { userId, status: "pending", documentKey: key },
    }),
  ]);

  await Promise.all(superseded.map((row) => deleteKycDocument(row.documentKey)));

  revalidatePath("/account/verification");
  return Response.json({ ok: true });
}
