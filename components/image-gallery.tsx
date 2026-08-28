"use client";

import Image from "next/image";
import { useState } from "react";

import { imageUrl, thumbUrl } from "@/lib/image-keys";

/**
 * The item's pictures.
 *
 * One large image with a thumbnail strip under it. The strip pulls the ~400px
 * copies and the main frame pulls the display copy, so opening a listing costs
 * one big image plus a few small ones rather than eight big ones.
 *
 * Keyboard: the strip is a list of real buttons, so arrowing through it works
 * without any key handling of our own. The main image is not a control — it
 * shows what the strip selects.
 */
export function ImageGallery({
  keys,
  title,
}: {
  keys: string[];
  title: string;
}) {
  const [active, setActive] = useState(0);
  const current = keys[Math.min(active, keys.length - 1)];

  if (keys.length === 0) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-xl bg-black/5 text-sm text-ink/40">
        ไม่มีรูปภาพ
      </div>
    );
  }

  return (
    // min-w-0: this is a grid item, and a grid item's default `min-width: auto`
    // lets the square image push wider than its column instead of shrinking to
    // it — which overflowed the card on a phone.
    <div className="flex min-w-0 flex-col gap-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-black/5">
        <Image
          key={current}
          src={imageUrl(current)}
          alt={title}
          fill
          sizes="(min-width: 768px) 50vw, 100vw"
          className="object-cover"
          priority
          unoptimized
        />
        {keys.length > 1 ? (
          <span className="absolute bottom-2 right-2 rounded-full bg-ink/70 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white">
            {Math.min(active, keys.length - 1) + 1}/{keys.length}
          </span>
        ) : null}
      </div>

      {keys.length > 1 ? (
        <ul className="rail flex gap-2 overflow-x-auto pb-1">
          {keys.map((key, index) => {
            const selected = index === Math.min(active, keys.length - 1);
            return (
              <li key={key} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setActive(index)}
                  aria-label={`รูปที่ ${index + 1}`}
                  aria-current={selected ? "true" : undefined}
                  className={`relative block h-16 w-16 overflow-hidden rounded-lg border-2 transition-colors ${
                    selected ? "border-brand" : "border-transparent hover:border-black/20"
                  }`}
                >
                  <Image
                    src={thumbUrl(key)}
                    alt=""
                    fill
                    sizes="64px"
                    className="object-cover"
                    unoptimized
                  />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
