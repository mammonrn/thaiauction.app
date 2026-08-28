"use client";

import { useActionState, useState } from "react";

import type { SellActionState } from "@/app/sell/actions";
import { ImageUploader, type UploadedImage } from "@/components/image-uploader";
import { ThaiDateTimePicker } from "@/components/thai-datetime-picker";
import { MAX_DESCRIPTION, MAX_TITLE } from "@/lib/auction-rules";

const initialState: SellActionState = { ok: false, message: null };

const inputClass =
  "rounded-lg border border-black/15 px-3 py-2";

export type AuctionFormValues = {
  itemId?: string;
  categoryId: string;
  title: string;
  description: string;
  startPrice: string;
  buyNowPrice: string;
  bidIncrement: string;
  timed: boolean;
  endTime: string;
  images: UploadedImage[];
};

export function AuctionForm({
  action,
  categories,
  initial,
  submitLabel,
  maxImages,
  now,
}: {
  action: (
    prev: SellActionState,
    formData: FormData,
  ) => Promise<SellActionState>;
  categories: { id: string; name: string }[];
  initial: AuctionFormValues;
  submitLabel: string;
  maxImages: number;
  /** Server render time, forwarded to the date picker. */
  now: number;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const v = state.values;
  const err = state.errors;

  const [timed, setTimed] = useState(
    v ? v.auctionType === "timed" : initial.timed,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {initial.itemId ? (
        <input type="hidden" name="itemId" value={initial.itemId} />
      ) : null}

      <Row label="หมวดหมู่" error={err?.categoryId}>
        <select
          name="categoryId"
          required
          defaultValue={v?.categoryId ?? initial.categoryId}
          className={inputClass}
        >
          <option value="">เลือกหมวดหมู่</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Row>

      <Row label="ชื่อสินค้า" error={err?.title}>
        <input
          name="title"
          required
          maxLength={MAX_TITLE}
          defaultValue={v?.title ?? initial.title}
          className={inputClass}
        />
      </Row>

      <Row label="รายละเอียด" error={err?.description}>
        <textarea
          name="description"
          required
          rows={6}
          maxLength={MAX_DESCRIPTION}
          defaultValue={v?.description ?? initial.description}
          className={inputClass}
        />
      </Row>

      <Row
        label={`รูปภาพ (1-${maxImages} รูป)`}
        error={err?.images}
        hint="รูปแรกจะเป็นรูปปก จัดลำดับด้วยปุ่ม ← →"
      >
        <ImageUploader name="images" max={maxImages} initial={initial.images} />
      </Row>

      <div className="grid gap-5 sm:grid-cols-2">
        <Row label="ราคาเริ่มต้น (บาท)" error={err?.startPrice}>
          <input
            name="startPrice"
            required
            inputMode="decimal"
            defaultValue={v?.startPrice ?? initial.startPrice}
            className={inputClass}
          />
        </Row>
        <Row
          label="ราคาซื้อทันที (บาท)"
          error={err?.buyNowPrice}
          hint="ไม่บังคับ — เว้นว่างถ้าไม่ต้องการ"
        >
          <input
            name="buyNowPrice"
            inputMode="decimal"
            defaultValue={v?.buyNowPrice ?? initial.buyNowPrice}
            className={inputClass}
          />
        </Row>
      </div>

      <Row
        label="ขั้นต่ำการเพิ่มราคาบิด (บาท)"
        error={err?.bidIncrement}
        hint="ผู้เสนอราคาต้องเพิ่มขึ้นอย่างน้อยครั้งละเท่านี้"
      >
        <input
          name="bidIncrement"
          required
          inputMode="decimal"
          defaultValue={v?.bidIncrement ?? initial.bidIncrement}
          className={`${inputClass} max-w-40`}
        />
      </Row>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">ประเภทการประมูล</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="auctionType"
            value="open"
            checked={!timed}
            onChange={() => setTimed(false)}
          />
          ไม่ระบุเวลาจบ (ผู้ขายปิดเอง)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="auctionType"
            value="timed"
            checked={timed}
            onChange={() => setTimed(true)}
          />
          ระบุเวลาจบ
        </label>

        {timed ? (
          <Row label="วันและเวลาที่จบ" error={err?.endTime}>
            <ThaiDateTimePicker
              name="endTime"
              defaultValue={v?.endTime ?? initial.endTime}
              now={now}
            />
          </Row>
        ) : null}
      </fieldset>

      {state.message ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={
            state.ok
              ? "text-sm text-green-700"
              : "text-sm text-red-600"
          }
        >
          {state.message}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "กำลังบันทึก…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

function Row({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && !error ? (
        <span className="text-xs text-ink/50">{hint}</span>
      ) : null}
      {error ? (
        <span className="text-xs text-red-600">{error}</span>
      ) : null}
    </label>
  );
}
