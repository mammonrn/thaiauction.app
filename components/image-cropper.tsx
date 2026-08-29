"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { btnPrimary, btnSecondary } from "@/lib/button";

/**
 * Pick the square of a photo that becomes a profile picture.
 *
 * Two problems solved at once. A phone photo is 3-8MB and lands as a 256px
 * circle, so the network carried roughly thirty times the bytes that survived;
 * and the server cropped to centre, which on a portrait selfie is a chin.
 * Cropping here means the person chooses the square, and what leaves the phone
 * is ~512px of WebP — small enough to upload on a Thai mobile connection.
 *
 * Written against the canvas API rather than a cropping library: the whole
 * interaction is drag, pinch, and one drawImage call. A dependency for that
 * would be more code to audit than the code it replaces, and every cropper on
 * npm brings its own styling to escape from.
 *
 * NOTHING HERE IS A SECURITY CONTROL. The output is still an untrusted file
 * from a browser we do not control; the server re-decodes it through sharp and
 * validates it exactly as before. This only saves bytes and picks a square.
 */

/** Matches processAvatar()'s output box, so the server never has to upscale. */
const OUTPUT_PX = 512;
/** The circle the picture is shown in, and the crop square's edge on screen. */
const VIEW_PX = 260;

type Point = { x: number; y: number };

export function ImageCropper({
  file,
  onCancel,
  onCropped,
}: {
  file: File;
  onCancel: () => void;
  /** Receives a square WebP, ready to upload. */
  onCropped: (cropped: File) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);

  // Drag state lives in a ref: it changes on every pointermove and none of it
  // belongs in a render.
  const drag = useRef<{ id: number; from: Point; origin: Point } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setImage(img);
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // The scale at which the photo exactly covers the crop square. Everything
  // else is measured in multiples of it, so `zoom: 1` always means "fits".
  const baseScale = image
    ? VIEW_PX / Math.min(image.naturalWidth, image.naturalHeight)
    : 1;

  /** Keep the photo covering the square, whatever the drag or zoom did. */
  const clamp = useCallback(
    (next: Point, currentZoom: number): Point => {
      if (!image) return next;
      const scale = baseScale * currentZoom;
      const slackX = Math.max(0, (image.naturalWidth * scale - VIEW_PX) / 2);
      const slackY = Math.max(0, (image.naturalHeight * scale - VIEW_PX) / 2);
      return {
        x: Math.max(-slackX, Math.min(slackX, next.x)),
        y: Math.max(-slackY, Math.min(slackY, next.y)),
      };
    },
    [image, baseScale],
  );

  function handleZoom(next: number) {
    const clampedZoom = Math.max(1, Math.min(4, next));
    setZoom(clampedZoom);
    setOffset((current) => clamp(current, clampedZoom));
  }

  async function crop() {
    if (!image) return;
    setBusy(true);

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_PX;
    canvas.height = OUTPUT_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setBusy(false);
      return;
    }

    // The view is VIEW_PX wide; the output is OUTPUT_PX. Draw the same
    // geometry at the larger size and the crop matches what was on screen.
    const ratio = OUTPUT_PX / VIEW_PX;
    const scale = baseScale * zoom * ratio;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;

    ctx.drawImage(
      image,
      OUTPUT_PX / 2 - width / 2 + offset.x * ratio,
      OUTPUT_PX / 2 - height / 2 + offset.y * ratio,
      width,
      height,
    );

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.9),
    );
    setBusy(false);
    if (!blob) return;

    onCropped(
      new File([blob], "avatar.webp", { type: "image/webp" }),
    );
  }

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(22rem,calc(100vw-2rem))] rounded-xl bg-white p-0 text-ink backdrop:bg-black/60"
    >
      <div className="flex flex-col gap-4 p-5">
        <h2 className="text-base font-semibold">จัดตำแหน่งรูป</h2>

        <div
          className="relative mx-auto touch-none overflow-hidden rounded-full bg-black/5"
          style={{ width: VIEW_PX, height: VIEW_PX }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {
              id: event.pointerId,
              from: { x: event.clientX, y: event.clientY },
              origin: offset,
            };
          }}
          onPointerMove={(event) => {
            const state = drag.current;
            if (!state || state.id !== event.pointerId) return;
            setOffset(
              clamp(
                {
                  x: state.origin.x + (event.clientX - state.from.x),
                  y: state.origin.y + (event.clientY - state.from.y),
                },
                zoom,
              ),
            );
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image.src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
              style={{
                width: image.naturalWidth * baseScale * zoom,
                height: image.naturalHeight * baseScale * zoom,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
              }}
            />
          ) : (
            <span className="flex h-full items-center justify-center text-sm text-ink/50">
              กำลังโหลด…
            </span>
          )}
        </div>

        <label className="flex items-center gap-3 text-sm">
          <span className="text-ink/60">ย่อ/ขยาย</span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.02}
            value={zoom}
            onChange={(event) => handleZoom(Number(event.target.value))}
            className="flex-1 accent-brand"
          />
        </label>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={btnSecondary}>
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={() => void crop()}
            disabled={!image || busy}
            className={btnPrimary}
          >
            {busy ? "กำลังบันทึก…" : "ใช้รูปนี้"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
