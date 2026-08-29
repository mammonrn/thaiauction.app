"use client";

import { useActionState, useState } from "react";

import type { SellActionState } from "@/app/sell/actions";
import { ImageUploader, type UploadedImage } from "@/components/image-uploader";
import { ThaiDateTimePicker } from "@/components/thai-datetime-picker";
import { MAX_DESCRIPTION, MAX_TITLE } from "@/lib/auction-rules";
import { btnPrimary, btnSecondary } from "@/lib/button";
import { CONDITION_LABEL } from "@/lib/condition";

const initialState: SellActionState = { ok: false, message: null };

const inputClass =
  "rounded-lg border border-black/15 px-3 py-2";

const CONDITIONS = [
  { value: "brand_new", label: CONDITION_LABEL.brand_new },
  { value: "used", label: CONDITION_LABEL.used },
] as const;

export type AuctionFormValues = {
  itemId?: string;
  categoryId: string;
  condition: string;
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
  category,
  initial,
  draftLabel,
  canPublish,
  maxImages,
  now,
}: {
  action: (
    prev: SellActionState,
    formData: FormData,
  ) => Promise<SellActionState>;
  /** Editing: the category is one field among many and can be changed here. */
  categories?: { id: string; name: string }[];
  /** Creating: already answered on the previous screen, so it rides along as
   *  a hidden value and the picker link above the form does the changing. */
  category?: { id: string; name: string };
  initial: AuctionFormValues;
  /** The save button's label. */
  draftLabel: string;
  /** False for a listing that is already live, where saving edits is the only
   *  thing left to do and "เผยแพร่เลย" would be an offer to do it twice. */
  canPublish: boolean;
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

      {category ? (
        <input type="hidden" name="categoryId" value={category.id} />
      ) : (
        <Row label="หมวดหมู่" error={err?.categoryId}>
          <select
            name="categoryId"
            required
            defaultValue={v?.categoryId ?? initial.categoryId}
            className={inputClass}
          >
            <option value="">เลือกหมวดหมู่</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Row>
      )}

      {/* Second, right after the name: it is the buyer's first question and
          the one thing the photographs cannot answer. */}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium">สภาพสินค้า</legend>
        <div className="flex gap-2">
          {CONDITIONS.map(({ value, label }) => (
            <label
              key={value}
              className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-black/15 px-3 py-2.5 text-sm has-checked:border-brand has-checked:bg-brand/[.06] has-checked:font-medium has-checked:text-brand"
            >
              <input
                type="radio"
                name="condition"
                value={value}
                required
                defaultChecked={(v?.condition ?? initial.condition) === value}
                className="accent-brand"
              />
              {label}
            </label>
          ))}
        </div>
        {err?.condition ? (
          <span className="text-xs text-brand">{err.condition}</span>
        ) : null}
      </fieldset>

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
              ? "text-sm text-success"
              : "text-sm text-brand"
          }
        >
          {state.message}
        </p>
      ) : null}

      {/* Both are submits on the same form, distinguished by the value they
          post. Publishing used to mean saving a draft here and then finding a
          publish button on the next page; the seller can now finish in one
          press, and publishing is the press that looks like the point.

          `intent` is only a request: the server still validates a publish
          strictly (images required) and refuses one that is not ready, which
          is why the draft button stays useful for a half-finished listing. */}
      <div className="flex flex-wrap items-center gap-2">
        {canPublish ? (
          <>
            <button
              type="submit"
              name="intent"
              value="publish"
              disabled={pending}
              className={btnPrimary}
            >
              {pending ? "กำลังบันทึก…" : "เผยแพร่เลย"}
            </button>
            <button
              type="submit"
              name="intent"
              value="draft"
              disabled={pending}
              className={btnSecondary}
            >
              {draftLabel}
            </button>
          </>
        ) : (
          <button
            type="submit"
            name="intent"
            value="draft"
            disabled={pending}
            className={btnPrimary}
          >
            {pending ? "กำลังบันทึก…" : draftLabel}
          </button>
        )}
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
        <span className="text-xs text-brand">{error}</span>
      ) : null}
    </label>
  );
}
