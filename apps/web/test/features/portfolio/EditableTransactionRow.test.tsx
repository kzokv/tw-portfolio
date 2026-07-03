import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TransactionHistoryItemDto } from "@vakwen/shared-types";
import { EditableTransactionRow } from "../../../components/portfolio/EditableTransactionRow";
import { getDictionary } from "../../../lib/i18n";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const transaction = {
  id: "tx-1",
  accountId: "acc-1",
  accountName: "Main Brokerage",
  ticker: "2330",
  marketCode: "TW",
  instrumentType: "STOCK",
  type: "BUY",
  quantity: 10,
  unitPrice: 100,
  priceCurrency: "TWD",
  tradeDate: "2026-05-31",
  tradeTimestamp: null,
  bookingSequence: null,
  commissionAmount: 7,
  taxAmount: 5,
  isDayTrade: false,
  realizedPnlAmount: null,
  realizedPnlCurrency: null,
  feeProfileId: "fp-1",
  feeProfileName: "Default Broker",
  bookedAt: null,
  feesSource: "CALCULATED",
} as TransactionHistoryItemDto & { accountName: string };

describe("EditableTransactionRow", () => {
  let container: HTMLDivElement;
  let root: Root;

  const setInputValue = (selector: string, value: string) => {
    const input = document.querySelector(selector) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return input;
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("submits manual fee overrides including zero", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(
        <table>
          <tbody>
            <tr>
              <EditableTransactionRow
                transaction={transaction}
                locale="en"
                dict={getDictionary("en")}
                onSave={onSave}
                onCancel={() => undefined}
              />
            </tr>
          </tbody>
        </table>,
      );
    });

    await act(async () => {
      setInputValue('[data-testid="edit-commission-input"]', "0");
      setInputValue('[data-testid="edit-tax-input"]', "0");
    });

    const saveButton = document.querySelector('[data-testid="edit-save-button"]') as HTMLButtonElement;
    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSave).toHaveBeenCalledWith({ commissionAmount: 0, taxAmount: 0 });
    expect(document.body.textContent).toContain("Main Brokerage");
  });

  it("accepts decimal fee overrides on the desktop editor and submits exact numbers", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(
        <table>
          <tbody>
            <tr>
              <EditableTransactionRow
                transaction={transaction}
                locale="en"
                dict={getDictionary("en")}
                onSave={onSave}
                onCancel={() => undefined}
              />
            </tr>
          </tbody>
        </table>,
      );
    });

    const commissionInput = document.querySelector('[data-testid="edit-commission-input"]') as HTMLInputElement;
    const taxInput = document.querySelector('[data-testid="edit-tax-input"]') as HTMLInputElement;
    expect(commissionInput.step).toBe("0.0001");
    expect(commissionInput.inputMode).toBe("decimal");
    expect(taxInput.step).toBe("0.0001");
    expect(taxInput.inputMode).toBe("decimal");

    await act(async () => {
      setInputValue('[data-testid="edit-commission-input"]', "12.5");
      setInputValue('[data-testid="edit-tax-input"]', "3.25");
    });

    expect(commissionInput.value).toBe("12.5");
    expect(taxInput.value).toBe("3.25");

    const saveButton = document.querySelector('[data-testid="edit-save-button"]') as HTMLButtonElement;
    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSave).toHaveBeenCalledWith({ commissionAmount: 12.5, taxAmount: 3.25 });
  });

  it("accepts decimal fee overrides on the mobile editor and submits exact numbers", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(
        <EditableTransactionRow
          transaction={transaction}
          locale="en"
          dict={getDictionary("en")}
          onSave={onSave}
          onCancel={() => undefined}
          isMobile
        />,
      );
    });

    const commissionInput = document.querySelector('[data-testid="edit-commission-input"]') as HTMLInputElement;
    const taxInput = document.querySelector('[data-testid="edit-tax-input"]') as HTMLInputElement;
    expect(commissionInput.step).toBe("0.0001");
    expect(commissionInput.inputMode).toBe("decimal");
    expect(taxInput.step).toBe("0.0001");
    expect(taxInput.inputMode).toBe("decimal");

    await act(async () => {
      setInputValue('[data-testid="edit-commission-input"]', "0.125");
      setInputValue('[data-testid="edit-tax-input"]', "0.5");
    });

    expect(commissionInput.value).toBe("0.125");
    expect(taxInput.value).toBe("0.5");

    const saveButton = document.querySelector('[data-testid="edit-save-button"]') as HTMLButtonElement;
    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSave).toHaveBeenCalledWith({ commissionAmount: 0.125, taxAmount: 0.5 });
  });
});
