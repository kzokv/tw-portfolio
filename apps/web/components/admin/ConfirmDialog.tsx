"use client";

import { useEffect, useRef } from "react";
import { Button } from "../ui/Button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  loading?: boolean;
  dialogTestId?: string;
  confirmTestId?: string;
  cancelTestId?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  loading = false,
  dialogTestId = "confirm-dialog",
  confirmTestId = "confirm-dialog-confirm",
  cancelTestId = "confirm-dialog-cancel",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      className="m-auto max-w-md rounded-2xl border border-slate-200 bg-white p-0 shadow-[0_20px_60px_rgba(15,23,42,0.2)] backdrop:bg-slate-950/40"
      data-testid={dialogTestId}
    >
      <div className="p-6">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={loading}
            data-testid={cancelTestId}
          >
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            className={variant === "danger" ? "border-red-300 bg-red-600 shadow-red-200/40 hover:bg-red-700" : ""}
            onClick={onConfirm}
            disabled={loading}
            data-testid={confirmTestId}
          >
            {loading ? "Processing..." : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
