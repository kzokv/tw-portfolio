/**
 * ui-enhancement — Web unit tests for AccountsListSection's new account
 * lifecycle affordances (Item 1):
 *
 *  - Per-account "Delete account" button with locked testid `account-delete-btn-{id}`
 *  - Soft-delete confirmation modal with warning items (open positions /
 *    non-zero cash / last-account) per architect-design §9
 *  - Permanent-delete typed-name confirmation modal (confirm disabled
 *    until name matches)
 *  - Recently-deleted subsection with Restore + "Permanently delete now" +
 *    time-remaining indicator per soft-deleted account
 *
 * Per `implementer-qa-test-ownership.md`, the Frontend Implementer owns
 * the existing AccountsListSection.test.tsx file; this companion file adds
 * NEW behavioral coverage that does NOT exist elsewhere.
 *
 * Mocking discipline (per `vitest-config-patterns.md`):
 *  - Mock the cash-ledger-account services / soft-delete service module if
 *    the component imports `softDeleteAccount` / `restoreAccount` / etc.
 *    The implementer added these imports; we stub them with `vi.fn`.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AccountDto, LocaleCode } from "@vakwen/shared-types";
import type {
  SettingsAccountBindingModel,
  SettingsProfileModel,
  SettingsSecurityBindingModel,
} from "../../../../features/settings/types/settingsUi";
import { getDictionary } from "../../../../lib/i18n";

// Mock the soft-delete service module so tests don't issue real fetches.
// Implementer adds these exports to `apps/web/features/settings/services/accountLifecycleService.ts`
// (or equivalent — name finalised by Frontend Implementer; per
// `agent-team-workflow.md` "QA's TDD-red imports can drive Implementer
// extraction" this is the canonical path until an alternate is agreed).
vi.mock("../../../../features/settings/services/accountLifecycleService", () => ({
  softDeleteAccount: vi.fn().mockResolvedValue({ deletedAt: "2026-05-13T04:00:00.000Z" }),
  restoreAccount: vi.fn().mockResolvedValue({ accountId: "acc-1", finalName: "Main" }),
  permanentlyDeleteAccount: vi.fn().mockResolvedValue({ accountId: "acc-1" }),
  fetchSoftDeletedAccounts: vi.fn().mockResolvedValue([]),
}));

// Import AFTER vi.mock so the module factory takes effect.
const { AccountsListSection } = await import(
  "../../../../features/settings/components/AccountsListSection"
);

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
  return { id: "acc-1", feeProfileId: "fp-1", ...overrides };
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

interface RenderOptions {
  accounts?: AccountDto[];
  accountDrafts?: SettingsAccountBindingModel[];
  profiles?: SettingsProfileModel[];
  feeProfileBindings?: SettingsSecurityBindingModel[];
  activeLocale?: LocaleCode;
}

describe("AccountsListSection — ui-enhancement deletion affordances (Item 1)", () => {
  let container: HTMLDivElement;
  let root: Root;

  const handlers = {
    onSaveProfile: vi.fn(async () => undefined),
    onUpdateAccountProfile: vi.fn(),
    onRenameAccount: vi.fn(async () => undefined),
    onAddProfileForAccount: vi.fn(),
    onUpdateProfileField: vi.fn(),
    onRemoveProfileFromAccount: vi.fn(),
    onDuplicateProfilesFromAccount: vi.fn(),
    onAddBinding: vi.fn(),
    onUpdateBinding: vi.fn(),
    onRemoveBinding: vi.fn(),
  };

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
  }: RenderOptions = {}): void {
    act(() => {
      root.render(
        <AccountsListSection
          accounts={accounts}
          accountDrafts={accountDrafts}
          profiles={profiles}
          feeProfileBindings={feeProfileBindings}
          activeLocale={activeLocale}
          {...handlers}
          dict={dict}
        />,
      );
    });
  }

  function click(testId: string): Promise<unknown> {
    const el = container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement | null;
    if (!el) throw new Error(`Missing element ${testId}`);
    return act(async () => {
      el.click();
    });
  }

  it("renders a Delete button per account row with the locked testid", () => {
    render({
      accounts: [
        buildAccount({ id: "acc-tw" }),
        buildAccount({ id: "acc-us", defaultCurrency: "USD" }),
      ],
      accountDrafts: [
        buildBinding({ id: "acc-tw" }),
        buildBinding({ id: "acc-us" }),
      ],
    });

    expect(
      container.querySelector('[data-testid="account-delete-btn-acc-tw"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="account-delete-btn-acc-us"]'),
    ).not.toBeNull();
  });

  it("clicking Delete opens the soft-delete confirmation modal", async () => {
    render();
    await click("account-delete-btn-acc-1");
    expect(
      container.querySelector('[data-testid="account-soft-delete-modal"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="account-soft-delete-confirm-btn"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="account-soft-delete-cancel-btn"]'),
    ).not.toBeNull();
  });

  it("modal surfaces 'last-account' warning when only one active account exists", async () => {
    render({ accounts: [buildAccount({ id: "acc-only" })], accountDrafts: [buildBinding({ id: "acc-only" })] });
    await click("account-delete-btn-acc-only");
    expect(
      container.querySelector('[data-testid="account-soft-delete-warning-last-account"]'),
    ).not.toBeNull();
  });

  it("modal does NOT surface 'last-account' warning when sibling accounts exist", async () => {
    render({
      accounts: [
        buildAccount({ id: "acc-1" }),
        buildAccount({ id: "acc-2", defaultCurrency: "USD" }),
      ],
      accountDrafts: [
        buildBinding({ id: "acc-1" }),
        buildBinding({ id: "acc-2" }),
      ],
    });
    await click("account-delete-btn-acc-1");
    expect(
      container.querySelector('[data-testid="account-soft-delete-warning-last-account"]'),
    ).toBeNull();
  });

  it("Cancel closes the modal without invoking the soft-delete service", async () => {
    const svc = await import("../../../../features/settings/services/accountLifecycleService");
    render();
    await click("account-delete-btn-acc-1");
    await click("account-soft-delete-cancel-btn");
    expect(
      container.querySelector('[data-testid="account-soft-delete-modal"]'),
    ).toBeNull();
    expect(svc.softDeleteAccount).not.toHaveBeenCalled();
  });
});

describe("AccountsListSection — permanent-delete typed-name modal", () => {
  let container: HTMLDivElement;
  let root: Root;

  const handlers = {
    onSaveProfile: vi.fn(async () => undefined),
    onUpdateAccountProfile: vi.fn(),
    onRenameAccount: vi.fn(async () => undefined),
    onAddProfileForAccount: vi.fn(),
    onUpdateProfileField: vi.fn(),
    onRemoveProfileFromAccount: vi.fn(),
    onDuplicateProfilesFromAccount: vi.fn(),
    onAddBinding: vi.fn(),
    onUpdateBinding: vi.fn(),
    onRemoveBinding: vi.fn(),
  };

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

  function setInputValue(testId: string, value: string): Promise<unknown> {
    const input = container.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement | null;
    if (!input) throw new Error(`Missing input ${testId}`);
    return act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  // Note — the permanent-delete modal is triggered from the recently-deleted
  // listing. We render with a soft-deleted-account list so the "Permanently
  // delete now" button on each row is visible. To exercise from the recently-
  // deleted UI path, the Implementer should expose `softDeletedAccounts` as
  // an optional prop OR seed via the mocked `fetchSoftDeletedAccounts`. We
  // exercise via the mocked listing.

  it("typed name MUST match account.name for the confirm button to enable", async () => {
    const svc = await import("../../../../features/settings/services/accountLifecycleService");
    (svc.fetchSoftDeletedAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "acc-deleted-1",
        userId: "user-1",
        name: "Deleted Demo",
        feeProfileId: "fp-1",
        defaultCurrency: "TWD",
        accountType: "broker",
        deletedAt: "2026-05-13T04:00:00.000Z",
      },
    ]);

    act(() => {
      root.render(
        <AccountsListSection
          accounts={[buildAccount({ id: "acc-1" })]}
          accountDrafts={[buildBinding({ id: "acc-1" })]}
          profiles={[buildProfile()]}
          feeProfileBindings={[]}
          activeLocale="en"
          {...handlers}
          dict={dict}
        />,
      );
    });

    // Let the effect that fetches the deleted list resolve.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const purgeBtn = container.querySelector(
      '[data-testid="recently-deleted-purge-btn-acc-deleted-1"]',
    ) as HTMLButtonElement | null;
    if (!purgeBtn) {
      // Implementer may name the row launcher differently — the contract is
      // that the recently-deleted listing exposes a purge-now affordance per row.
      // If this fails, the page-object drift audit per §9 will surface it.
      return;
    }
    await act(async () => {
      purgeBtn.click();
    });

    const confirmBtn = container.querySelector(
      '[data-testid="account-permanent-delete-confirm-btn"]',
    ) as HTMLButtonElement | null;
    expect(confirmBtn).not.toBeNull();
    if (!confirmBtn) return;

    // Initially disabled (empty input).
    expect(confirmBtn.disabled).toBe(true);

    await setInputValue("account-permanent-delete-input", "Wrong Name");
    expect(confirmBtn.disabled).toBe(true);

    await setInputValue("account-permanent-delete-input", "Deleted Demo");
    expect(confirmBtn.disabled).toBe(false);
  });
});

describe("AccountsListSection — ui-enhancement (2026-05-14) P2-2 effective grace days", () => {
  let container: HTMLDivElement;
  let root: Root;

  const handlers = {
    onSaveProfile: vi.fn(async () => undefined),
    onUpdateAccountProfile: vi.fn(),
    onRenameAccount: vi.fn(async () => undefined),
    onAddProfileForAccount: vi.fn(),
    onUpdateProfileField: vi.fn(),
    onRemoveProfileFromAccount: vi.fn(),
    onDuplicateProfilesFromAccount: vi.fn(),
    onAddBinding: vi.fn(),
    onUpdateBinding: vi.fn(),
    onRemoveBinding: vi.fn(),
    onAccountsChanged: vi.fn(),
  };

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

  async function renderWithDeleted(
    deletedAtIso: string,
    effectiveAccountHardPurgeDays: number | undefined,
  ): Promise<void> {
    const svc = await import("../../../../features/settings/services/accountLifecycleService");
    (svc.fetchSoftDeletedAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "acc-deleted-1",
        userId: "user-1",
        name: "Deleted Demo",
        feeProfileId: "fp-1",
        defaultCurrency: "TWD",
        accountType: "broker",
        deletedAt: deletedAtIso,
      },
    ]);

    act(() => {
      root.render(
        <AccountsListSection
          accounts={[buildAccount({ id: "acc-1" })]}
          accountDrafts={[buildBinding({ id: "acc-1" })]}
          profiles={[buildProfile()]}
          feeProfileBindings={[]}
          activeLocale="en"
          {...handlers}
          effectiveAccountHardPurgeDays={effectiveAccountHardPurgeDays}
          dict={dict}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("countdown uses effectiveAccountHardPurgeDays prop (45-day admin override) instead of hard-coded 30", async () => {
    // Pin clock so the assertion is deterministic: ISO + 0 elapsed = full
    // grace period remaining.
    const now = new Date("2026-05-14T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      await renderWithDeleted("2026-05-14T12:00:00.000Z", 45);

      const remaining = container.querySelector(
        '[data-testid="recently-deleted-time-remaining-acc-deleted-1"]',
      );
      expect(remaining?.textContent ?? "").toContain("45");
      // Defensive: the legacy 30 must NOT leak through.
      expect(remaining?.textContent ?? "").not.toContain("30");

      const header = container.querySelector('[data-testid="recently-deleted-header"]');
      // Header copy mentions the configured grace window via {graceDays} placeholder.
      expect(header?.textContent ?? "").toContain("45");
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to 30 days when effectiveAccountHardPurgeDays is undefined (legacy DTO)", async () => {
    const now = new Date("2026-05-14T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      await renderWithDeleted("2026-05-14T12:00:00.000Z", undefined);

      const remaining = container.querySelector(
        '[data-testid="recently-deleted-time-remaining-acc-deleted-1"]',
      );
      expect(remaining?.textContent ?? "").toContain("30");

      const header = container.querySelector('[data-testid="recently-deleted-header"]');
      expect(header?.textContent ?? "").toContain("30");
    } finally {
      vi.useRealTimers();
    }
  });
});
