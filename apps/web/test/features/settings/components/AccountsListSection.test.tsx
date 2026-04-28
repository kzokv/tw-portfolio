import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AccountDto, LocaleCode } from "@tw-portfolio/shared-types";
import { AccountsListSection } from "../../../../features/settings/components/AccountsListSection";
import type {
  SettingsAccountBindingModel,
  SettingsProfileModel,
  SettingsSecurityBindingModel,
} from "../../../../features/settings/types/settingsUi";
import { getDictionary } from "../../../../lib/i18n";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en");

function buildAccount(overrides: Partial<AccountDto> = {}): AccountDto {
  return {
    id: "acc-1",
    name: "Main",
    userId: "user-1",
    feeProfileId: "fp-1",
    defaultCurrency: "TWD",
    accountType: "broker",
    ...overrides,
  };
}

function buildBinding(overrides: Partial<SettingsAccountBindingModel> = {}): SettingsAccountBindingModel {
  return {
    id: "acc-1",
    feeProfileId: "fp-1",
    ...overrides,
  };
}

function buildProfile(overrides: Partial<SettingsProfileModel> = {}): SettingsProfileModel {
  return {
    id: "fp-1",
    accountId: "acc-1",
    name: "Main Default",
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

function buildSecurityBinding(
  overrides: Partial<SettingsSecurityBindingModel> = {},
): SettingsSecurityBindingModel {
  return {
    accountId: "acc-1",
    ticker: "2330",
    feeProfileId: "fp-1",
    ...overrides,
  };
}

interface RenderOptions {
  accounts?: AccountDto[];
  accountDrafts?: SettingsAccountBindingModel[];
  profiles?: SettingsProfileModel[];
  feeProfileBindings?: SettingsSecurityBindingModel[];
  activeLocale?: LocaleCode;
}

describe("AccountsListSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  const onUpdateAccountProfile = vi.fn();
  const onRenameAccount = vi.fn(async () => undefined);
  const onAddProfileForAccount = vi.fn();
  const onUpdateProfileField = vi.fn();
  const onRemoveProfileFromAccount = vi.fn();
  const onDuplicateProfilesFromAccount = vi.fn();
  const onAddBinding = vi.fn();
  const onUpdateBinding = vi.fn();
  const onRemoveBinding = vi.fn();

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render({
    accounts = [buildAccount()],
    accountDrafts = [buildBinding()],
    profiles = [buildProfile()],
    feeProfileBindings = [],
    activeLocale = "en",
  }: RenderOptions = {}) {
    act(() => {
      root.render(
        <AccountsListSection
          accounts={accounts}
          accountDrafts={accountDrafts}
          profiles={profiles}
          feeProfileBindings={feeProfileBindings}
          activeLocale={activeLocale}
          onUpdateAccountProfile={onUpdateAccountProfile}
          onRenameAccount={onRenameAccount}
          onAddProfileForAccount={onAddProfileForAccount}
          onUpdateProfileField={onUpdateProfileField}
          onRemoveProfileFromAccount={onRemoveProfileFromAccount}
          onDuplicateProfilesFromAccount={onDuplicateProfilesFromAccount}
          onAddBinding={onAddBinding}
          onUpdateBinding={onUpdateBinding}
          onRemoveBinding={onRemoveBinding}
          dict={dict}
        />,
      );
    });
  }

  function click(testId: string) {
    const element = container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement | null;
    if (!element) {
      throw new Error(`Missing element ${testId}`);
    }
    return act(async () => {
      element.click();
    });
  }

  function setInputValue(testId: string, value: string) {
    const input = container.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement | null;
    if (!input) {
      throw new Error(`Missing input ${testId}`);
    }
    return act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function setSelectValue(testId: string, value: string) {
    const select = container.querySelector(`[data-testid="${testId}"]`) as HTMLSelectElement | null;
    if (!select) {
      throw new Error(`Missing select ${testId}`);
    }
    return act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set;
      setter?.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("scopes market badges, default selectors, and overrides by account", async () => {
    render({
      accounts: [
        buildAccount({ id: "acc-1", name: "TW Main", feeProfileId: "fp-1", defaultCurrency: "TWD" }),
        buildAccount({ id: "acc-2", name: "US Broker", feeProfileId: "fp-3", defaultCurrency: "USD" }),
      ],
      accountDrafts: [
        buildBinding({ id: "acc-1", feeProfileId: "fp-1" }),
        buildBinding({ id: "acc-2", feeProfileId: "fp-3" }),
      ],
      profiles: [
        buildProfile({ id: "fp-1", accountId: "acc-1", name: "TW Default" }),
        buildProfile({ id: "fp-2", accountId: "acc-1", name: "TW Alt" }),
        buildProfile({
          id: "fp-3",
          accountId: "acc-2",
          name: "US Default",
          commissionCurrency: "USD",
        }),
      ],
      feeProfileBindings: [
        buildSecurityBinding({ accountId: "acc-1", ticker: "2330", feeProfileId: "fp-2" }),
        buildSecurityBinding({ accountId: "acc-2", ticker: "MSFT", feeProfileId: "fp-3" }),
      ],
    });

    expect(
      container.querySelector('[data-testid="accounts-card-acc-1-market-badge"]')?.textContent,
    ).toContain(dict.settings.accountsListMarketBadgeTW);
    expect(
      container.querySelector('[data-testid="accounts-card-acc-2-market-badge"]')?.textContent,
    ).toContain(dict.settings.accountsListMarketBadgeUS);

    await click("accounts-card-acc-1-toggle");
    await click("accounts-card-acc-2-toggle");

    const accountOneOptions = Array.from(
      container.querySelectorAll('[data-testid="settings-account-profile-acc-1"] option'),
    ).map((option) => (option as HTMLOptionElement).textContent);
    const accountTwoOptions = Array.from(
      container.querySelectorAll('[data-testid="settings-account-profile-acc-2"] option'),
    ).map((option) => (option as HTMLOptionElement).textContent);

    expect(accountOneOptions).toEqual(["TW Default", "TW Alt"]);
    expect(accountTwoOptions).toEqual(["US Default"]);

    expect(container.querySelector('[data-testid="accounts-override-ticker-0"]')).toBeTruthy();
    expect((container.querySelector('[data-testid="accounts-override-ticker-0"]') as HTMLInputElement).value).toBe("2330");
    expect((container.querySelector('[data-testid="accounts-override-ticker-1"]') as HTMLInputElement).value).toBe("MSFT");
  });

  it("supports add, edit, and per-account remove guards for profiles", async () => {
    render({
      accounts: [
        buildAccount({ id: "acc-1", feeProfileId: "fp-1" }),
        buildAccount({ id: "acc-2", feeProfileId: "fp-3", defaultCurrency: "USD" }),
      ],
      accountDrafts: [
        buildBinding({ id: "acc-1", feeProfileId: "fp-1" }),
        buildBinding({ id: "acc-2", feeProfileId: "fp-3" }),
      ],
      profiles: [
        buildProfile({ id: "fp-1", accountId: "acc-1", name: "Only TW Profile" }),
        buildProfile({
          id: "fp-2",
          accountId: "acc-2",
          name: "US Default",
          commissionCurrency: "USD",
        }),
        buildProfile({
          id: "fp-3",
          accountId: "acc-2",
          name: "US Alt",
          commissionCurrency: "USD",
        }),
      ],
    });

    await click("accounts-card-acc-1-toggle");
    await click("accounts-card-acc-2-toggle");

    await click("accounts-card-acc-2-add-profile");
    expect(onAddProfileForAccount).toHaveBeenCalledWith("acc-2");

    const lockedRemove = container.querySelector(
      '[data-testid="accounts-profile-remove-fp-1"]',
    ) as HTMLButtonElement;
    expect(lockedRemove.disabled).toBe(true);

    const removable = container.querySelector(
      '[data-testid="accounts-profile-remove-fp-3"]',
    ) as HTMLButtonElement;
    expect(removable.disabled).toBe(false);

    await click("accounts-profile-edit-fp-2");
    await setInputValue("accounts-profile-name-input-fp-2", "US Edited");
    expect(onUpdateProfileField).toHaveBeenCalledWith("fp-2", "name", "US Edited");

    await setSelectValue("accounts-profile-charge-mode-fp-2", "CHARGED_UPFRONT_REBATED_LATER");
    expect(onUpdateProfileField).toHaveBeenCalledWith(
      "fp-2",
      "commissionChargeMode",
      "CHARGED_UPFRONT_REBATED_LATER",
    );
  });

  it("duplicates selected profiles from another account", async () => {
    render({
      accounts: [
        buildAccount({ id: "acc-1", name: "TW Main", feeProfileId: "fp-1" }),
        buildAccount({ id: "acc-2", name: "US Broker", feeProfileId: "fp-2", defaultCurrency: "USD" }),
      ],
      accountDrafts: [
        buildBinding({ id: "acc-1", feeProfileId: "fp-1" }),
        buildBinding({ id: "acc-2", feeProfileId: "fp-2" }),
      ],
      profiles: [
        buildProfile({ id: "fp-1", accountId: "acc-1", name: "TW Default" }),
        buildProfile({
          id: "fp-2",
          accountId: "acc-2",
          name: "US Default",
          commissionCurrency: "USD",
        }),
        buildProfile({
          id: "fp-3",
          accountId: "acc-2",
          name: "US Active",
          commissionCurrency: "USD",
        }),
      ],
    });

    await click("accounts-card-acc-1-toggle");
    await click("accounts-card-acc-1-duplicate-cta");
    await setSelectValue("accounts-duplicate-source-select", "acc-2");
    await click("accounts-duplicate-checkbox-fp-3");
    await click("accounts-duplicate-confirm");

    expect(onDuplicateProfilesFromAccount).toHaveBeenCalledWith(
      "acc-2",
      "acc-1",
      ["fp-3"],
      "US Broker",
    );
  });

  it("expands only matching cards when searching by profile name", async () => {
    render({
      accounts: [
        buildAccount({ id: "acc-1", name: "TW Main", feeProfileId: "fp-1" }),
        buildAccount({ id: "acc-2", name: "AU Wallet", feeProfileId: "fp-2", defaultCurrency: "AUD", accountType: "wallet" }),
      ],
      accountDrafts: [
        buildBinding({ id: "acc-1", feeProfileId: "fp-1" }),
        buildBinding({ id: "acc-2", feeProfileId: "fp-2" }),
      ],
      profiles: [
        buildProfile({ id: "fp-1", accountId: "acc-1", name: "Taiwan Broker" }),
        buildProfile({
          id: "fp-2",
          accountId: "acc-2",
          name: "Australia Wallet Profile",
          commissionCurrency: "AUD",
        }),
      ],
    });

    expect(container.querySelector('[data-testid="settings-account-profile-acc-1"]')).toBeNull();
    expect(container.querySelector('[data-testid="settings-account-profile-acc-2"]')).toBeNull();

    await setInputValue("accounts-tab-search", "wallet");

    // KZO-183 scope item 27: search filters EXPANSION state, not visibility.
    // All cards remain in the DOM; only matching cards expand to expose the
    // profile selector.
    expect(container.querySelector('[data-testid="accounts-card-acc-1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="accounts-card-acc-2"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="settings-account-profile-acc-1"]')).toBeNull();
    expect(container.querySelector('[data-testid="settings-account-profile-acc-2"]')).toBeTruthy();
  });
});
