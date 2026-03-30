"use client";

import { useState } from "react";
import type { LocaleCode, TransactionHistoryItemDto } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import type { TransactionPatch } from "../../features/portfolio/hooks/useTransactionMutations";
import { Button } from "../ui/Button";

interface EditableTransactionRowProps {
  transaction: TransactionHistoryItemDto;
  locale: LocaleCode;
  dict: AppDictionary;
  onSave: (patch: TransactionPatch) => Promise<void>;
  onCancel: () => void;
  isMobile?: boolean;
}

export function EditableTransactionRow({
  transaction,
  dict,
  onSave,
  onCancel,
  isMobile = false,
}: EditableTransactionRowProps) {
  const [date, setDate] = useState(transaction.tradeDate);
  const [quantity, setQuantity] = useState(String(transaction.quantity));
  const [price, setPrice] = useState(String(transaction.unitPrice));
  const [side, setSide] = useState<"BUY" | "SELL">(transaction.type);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSave() {
    setIsSubmitting(true);
    const patch: TransactionPatch = {};
    if (date !== transaction.tradeDate) patch.date = date;
    if (Number(quantity) !== transaction.quantity) patch.quantity = Number(quantity);
    if (Number(price) !== transaction.unitPrice) patch.price = Number(price);
    if (side !== transaction.type) patch.side = side;

    try {
      await onSave(patch);
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputBase = "rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400";

  if (isMobile) {
    return (
      <div className="space-y-3 p-1" data-testid="editable-transaction-form">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`mt-1 block w-full ${inputBase}`}
              data-testid="edit-date-input"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Side</label>
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as "BUY" | "SELL")}
              className={`mt-1 block w-full ${inputBase}`}
              data-testid="edit-side-select"
            >
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Qty</label>
            <input
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={`mt-1 block w-full ${inputBase}`}
              data-testid="edit-quantity-input"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Price</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={`mt-1 block w-full ${inputBase}`}
              data-testid="edit-price-input"
            />
          </div>
        </div>
        <p className="text-xs italic text-slate-400">{dict.mutations.editTickerAccountHint}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={isSubmitting}>
            {dict.mutations.editCancelButton}
          </Button>
          <Button type="button" size="sm" onClick={handleSave} disabled={isSubmitting} data-testid="edit-save-button">
            {dict.mutations.editSaveButton}
          </Button>
        </div>
      </div>
    );
  }

  // Desktop: render as table cells (wrapped in <tr> by parent)
  return (
    <>
      <td className="px-4 py-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={`w-[130px] ${inputBase}`}
          data-testid="edit-date-input"
        />
      </td>
      <td className="px-4 py-2 text-slate-600">{transaction.accountId}</td>
      <td className="px-4 py-2">
        <select
          value={side}
          onChange={(e) => setSide(e.target.value as "BUY" | "SELL")}
          className={inputBase}
          data-testid="edit-side-select"
        >
          <option value="BUY">BUY</option>
          <option value="SELL">SELL</option>
        </select>
      </td>
      <td className="px-4 py-2 text-right">
        <input
          type="number"
          min="1"
          step="1"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className={`w-[90px] text-right ${inputBase}`}
          data-testid="edit-quantity-input"
        />
      </td>
      <td className="px-4 py-2 text-right">
        <input
          type="number"
          min="0"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className={`w-[100px] text-right ${inputBase}`}
          data-testid="edit-price-input"
        />
      </td>
      <td colSpan={4} className="px-4 py-2">
        <p className="text-xs italic text-slate-400">{dict.mutations.editTickerAccountHint}</p>
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-1">
          <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={isSubmitting}>
            {dict.mutations.editCancelButton}
          </Button>
          <Button type="button" size="sm" onClick={handleSave} disabled={isSubmitting} data-testid="edit-save-button">
            {dict.mutations.editSaveButton}
          </Button>
        </div>
      </td>
    </>
  );
}
