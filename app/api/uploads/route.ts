import {
  MAX_UPLOAD_BYTES,
  UploadError,
  imageUrl,
  stageImage,
} from "@/lib/uploads";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Upload one image into the caller's staging area.
 *
 * One image per request, rather than the whole form at once: a Server Action's
 * body is capped at 1MB by default, and ten untouched phone photos are far past
 * any sane cap. Uploading each as it is picked keeps every request small and
 * lets the form show progress and a preview before anything is saved.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }

  // Cheap pre-check so an oversized body is refused before it is buffered.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES * 1.1) {
    return Response.json({ error: "ไฟล์ใหญ่เกินกำหนด" }, { status: 413 });
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    if (value instanceof File) file = value;
  } catch {
    return Response.json({ error: "อ่านไฟล์ไม่สำเร็จ" }, { status: 400 });
  }

  if (!file) {
    return Response.json({ error: "ไม่พบไฟล์" }, { status: 400 });
  }

  try {
    const key = await stageImage(session.user.id, file);
    return Response.json({ key, url: imageUrl(key) });
  } catch (error) {
    if (error instanceof UploadError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("[uploads] failed:", error);
    return Response.json({ error: "อัปโหลดไม่สำเร็จ" }, { status: 500 });
  }
}
