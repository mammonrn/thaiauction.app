"use client";

import Image from "next/image";
import { useRef, useState } from "react";

export type UploadedImage = { key: string; url: string };

/**
 * Uploads each picked file immediately and keeps the resulting keys in hidden
 * inputs, in display order, so the surrounding form posts only short strings.
 */
export function ImageUploader({
  name,
  max,
  initial,
}: {
  name: string;
  max: number;
  initial: UploadedImage[];
}) {
  const [images, setImages] = useState<UploadedImage[]>(initial);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    const room = max - images.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    if (picked.length < files.length) {
      setError(`อัปโหลดได้สูงสุด ${max} รูป`);
    }

    for (const file of picked) {
      setBusy((n) => n + 1);
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/uploads", { method: "POST", body });
        const payload = await res.json();

        if (!res.ok) {
          setError(payload.error ?? "อัปโหลดไม่สำเร็จ");
        } else {
          setImages((current) => [...current, { key: payload.key, url: payload.url }]);
        }
      } catch {
        setError("อัปโหลดไม่สำเร็จ");
      } finally {
        setBusy((n) => n - 1);
      }
    }

    if (inputRef.current) inputRef.current.value = "";
  }

  function move(index: number, delta: number) {
    setImages((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {images.map((image) => (
        <input key={image.key} type="hidden" name={name} value={image.key} />
      ))}

      <div className="flex flex-wrap gap-3">
        {images.map((image, index) => (
          <div
            key={image.key}
            className="relative h-28 w-28 overflow-hidden rounded-lg border border-black/10 dark:border-white/15"
          >
            <Image
              src={image.url}
              alt=""
              fill
              sizes="112px"
              className="object-cover"
              unoptimized
            />
            {index === 0 ? (
              <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                ปก
              </span>
            ) : null}
            <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/60 text-white">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label="เลื่อนซ้าย"
                className="px-2 py-0.5 text-xs disabled:opacity-30"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() =>
                  setImages((c) => c.filter((i) => i.key !== image.key))
                }
                aria-label="ลบรูป"
                className="px-2 py-0.5 text-xs"
              >
                ✕
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === images.length - 1}
                aria-label="เลื่อนขวา"
                className="px-2 py-0.5 text-xs disabled:opacity-30"
              >
                →
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          disabled={images.length >= max}
          className="text-sm file:mr-3 file:rounded-lg file:border file:border-black/15 file:bg-transparent file:px-3 file:py-1.5 file:text-sm dark:file:border-white/20"
        />
        <span className="text-xs text-black/50 dark:text-white/50">
          {images.length}/{max} รูป
          {busy > 0 ? ` — กำลังอัปโหลด ${busy} ไฟล์…` : ""}
        </span>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
