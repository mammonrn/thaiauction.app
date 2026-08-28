import { readFile, stat } from "node:fs/promises";

import { isStagingKey, resolveKey } from "@/lib/uploads";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Serve a stored image.
 *
 * Uploads live outside the project directory, so they are not static assets and
 * are read through here. `resolveKey` pattern-checks the key and confirms the
 * resolved path is inside the upload root, so a crafted key cannot walk out of
 * it. Everything served is a WebP this app re-encoded, and the response says so
 * explicitly rather than echoing anything the uploader supplied.
 *
 * Item images are public — auction listings are. Staging images are not: they
 * belong to a draft nobody has published, so only their owner may fetch them.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key: segments } = await params;
  const key = segments.join("/");

  const full = resolveKey(key);
  if (!full) {
    return new Response("Not found", { status: 404 });
  }

  if (isStagingKey(key)) {
    const session = await getSession();
    // "staging/<userId>/<file>" — only that user may read it.
    if (!session || !key.startsWith(`staging/${session.user.id}/`)) {
      return new Response("Not found", { status: 404 });
    }
  }

  try {
    const info = await stat(full);
    if (!info.isFile()) return new Response("Not found", { status: 404 });

    const body = await readFile(full);

    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(info.size),
        // Stored files are immutable: a change produces a new random name.
        "Cache-Control": isStagingKey(key)
          ? "private, no-store"
          : "public, max-age=31536000, immutable",
        // Belt and braces: never let a response be sniffed into something else.
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
