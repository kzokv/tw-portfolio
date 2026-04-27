/**
 * Unit tests for the account-option mapping helper used by CashLedgerClient (KZO-167).
 *
 * Verifies the pure function that formats account dropdown labels in the format:
 *   "${name} (${defaultCurrency} · ${typeLabel})"
 *
 * Import path: adjust if the Implementer places the helper in a different file.
 * Expected export location (per D9 / Phase 6 scope-todo):
 *   apps/web/features/cash-ledger/utils/accountOptions.ts
 *   OR exported directly from CashLedgerClient.tsx.
 *
 * Do NOT render <CashLedgerClient /> in this file — that is a heavyweight
 * integration concern. Test the pure mapping function only.
 *
 * TDD-red until the Implementer extracts and exports the helper (Phase 6).
 * If the helper is NOT extracted as a separate function, send [QUESTION] to
 * Architect per the scope-todo coordination note.
 */

import { describe, it, expect } from "vitest";
import type { AccountDefaultCurrency, AccountType } from "@tw-portfolio/shared-types";
// Adjust import path if the Implementer places it elsewhere:
import { formatAccountOption } from "../../../features/cash-ledger/utils/accountOptions.js";

// ─── Type alias for the subset of AccountDto the helper needs ─────────────────

type AccountOptionInput = {
  name: string;
  defaultCurrency: AccountDefaultCurrency;
  accountType: AccountType;
};

// ─── Mock i18n type-label dictionary (mirrors cashLedgerI18n keys) ─────────────

const EN_TYPE_LABELS = {
  accountTypeBroker: "Broker",
  accountTypeBank: "Bank",
  accountTypeWallet: "Wallet",
};

const ZH_TYPE_LABELS = {
  accountTypeBroker: "券商",
  accountTypeBank: "銀行",
  accountTypeWallet: "錢包",
};

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeAccount(overrides: Partial<AccountOptionInput> = {}): AccountOptionInput {
  return {
    name: "Main",
    defaultCurrency: "TWD",
    accountType: "broker",
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("formatAccountOption", () => {
  // ── English labels ─────────────────────────────────────────────────────────

  it("formats a TWD broker account as 'Main (TWD · Broker)'", () => {
    const account = makeAccount({ name: "Main", defaultCurrency: "TWD", accountType: "broker" });
    expect(formatAccountOption(account, EN_TYPE_LABELS)).toBe("Main (TWD · Broker)");
  });

  it("formats a USD bank account as 'US Broker (USD · Bank)'", () => {
    const account = makeAccount({ name: "US Broker", defaultCurrency: "USD", accountType: "bank" });
    expect(formatAccountOption(account, EN_TYPE_LABELS)).toBe("US Broker (USD · Bank)");
  });

  it("formats an AUD wallet account as 'AU Wallet (AUD · Wallet)'", () => {
    const account = makeAccount({ name: "AU Wallet", defaultCurrency: "AUD", accountType: "wallet" });
    expect(formatAccountOption(account, EN_TYPE_LABELS)).toBe("AU Wallet (AUD · Wallet)");
  });

  // ── Currency rendering ─────────────────────────────────────────────────────

  it("renders currency code untranslated (TWD stays 'TWD', not '台幣')", () => {
    const account = makeAccount({ defaultCurrency: "TWD", accountType: "broker" });
    const result = formatAccountOption(account, EN_TYPE_LABELS);
    expect(result).toContain("TWD");
  });

  it("renders USD currency code untranslated", () => {
    const account = makeAccount({ defaultCurrency: "USD", accountType: "broker" });
    const result = formatAccountOption(account, EN_TYPE_LABELS);
    expect(result).toContain("USD");
  });

  it("renders AUD currency code untranslated", () => {
    const account = makeAccount({ defaultCurrency: "AUD", accountType: "broker" });
    const result = formatAccountOption(account, EN_TYPE_LABELS);
    expect(result).toContain("AUD");
  });

  // ── i18n label dispatch ────────────────────────────────────────────────────

  it("uses accountTypeBroker label from the dict for 'broker' accounts", () => {
    const account = makeAccount({ accountType: "broker" });
    expect(formatAccountOption(account, EN_TYPE_LABELS)).toContain("Broker");
    expect(formatAccountOption(account, ZH_TYPE_LABELS)).toContain("券商");
  });

  it("uses accountTypeBank label from the dict for 'bank' accounts", () => {
    const account = makeAccount({ accountType: "bank" });
    expect(formatAccountOption(account, EN_TYPE_LABELS)).toContain("Bank");
    expect(formatAccountOption(account, ZH_TYPE_LABELS)).toContain("銀行");
  });

  it("uses accountTypeWallet label from the dict for 'wallet' accounts", () => {
    const account = makeAccount({ accountType: "wallet" });
    expect(formatAccountOption(account, EN_TYPE_LABELS)).toContain("Wallet");
    expect(formatAccountOption(account, ZH_TYPE_LABELS)).toContain("錢包");
  });

  // ── Format structure ───────────────────────────────────────────────────────

  it("output has the form '{name} ({currency} · {typeLabel})'", () => {
    const account = makeAccount({ name: "My Account", defaultCurrency: "USD", accountType: "bank" });
    const result = formatAccountOption(account, EN_TYPE_LABELS);
    // Structure: name followed by space-parenthesis, currency, middle-dot, type, closing parenthesis
    expect(result).toMatch(/^My Account \(USD · Bank\)$/);
  });

  it("separates currency and type label with a middle dot '·' (not a hyphen)", () => {
    const account = makeAccount();
    const result = formatAccountOption(account, EN_TYPE_LABELS);
    expect(result).toContain("·");
    expect(result).not.toContain(" - ");
    expect(result).not.toContain(" / ");
  });

  it("account name is at the start of the output string", () => {
    const account = makeAccount({ name: "Special Account" });
    const result = formatAccountOption(account, EN_TYPE_LABELS);
    expect(result.startsWith("Special Account")).toBe(true);
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it("handles an account name with special characters", () => {
    const account = makeAccount({ name: "TSMC主帳戶", defaultCurrency: "TWD", accountType: "broker" });
    const result = formatAccountOption(account, ZH_TYPE_LABELS);
    expect(result).toBe("TSMC主帳戶 (TWD · 券商)");
  });

  it("handles an account name with leading/trailing spaces (renders as-is)", () => {
    // The helper renders name as-is; trimming is the caller's responsibility
    const account = makeAccount({ name: "  Main  " });
    const result = formatAccountOption(account, EN_TYPE_LABELS);
    expect(result.startsWith("  Main  ")).toBe(true);
  });
});
