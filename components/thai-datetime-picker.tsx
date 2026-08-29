"use client";

import { useMemo, useState } from "react";

import {
  THAI_MONTHS,
  daysInMonth,
  formatThaiDateTime,
  toBuddhistYear,
} from "@/lib/thai-datetime";

const selectClass =
  "rounded-lg border border-black/15 px-2 py-2";

/** How many years ahead a seller may schedule a close. */
const YEARS_AHEAD = 3;

type Parts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

/** Next round half-hour tomorrow, as a starting point for a new listing. */
function defaultParts(now: number): Parts {
  const d = new Date(now + 24 * 60 * 60 * 1000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 0, 0, 0);
  if (d.getMinutes() === 0) d.setHours(d.getHours() + 1);
  return {
    year: d.getFullYear(),
    month: d.getMonth(),
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
  };
}

function partsFrom(value: string | undefined, now: number): Parts {
  if (!value) return defaultParts(now);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return defaultParts(now);
  return {
    year: d.getFullYear(),
    month: d.getMonth(),
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
  };
}

/**
 * Thai date/time picker.
 *
 * Built from plain <select>s rather than a native datetime input because that
 * input's format is chosen by the browser and OS, not the page: in Chromium it
 * renders "08/28/2026, 02:30 PM" even under locale th-TH with lang="th", so a
 * Thai seller cannot be shown a Buddhist year or a 24-hour clock through it.
 * Selects keep the format fully under our control while staying keyboard- and
 * screen-reader-friendly and using the platform's own picker wheels on mobile.
 *
 * The visible controls are Thai (full month names, พ.ศ. years, 00-23 hours);
 * the value posted is the exact instant as a UTC ISO string, so the server
 * stores a real point in time and never has to guess which timezone the
 * seller meant.
 */
export function ThaiDateTimePicker({
  name,
  defaultValue,
  now,
}: {
  name: string;
  defaultValue?: string;
  /**
   * Server render time. Passed in rather than read with Date.now() here: the
   * React Compiler rules reject impure calls during render, and it also means
   * the "too soon" hint is measured against the same clock the Server Action
   * validates with, so the form cannot say one thing and the server another.
   */
  now: number;
}) {
  const [parts, setParts] = useState<Parts>(() => partsFrom(defaultValue, now));

  const thisYear = new Date(now).getFullYear();
  const years = Array.from({ length: YEARS_AHEAD + 1 }, (_, i) => thisYear + i);
  const maxDay = daysInMonth(parts.year, parts.month);
  const days = Array.from({ length: maxDay }, (_, i) => i + 1);

  const selected = useMemo(
    () => new Date(parts.year, parts.month, parts.day, parts.hour, parts.minute),
    [parts],
  );

  function update(patch: Partial<Parts>) {
    setParts((current) => {
      const next = { ...current, ...patch };
      // Moving to a shorter month must not leave an impossible date such as
      // 31 กุมภาพันธ์; clamp to the last valid day instead.
      const limit = daysInMonth(next.year, next.month);
      if (next.day > limit) next.day = limit;
      return next;
    });
  }

  const tooSoon = selected.getTime() - now < 60 * 60 * 1000;

  return (
    <div className="flex flex-col gap-2">
      {/* The posted value: an absolute instant, not a local wall-clock string. */}
      <input type="hidden" name={name} value={selected.toISOString()} />

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="วันที่"
          value={parts.day}
          onChange={(e) => update({ day: Number(e.target.value) })}
          className={selectClass}
        >
          {days.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        <select
          aria-label="เดือน"
          value={parts.month}
          onChange={(e) => update({ month: Number(e.target.value) })}
          className={selectClass}
        >
          {THAI_MONTHS.map((label, index) => (
            <option key={label} value={index}>
              {label}
            </option>
          ))}
        </select>

        <select
          aria-label="ปี พ.ศ."
          value={parts.year}
          onChange={(e) => update({ year: Number(e.target.value) })}
          className={selectClass}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {toBuddhistYear(y)}
            </option>
          ))}
        </select>

        <span className="px-1 text-sm text-ink/60">เวลา</span>

        <select
          aria-label="ชั่วโมง"
          value={parts.hour}
          onChange={(e) => update({ hour: Number(e.target.value) })}
          className={selectClass}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, "0")}
            </option>
          ))}
        </select>

        <span aria-hidden="true">:</span>

        <select
          aria-label="นาที"
          value={parts.minute}
          onChange={(e) => update({ minute: Number(e.target.value) })}
          className={selectClass}
        >
          {Array.from({ length: 60 }, (_, m) => (
            <option key={m} value={m}>
              {String(m).padStart(2, "0")}
            </option>
          ))}
        </select>

        <span className="text-sm text-ink/60">น.</span>
      </div>

      <p className="text-xs text-ink/60">
        จบการประมูล: {formatThaiDateTime(selected)}
      </p>

      {tooSoon ? (
        <p className="text-xs text-warning">
          เวลาจบต้องห่างจากตอนนี้อย่างน้อย 1 ชั่วโมง
        </p>
      ) : null}
    </div>
  );
}
