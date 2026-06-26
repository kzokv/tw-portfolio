/**
 * KZO-179 / KZO-183 — Web-unit tests for AccountCreateForm.
 *
 * Verifies (post KZO-183):
 *   - Renders 4 base fields (name, type pills, market cards, callout). The
 *     fee-profile picker was removed entirely — the route auto-seeds a
 *     default profile, so the client never sets `feeProfileId`.
 *   - Live-preview chip updates as inputs change (reuses
 *     `formatAccountOption` per D13 / `nextjs-i18n-serialization.md`).
 *   - Submit button disabled when name is empty (or whitespace-only).
 *   - Submit calls `onCreate` with `{name, defaultCurrency, accountType}` —
 *     NO `feeProfileId` — and `onAccountsRefresh` after success (D12).
 *   - Inline 409 error rendering uses `accountCreateNameInUseError` text.
 *   - Inline generic error rendering uses `accountCreateGenericError` text.
 *   - Market labels render Taiwan / United States / Australia / South Korea / Japan per E3.
 *
 * Pattern mirrors `apps/web/test/features/cash-ledger/CashLedgerClient.test.tsx`
 * (react-dom/client + act() — not RTL — to match the project's existing
 * web-unit harness).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AccountCreateForm } from "../../../../features/settings/components/AccountCreateForm";
import { ApiError } from "../../../../lib/api";
import { getDictionary } from "../../../../lib/i18n";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en");

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

  it("renders the 4 base sections (name, type pills, market cards, callout) with no fee-profile picker", () => {
    const onCreate = vi.fn();
    const onAccountsRefresh = vi.fn();

    act(() =>
      root.render(
        <AccountCreateForm
          onCreate={onCreate}
          onAccountsRefresh={onAccountsRefresh}
          dict={dict}
        />,
      ),
    );

    const formShell = container.querySelector('[data-testid="account-create-form"]') as HTMLElement;
    expect(formShell).toBeTruthy();
    expect(formShell.className).not.toContain(["glass", "inset"].join("-"));
    expect(container.querySelector('[data-testid="account-create-name-input"]')).toBeTruthy();

    // Type pills (3) — broker, bank, wallet.
    expect(container.querySelector('[data-testid="account-create-type-broker"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="account-create-type-bank"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="account-create-type-wallet"]')).toBeTruthy();

    // Market cards (5) — TWD, USD, AUD, KRW, JPY; labels read country names per E3.
    const tw = container.querySelector('[data-testid="account-create-currency-TWD"]');
    const us = container.querySelector('[data-testid="account-create-currency-USD"]');
    const au = container.querySelector('[data-testid="account-create-currency-AUD"]');
    const kr = container.querySelector('[data-testid="account-create-currency-KRW"]');
    const jp = container.querySelector('[data-testid="account-create-currency-JPY"]');
    expect(tw).toBeTruthy();
    expect(us).toBeTruthy();
    expect(au).toBeTruthy();
    expect(kr).toBeTruthy();
    expect(jp).toBeTruthy();
    expect(tw!.textContent).toContain(dict.settings.accountCreateMarketTaiwan);
    expect(us!.textContent).toContain(dict.settings.accountCreateMarketUnitedStates);
    expect(au!.textContent).toContain(dict.settings.accountCreateMarketAustralia);
    expect(kr!.textContent).toContain(dict.settings.accountCreateMarketKorea);
    expect(jp!.textContent).toContain(dict.settings.accountCreateMarketJapan);

    // Currency-lock callout.
    const callout = container.querySelector('[data-testid="account-create-currency-lock"]');
    expect(callout).toBeTruthy();
    expect(callout!.textContent).toContain(dict.settings.accountCreateCurrencyLockBody);

    // Submit + preview present.
    expect(container.querySelector('[data-testid="account-create-submit"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="account-create-preview-chip"]')).toBeTruthy();

    // KZO-183: fee-profile picker removed.
    expect(container.querySelector('[data-testid="account-create-fee-profile-select"]')).toBeNull();
  });

  // ── Live-preview chip updates ──────────────────────────────────────────────

  it("live-preview chip updates as name + type + currency change", async () => {
    act(() =>
      root.render(
        <AccountCreateForm
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

    // Click USD market card.
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

    // KZO-183: onCreate received only the trimmed name + chosen type/currency
    // — feeProfileId is no longer on the input shape.
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

  // ── Inline error rendering ────────────────────────────────────────────────

  it("renders accountCreateNameInUseError on a 409 ApiError; does NOT call onAccountsRefresh", async () => {
    const onCreate = vi.fn().mockRejectedValue(
      new ApiError("An account with that name already exists.", 409, "account_name_in_use"),
    );
    const onAccountsRefresh = vi.fn();

    act(() =>
      root.render(
        <AccountCreateForm
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
