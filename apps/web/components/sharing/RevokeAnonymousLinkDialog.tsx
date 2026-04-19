"use client";

import { useMemo } from "react";
import type { LocaleCode } from "@tw-portfolio/shared-types";
import { getDictionary } from "../../lib/i18n";
import { ConfirmDialog } from "../admin/ConfirmDialog";

interface RevokeAnonymousLinkDialogProps {
  open: boolean;
  locale: LocaleCode;
  isSubmitting: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

export function RevokeAnonymousLinkDialog({
  open,
  locale,
  isSubmitting,
  onConfirm,
  onOpenChange,
}: RevokeAnonymousLinkDialogProps) {
  const dict = useMemo(() => getDictionary(locale), [locale]);
  const copy = dict.sharing.publicLinks.revokeDialog;

  return (
    <ConfirmDialog
      open={open}
      title={copy.title}
      description={copy.description}
      confirmLabel={copy.confirmLabel}
      cancelLabel={copy.cancelLabel}
      variant="danger"
      loading={isSubmitting}
      onConfirm={onConfirm}
      onCancel={() => onOpenChange(false)}
    />
  );
}
