"use client";

import { useActionState } from "react";

import { liftBanAction, type AdminActionState } from "@/app/admin/reports/actions";
import { btnSecondarySm } from "@/lib/button";

const initialState: AdminActionState = { ok: false, message: null };

export type BanRow = {
  id: string;
  kindLabel: string;
  reason: string;
  userName: string;
  userEmail: string;
  issuedBy: string;
  issuedAt: string;
  expiresLabel: string;
  state: "active" | "lifted" | "expired";
  liftedAt: string | null;
};

/**
 * One ban in the history.
 *
 * The state badge distinguishes three things a two-state view would blur:
 * still in force, ended early by an admin, and simply run out. Only the first
 * has anything to do.
 */
export function AdminBanRow({ row }: { row: BanRow }) {
  const [state, lift, lifting] = useActionState(liftBanAction, initialState);

  const badge =
    row.state === "active"
      ? { text: "กำลังมีผล", className: "bg-brand/12 text-brand" }
      : row.state === "lifted"
        ? { text: "ปลดแล้ว", className: "bg-success/12 text-success" }
        : { text: "หมดอายุแล้ว", className: "bg-black/[.06] text-ink/60" };

  return (
    <li className="flex flex-col gap-2 rounded-xl bg-white p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {row.userName}{" "}
          <span className="font-normal text-ink/55">({row.userEmail})</span>
        </span>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.className}`}>
          {badge.text}
        </span>
      </div>

      <p className="text-xs text-ink/70">
        {row.kindLabel} · {row.reason}
      </p>

      <p className="text-xs text-ink/55">
        โดย {row.issuedBy} · {row.issuedAt} · หมดอายุ {row.expiresLabel}
        {row.liftedAt ? ` · ปลดเมื่อ ${row.liftedAt}` : ""}
      </p>

      {row.state === "active" ? (
        <form action={lift}>
          <input type="hidden" name="banId" value={row.id} />
          <button type="submit" disabled={lifting} className={btnSecondarySm}>
            {lifting ? "กำลังปลด…" : "ปลดแบน"}
          </button>
        </form>
      ) : null}

      {state.message ? (
        <p className={state.ok ? "text-xs text-success" : "text-xs text-brand"}>
          {state.message}
        </p>
      ) : null}
    </li>
  );
}
