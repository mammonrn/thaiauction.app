"use client";

import { useEffect, useRef } from "react";

import { btnDanger, btnPrimary, btnSecondary } from "@/lib/button";

/**
 * The app's one way of asking "are you sure?".
 *
 * Before this there were four inline versions — a "ยืนยัน?" span with two
 * buttons in end-auction, another in publish-controls, a bare window.confirm
 * nowhere — each looking slightly different and none of them trapping focus.
 * A confirm that looks different every time teaches people to stop reading it.
 *
 * Native <dialog>, so focus trapping, Esc-to-close and inertness come from the
 * platform rather than being reimplemented. It is opened by state rather than
 * an imperative ref so a caller only has to own one boolean.
 *
 * The rules this encodes (see CLAUDE.md):
 *   - one line saying what happens, in the interface's voice
 *   - the confirm button carries the meaning: danger destroys, primary is
 *     merely significant
 *   - the button is labelled with the verb, never "ตกลง"
 */
export function ConfirmDialog({
  open,
  title,
  detail,
  confirmLabel,
  cancelLabel = "ยกเลิก",
  tone = "danger",
  pending = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  /** One line. If it needs two, the action needs rethinking, not more prose. */
  detail?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  pending?: boolean;
  onCancel: () => void;
  /** Omit when the confirm button is a submit inside `children`-less forms. */
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // showModal() on an already-open dialog throws, so both sides are guarded.
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      // Esc and the backdrop both cancel, so the state the caller owns cannot
      // drift out of sync with what is on screen.
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onCancel();
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-xl bg-white p-0 text-ink backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">{title}</h2>
          {detail ? <p className="text-sm text-ink/60">{detail}</p> : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} className={btnSecondary}>
            {cancelLabel}
          </button>
          <button
            type="button"
            autoFocus
            disabled={pending}
            onClick={onConfirm}
            className={tone === "danger" ? btnDanger : btnPrimary}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
