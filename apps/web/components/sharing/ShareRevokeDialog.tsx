"use client";

import { useMemo } from "react";
import type { LocaleCode } from "@vakwen/shared-types";
import type { OutboundShareRow } from "../../features/sharing/types";
import { getDictionary } from "../../lib/i18n";
import { ConfirmDialog } from "../admin/ConfirmDialog";

interface ShareRevokeDialogProps {
  open: boolean;
  row: OutboundShareRow | null;
  locale: LocaleCode;
  isSubmitting: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

export function ShareRevokeDialog({
  open,
  row,
  locale,
  isSubmitting,
  onConfirm,
  onOpenChange,
}: ShareRevokeDialogProps) {
  const dict = useMemo(() => getDictionary(locale), [locale]);
  if (!row) return null;

  const title = row.status === "active"
    ? dict.sharing.revokeDialog.activeTitle
    : dict.sharing.revokeDialog.pendingTitle;
  const descriptionTemplate = row.status === "active"
    ? dict.sharing.revokeDialog.activeDescription
    : dict.sharing.revokeDialog.pendingDescription;

  return (
    <ConfirmDialog
      open={open}
      title={title}
      description={descriptionTemplate.replace("{email}", row.email)}
      confirmLabel={dict.sharing.revokeDialog.confirmLabel}
      cancelLabel={dict.actions.cancel}
      variant="danger"
      loading={isSubmitting}
      onConfirm={onConfirm}
      onCancel={() => onOpenChange(false)}
    />
  );
}
