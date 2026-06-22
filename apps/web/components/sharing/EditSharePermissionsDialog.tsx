"use client";

import { useEffect, useMemo, useState } from "react";
import type { LocaleCode, ShareCapability } from "@vakwen/shared-types";
import { ASSIGNABLE_SHARE_CAPABILITIES } from "../../features/sharing/capabilities";
import type { OutboundShareRow } from "../../features/sharing/types";
import { getDictionary } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Badge } from "../ui/shadcn/badge";
import { Checkbox } from "../ui/shadcn/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/shadcn/dialog";

interface EditSharePermissionsDialogProps {
  open: boolean;
  locale: LocaleCode;
  row: OutboundShareRow | null;
  allowedCapabilities?: ShareCapability[];
  isSubmitting: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSave: (row: OutboundShareRow, capabilities: ShareCapability[]) => void | Promise<void>;
}

export function EditSharePermissionsDialog({
  open,
  locale,
  row,
  allowedCapabilities,
  isSubmitting,
  error,
  onOpenChange,
  onSave,
}: EditSharePermissionsDialogProps) {
  const dict = useMemo(() => getDictionary(locale), [locale]);
  const capabilityOptions = allowedCapabilities ?? ASSIGNABLE_SHARE_CAPABILITIES;
  const [selected, setSelected] = useState<ShareCapability[]>([]);

  useEffect(() => {
    if (!open) return;
    setSelected((row?.capabilities ?? []).filter((capability) => capabilityOptions.includes(capability)));
  }, [capabilityOptions, open, row]);

  function toggleCapability(capability: ShareCapability, checked: boolean) {
    setSelected((current) =>
      checked
        ? [...new Set([...current, capability])]
        : current.filter((item) => item !== capability),
    );
  }

  const summary = selected.length === 0
    ? dict.sharing.editPermissionsDialog.readOnlySummary
    : dict.sharing.editPermissionsDialog.delegatedSummary;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="edit-share-permissions-dialog">
        <DialogHeader>
          <DialogTitle>{dict.sharing.editPermissionsDialog.title}</DialogTitle>
          <DialogDescription>
            {dict.sharing.editPermissionsDialog.description.replace("{email}", row?.email ?? "")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Badge variant="secondary" className="w-fit">
            {summary}
          </Badge>

          <div className="grid gap-2 sm:grid-cols-2">
            {capabilityOptions.map((capability) => {
              const checkboxId = `edit-share-capability-${capability.replace(/[^a-z0-9]+/gi, "-")}`;
              return (
                <label
                  key={capability}
                  htmlFor={checkboxId}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  <span>{dict.sharing.capabilityLabels[capability]}</span>
                  <Checkbox
                    id={checkboxId}
                    checked={selected.includes(capability)}
                    onCheckedChange={(checked) => toggleCapability(capability, checked === true)}
                    disabled={isSubmitting}
                    data-testid={`edit-share-capability-${capability}`}
                  />
                </label>
              );
            })}
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert" data-testid="edit-share-permissions-error">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {dict.actions.cancel}
          </Button>
          <Button
            onClick={() => {
              if (row) void onSave(row, selected);
            }}
            disabled={!row || isSubmitting}
            data-testid="edit-share-permissions-save"
          >
            {isSubmitting
              ? dict.sharing.editPermissionsDialog.savingLabel
              : dict.sharing.editPermissionsDialog.saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
