/**
 * KZO-179 — Web-unit tests for AccountCreateForm.
 *
 * Verifies:
 *   - Renders 4 base fields (name, type pills, currency cards, callout) when
 *     `feeProfiles.length === 1`. Picker hidden per D5.
 *   - Renders fee-profile picker when `feeProfiles.length > 1`.
 *   - Live-preview chip updates as inputs change (reuses
 *     `formatAccountOption` per D13 / `nextjs-i18n-serialization.md`).
 *   - Submit button disabled when name is empty (or whitespace-only).
 *   - Submit calls `onCreate` with the resolved input AND `onAccountsRefresh`
 *     after success (D12).
 *   - Inline 409 error rendering uses `accountCreateNameInUseError` text.
 *   - Inline generic error rendering uses `accountCreateGenericError` text.
 *
 * Pattern mirrors `apps/web/test/features/cash-ledger/CashLedgerClient.test.tsx`
 * (react-dom/client + act() — not RTL — to match the project's existing
 * web-unit harness).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FeeProfileDto } from "@tw-portfolio/shared-types";
import { AccountCreateForm } from "../../../../features/settings/components/AccountCreateForm";
import { ApiError } from "../../../../lib/api";
import { getDictionary } from "../../../../lib/i18n";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en");

function buildFeeProfile(overrides: Partial<FeeProfileDto> = {}): FeeProfileDto {
  return {
    id: overrides.id ?? "fp-default",
    name: overrides.name ?? "Default Broker",
    boardCommissionRate: 1.425,
    commissionDiscountPercent: 28,
    minimumCommissionAmount: 20,
    commissionCurrency: "TWD",
    commissionRoundingMode: "FLOOR",
    taxRoundingMode: "FLOOR",
    stockSellTaxRateBps: 30,
    stockDayTradeTaxRateBps: 15,
    etfSellTaxRateBps: 10,
    bondEtfSellTaxRateBps: 0,
    commissionChargeMode: "CHARGED_UPFRONT",
    ...overrides,
  };
}

function buildAccountDto(overrides: Record<string, unknown> = {}) {
  return {
    id: "new-account-id",
    name: "USD Brokerage",
    userId: "user-1",
    feeProfileId: "fp-default",
    defaultCurrency: "USD" as const,
    accountType: "bank" as const,
    ...overrides,
  };
}

describe("AccountCreateForm", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // ── Render shape ───────────────────────────────────────────────────────────

  it("renders 4 base fields and hides fee-profile picker when feeProfiles.length === 1", () => {
    const onCreate = vi.fn();
    const onAccountsRefresh = vi.fn();

    act(() =>
      root.render(
        <AccountCreateForm
          feeProfiles={[buildFeeProfile()]}
          onCreate={onCreate}
          onAccountsRefresh={onAccountsRefresh}
          dict={dict}
        />,
      ),
    );

    expect(container.querySelector('[data-testid="account-create-form"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="account-create-name-input"]')).toBeTruthy();

    // Type pills (3) — broker, bank, wallet.
    expect(container.querySelector('[data-testid="account-create-type-broker"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="account-create-type-bank"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="account-create-type-wallet"]')).toBeTruthy();

    // Currency cards (3) — TWD, USD, AUD.
    expect(container.querySelector('[data-testid="account-create-currency-TWD"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="account-create-currency-USD"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="account-create-currency-AUD"]')).toBeTruthy();

    // Currency-lock callout.
    const callout = container.querySelector('[data-testid="account-create-currency-lock"]');
    expect(callout).toBeTruthy();
    expect(callout!.textContent).toContain(dict.settings.accountCreateCurrencyLockBody);

    // Submit + preview present.
    expect(container.querySelector('[data-testid="account-create-submit"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="account-create-preview-chip"]')).toBeTruthy();

    // Picker NOT rendered (D5 — hidden when only one profile).
    expect(container.querySelector('[data-testid="account-create-fee-profile-select"]')).toBeNull();
  });

  it("renders fee-profile picker when feeProfiles.length > 1 (D5)", () => {
    const profiles = [
      buildFeeProfile({ id: "fp-default", name: "Default Broker" }),
      buildFeeProfile({ id: "fp-alt", name: "Alt" }),
    ];

    act(() =>
      root.render(
        <AccountCreateForm
          feeProfiles={profiles}
          onCreate={vi.fn()}
          onAccountsRefresh={vi.fn()}
          dict={dict}
        />,
      ),
    );

    const picker = container.querySelector('[data-testid="account-create-fee-profile-select"]');
    expect(picker).toBeTruthy();
    const options = picker!.querySelectorAll("option");
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("Default Broker");
    expect(options[1].textContent).toContain("Alt");
  });

  // ── Live-preview chip updates ──────────────────────────────────────────────

  it("live-preview chip updates as name + type + currency change", async () => {
    act(() =>
      root.render(
        <AccountCreateForm
          feeProfiles={[buildFeeProfile()]}
          onCreate={vi.fn()}
          onAccountsRefresh={vi.fn()}
          dict={dict}
        />,
      ),
    );

    const chip = container.querySelector('[data-testid="account-create-preview-chip"]') as HTMLElement;
    // Empty initial state → placeholder text.
    expect(chip.textContent).toContain(dict.settings.accountCreateNamePlaceholder);

    // Type into name input.
    const nameInput = container.querySelector(
      '[data-testid="account-create-name-input"]',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(nameInput, "USD Brokerage");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Click Bank type pill.
    const bankPill = container.querySelector('[data-testid="account-create-type-bank"]') as HTMLButtonElement;
    await act(async () => bankPill.click());

    // Click USD currency card.
    const usdCard = container.querySelector('[data-testid="account-create-currency-USD"]') as HTMLButtonElement;
    await act(async () => usdCard.click());

    // Chip should now read "USD Brokerage (USD · Bank)" (formatAccountOption shape).
    expect(chip.textContent).toContain("USD Brokerage");
    expect(chip.textContent).toContain("USD");
    expect(chip.textContent).toContain("Bank");
  });

  // ── Submit-disabled guard ──────────────────────────────────────────────────

  it("submit button is disabled when name is empty or whitespace-only; enabled otherwise", async () => {
    act(() =>
      root.render(
        <AccountCreateForm
          feeProfiles={[buildFeeProfile()]}
          onCreate={vi.fn()}
          onAccountsRefresh={vi.fn()}
          dict={dict}
        />,
      ),
    );

    const submit = container.querySelector(
      '[data-testid="account-create-submit"]',
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    // Whitespace-only stays disabled.
    const nameInput = container.querySelector(
      '[data-testid="account-create-name-input"]',
    ) as HTMLInputElement;
    const setNameValue = (value: string) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(nameInput, value);
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    };

    await act(async () => setNameValue("   "));
    expect(submit.disabled).toBe(true);

    await act(async () => setNameValue("Real Account"));
    expect(submit.disabled).toBe(false);

    await act(async () => setNameValue(""));
    expect(submit.disabled).toBe(true);
  });

  // ── Happy-path submit calls onCreate + onAccountsRefresh + resets ─────────

  it("submit calls onCreate with the resolved input then onAccountsRefresh, and resets the form", async () => {
    const onCreate = vi.fn().mockResolvedValue(buildAccountDto());
    const onAccountsRefresh = vi.fn();

    act(() =>
      root.render(
        <AccountCreateForm
          feeProfiles={[buildFeeProfile()]}
          onCreate={onCreate}
          onAccountsRefresh={onAccountsRefresh}
          dict={dict}
        />,
      ),
    );

    // Fill name + type + currency.
    const nameInput = container.querySelector(
      '[data-testid="account-create-name-input"]',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(nameInput, "USD Brokerage");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const bankPill = container.querySelector('[data-testid="account-create-type-bank"]') as HTMLButtonElement;
    await act(async () => bankPill.click());
    const usdCard = container.querySelector('[data-testid="account-create-currency-USD"]') as HTMLButtonElement;
    await act(async () => usdCard.click());

    // Submit.
    const submit = container.querySelector(
      '[data-testid="account-create-submit"]',
    ) as HTMLButtonElement;
    await act(async () => submit.click());

    // onCreate received the trimmed name + chosen type/currency.
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith({
      name: "USD Brokerage",
      defaultCurrency: "USD",
      accountType: "bank",
    });
    // onAccountsRefresh fired after onCreate resolved.
    expect(onAccountsRefresh).toHaveBeenCalledTimes(1);

    // Form reset → name input empty again.
    expect(nameInput.value).toBe("");
  });

  it("includes feeProfileId in onCreate input when picker is shown", async () => {
    const onCreate = vi.fn().mockResolvedValue(buildAccountDto());
    const profiles = [
      buildFeeProfile({ id: "fp-default", name: "Default Broker" }),
      buildFeeProfile({ id: "fp-alt", name: "Alt" }),
    ];

    act(() =>
      root.render(
        <AccountCreateForm
          feeProfiles={profiles}
          onCreate={onCreate}
          onAccountsRefresh={vi.fn()}
          dict={dict}
        />,
      ),
    );

    // Type a name.
    const nameInput = container.querySelector(
      '[data-testid="account-create-name-input"]',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(nameInput, "Alt Account");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Pick the Alt profile via the <select>.
    const picker = container.querySelector(
      '[data-testid="account-create-fee-profile-select"]',
    ) as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set;
      setter?.call(picker, "fp-alt");
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Submit.
    const submit = container.querySelector(
      '[data-testid="account-create-submit"]',
    ) as HTMLButtonElement;
    await act(async () => submit.click());

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Alt Account",
        feeProfileId: "fp-alt",
      }),
    );
  });

  // ── Inline error rendering ────────────────────────────────────────────────

  it("renders accountCreateNameInUseError on a 409 ApiError; does NOT call onAccountsRefresh", async () => {
    const onCreate = vi.fn().mockRejectedValue(
      new ApiError("An account with that name already exists.", 409, "account_name_in_use"),
    );
    const onAccountsRefresh = vi.fn();

    act(() =>
      root.render(
        <AccountCreateForm
          feeProfiles={[buildFeeProfile()]}
          onCreate={onCreate}
          onAccountsRefresh={onAccountsRefresh}
          dict={dict}
        />,
      ),
    );

    // Fill + submit with a duplicate name.
    const nameInput = container.querySelector(
      '[data-testid="account-create-name-input"]',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(nameInput, "Main");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = container.querySelector(
      '[data-testid="account-create-submit"]',
    ) as HTMLButtonElement;
    await act(async () => submit.click());

    const errorEl = container.querySelector('[data-testid="account-create-error"]');
    expect(errorEl).toBeTruthy();
    expect(errorEl!.textContent).toBe(dict.settings.accountCreateNameInUseError);
    expect(onAccountsRefresh).not.toHaveBeenCalled();

    // Form is NOT reset on error — name remains so user can retry.
    expect(nameInput.value).toBe("Main");
  });

  it("renders accountCreateGenericError on a non-409 failure (network / 500)", async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error("boom"));
    const onAccountsRefresh = vi.fn();

    act(() =>
      root.render(
        <AccountCreateForm
          feeProfiles={[buildFeeProfile()]}
          onCreate={onCreate}
          onAccountsRefresh={onAccountsRefresh}
          dict={dict}
        />,
      ),
    );

    // Fill + submit.
    const nameInput = container.querySelector(
      '[data-testid="account-create-name-input"]',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(nameInput, "Some Name");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = container.querySelector(
      '[data-testid="account-create-submit"]',
    ) as HTMLButtonElement;
    await act(async () => submit.click());

    const errorEl = container.querySelector('[data-testid="account-create-error"]');
    expect(errorEl).toBeTruthy();
    expect(errorEl!.textContent).toBe(dict.settings.accountCreateGenericError);
    expect(onAccountsRefresh).not.toHaveBeenCalled();
  });
});
