/**
 * KZO-182 — useSettingsForm merge-on-grow effect.
 *
 * Verifies that when the drawer is OPEN and the live `accounts` prop grows
 * (e.g. user creates a new account via AccountCreateForm), the new entry is
 * additively merged into both `draft.accounts` and `baseline.accounts` so:
 *   1. AccountsListSection's per-row fee-profile <select> finds the new id
 *      via `bindings.find(item => item.id === account.id)`.
 *   2. `isDirty` stays false immediately after the merge (baseline tracked).
 *   3. In-progress edits to `draft.feeProfiles` are NOT clobbered.
 *
 * Mirrors the react-dom/client + act() harness used by useEventStream.test.ts
 * (no @testing-library/react in this repo).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  AccountDto,
  FeeProfileBindingDto,
  FeeProfileDto,
  UserSettings,
} from "@vakwen/shared-types";
import { useSettingsForm } from "../../../../features/settings/hooks/useSettingsForm";
import { getDictionary } from "../../../../lib/i18n";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en");

function buildSettings(): UserSettings {
  return {
    userId: "user-1",
    displayName: "Test User",
    locale: "en",
    costBasisMethod: "WEIGHTED_AVERAGE",
    quotePollIntervalSeconds: 10,
  };
}

function buildFeeProfile(overrides: Partial<FeeProfileDto> = {}): FeeProfileDto {
  return {
    id: "fp-default",
    accountId: "acc-1",
    name: "Default Broker",
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

function buildAccount(overrides: Partial<AccountDto> = {}): AccountDto {
  return {
    id: "acc-1",
    name: "Main",
    userId: "user-1",
    feeProfileId: "fp-default",
    defaultCurrency: "TWD",
    accountType: "broker",
    ...overrides,
  };
}

type HookReturn = ReturnType<typeof useSettingsForm>;

interface ProbeProps {
  open: boolean;
  settings: UserSettings | null;
  accounts: AccountDto[];
  feeProfiles: FeeProfileDto[];
  feeProfileBindings: FeeProfileBindingDto[];
  capture: (hook: HookReturn) => void;
}

function Probe(props: ProbeProps) {
  const hook = useSettingsForm({
    open: props.open,
    settings: props.settings,
    accounts: props.accounts,
    feeProfiles: props.feeProfiles,
    feeProfileBindings: props.feeProfileBindings,
    dict,
    onOpenChange: () => undefined,
    onSave: async () => undefined,
  });
  props.capture(hook);
  return null;
}

describe("useSettingsForm — KZO-182 merge-on-grow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: HookReturn | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    latest = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(props: Omit<ProbeProps, "capture">) {
    act(() => {
      root.render(
        <Probe
          {...props}
          capture={(hook) => {
            latest = hook;
          }}
        />,
      );
    });
  }

  it("merges newly-arrived accounts into draft and baseline while drawer is open", () => {
    const settings = buildSettings();
    const profile = buildFeeProfile();
    const initialAccounts = [buildAccount({ id: "acc-1", feeProfileId: "fp-default" })];

    render({
      open: true,
      settings,
      accounts: initialAccounts,
      feeProfiles: [profile],
      feeProfileBindings: [],
    });

    expect(latest!.draft).not.toBeNull();
    expect(latest!.draft!.accounts).toHaveLength(1);
    expect(latest!.isDirty).toBe(false);

    const grown = [
      ...initialAccounts,
      buildAccount({ id: "acc-2", name: "USD Brokerage", feeProfileId: "fp-usd", defaultCurrency: "USD" }),
    ];
    const usdProfile = buildFeeProfile({
      id: "fp-usd",
      accountId: "acc-2",
      name: "USD Default",
      commissionCurrency: "USD",
    });

    render({
      open: true,
      settings,
      accounts: grown,
      feeProfiles: [profile, usdProfile],
      feeProfileBindings: [],
    });

    // Draft grew by one and contains the new id with its persisted feeProfileId.
    expect(latest!.draft!.accounts).toHaveLength(2);
    const merged = latest!.draft!.accounts.find((a) => a.id === "acc-2");
    expect(merged).toEqual({ id: "acc-2", feeProfileId: "fp-usd" });
    expect(latest!.draft!.feeProfiles.find((p) => p.id === "fp-usd")).toMatchObject({
      accountId: "acc-2",
      name: "USD Default",
      commissionCurrency: "USD",
    });

    // Baseline tracked the merge — no spurious dirty flag from the additive update.
    expect(latest!.isDirty).toBe(false);
  });

  it("does not clobber in-progress feeProfile edits when accounts grow", () => {
    const settings = buildSettings();
    const profile = buildFeeProfile();
    const initialAccounts = [buildAccount({ id: "acc-1", feeProfileId: "fp-default" })];

    render({
      open: true,
      settings,
      accounts: initialAccounts,
      feeProfiles: [profile],
      feeProfileBindings: [],
    });

    // User edits the fee profile name in the drawer (in-flight, unsaved).
    act(() => {
      latest!.updateProfileField("fp-default", "name", "Renamed Profile");
    });
    expect(latest!.draft!.feeProfiles[0].name).toBe("Renamed Profile");
    expect(latest!.isDirty).toBe(true);

    // A new account arrives via dashboard.refresh while the drawer is open.
    const grown = [
      ...initialAccounts,
      buildAccount({ id: "acc-2", name: "USD Brokerage", feeProfileId: "fp-usd", defaultCurrency: "USD" }),
    ];
    render({
      open: true,
      settings,
      accounts: grown,
      feeProfiles: [profile],
      feeProfileBindings: [],
    });

    // The in-progress profile rename survives the merge.
    expect(latest!.draft!.feeProfiles[0].name).toBe("Renamed Profile");
    // Account merged in.
    expect(latest!.draft!.accounts).toHaveLength(2);
    expect(latest!.draft!.accounts.some((a) => a.id === "acc-2")).toBe(true);
    expect(latest!.draft!.feeProfiles.find((p) => p.id === "fp-usd")).toMatchObject({
      accountId: "acc-2",
      commissionCurrency: "USD",
    });
    // Still dirty because of the rename — not because of the merge.
    expect(latest!.isDirty).toBe(true);
  });

  it("replaces untouched auto-seed stubs when the real profile payload arrives while open", () => {
    const settings = buildSettings();
    const profile = buildFeeProfile();
    const initialAccounts = [buildAccount({ id: "acc-1", feeProfileId: "fp-default" })];
    const grown = [
      ...initialAccounts,
      buildAccount({ id: "acc-2", name: "USD Brokerage", feeProfileId: "fp-usd", defaultCurrency: "USD" }),
    ];

    render({
      open: true,
      settings,
      accounts: initialAccounts,
      feeProfiles: [profile],
      feeProfileBindings: [],
    });

    render({
      open: true,
      settings,
      accounts: grown,
      feeProfiles: [profile],
      feeProfileBindings: [],
    });

    expect(latest!.draft!.feeProfiles.find((p) => p.id === "fp-usd")).toMatchObject({
      accountId: "acc-2",
      name: "Default Broker",
      commissionCurrency: "USD",
    });

    const realUsdProfile = buildFeeProfile({
      id: "fp-usd",
      accountId: "acc-2",
      name: "Server USD Profile",
      commissionDiscountPercent: 15,
      commissionCurrency: "USD",
    });
    render({
      open: true,
      settings,
      accounts: grown,
      feeProfiles: [profile, realUsdProfile],
      feeProfileBindings: [],
    });

    expect(latest!.draft!.feeProfiles.find((p) => p.id === "fp-usd")).toMatchObject({
      accountId: "acc-2",
      name: "Server USD Profile",
      commissionDiscountPercent: 15,
      commissionCurrency: "USD",
    });
    expect(latest!.isDirty).toBe(false);
  });

  it("is a no-op when accounts prop changes but contains no new ids", () => {
    const settings = buildSettings();
    const profile = buildFeeProfile();
    const accounts = [buildAccount({ id: "acc-1", feeProfileId: "fp-default" })];

    render({
      open: true,
      settings,
      accounts,
      feeProfiles: [profile],
      feeProfileBindings: [],
    });

    expect(latest!.draft!.accounts).toHaveLength(1);
    expect(latest!.isDirty).toBe(false);

    // Re-render with the same accounts (same ids) — no merge should occur.
    render({
      open: true,
      settings,
      accounts: [...accounts],
      feeProfiles: [profile],
      feeProfileBindings: [],
    });

    expect(latest!.draft!.accounts).toHaveLength(1);
    expect(latest!.isDirty).toBe(false);
  });

  it("does not merge when drawer is closed", () => {
    const settings = buildSettings();
    const profile = buildFeeProfile();

    // Drawer starts closed — no draft is seeded.
    render({
      open: false,
      settings,
      accounts: [buildAccount({ id: "acc-1", feeProfileId: "fp-default" })],
      feeProfiles: [profile],
      feeProfileBindings: [],
    });

    expect(latest!.draft).toBeNull();

    // Accounts grow while drawer remains closed.
    render({
      open: false,
      settings,
      accounts: [
        buildAccount({ id: "acc-1", feeProfileId: "fp-default" }),
        buildAccount({ id: "acc-2", feeProfileId: "fp-default" }),
      ],
      feeProfiles: [profile],
      feeProfileBindings: [],
    });

    // Still no draft — the closed→open seed handles initial seeding when reopened.
    expect(latest!.draft).toBeNull();
  });
});

describe("useSettingsForm — ui-enhancement (2026-05-14) P2-1 draft pruning", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: HookReturn | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    latest = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(props: Omit<ProbeProps, "capture">) {
    act(() => {
      root.render(
        <Probe
          {...props}
          capture={(hook) => {
            latest = hook;
          }}
        />,
      );
    });
  }

  it("prunes draft entries for accounts removed by a soft-delete refresh", () => {
    const settings = buildSettings();
    const profileA = buildFeeProfile({ id: "fp-a", accountId: "acc-a" });
    const profileB = buildFeeProfile({
      id: "fp-b",
      accountId: "acc-b",
      name: "USD Default",
      commissionCurrency: "USD",
    });
    const accountA = buildAccount({ id: "acc-a", feeProfileId: "fp-a" });
    const accountB = buildAccount({
      id: "acc-b",
      feeProfileId: "fp-b",
      defaultCurrency: "USD",
    });

    // Drawer opens with both accounts present.
    render({
      open: true,
      settings,
      accounts: [accountA, accountB],
      feeProfiles: [profileA, profileB],
      feeProfileBindings: [
        { accountId: "acc-a", ticker: "2330", feeProfileId: "fp-a" },
        { accountId: "acc-b", ticker: "AAPL", feeProfileId: "fp-b" },
      ],
    });

    expect(latest!.draft!.accounts).toHaveLength(2);
    expect(latest!.draft!.feeProfiles).toHaveLength(2);
    expect(latest!.draft!.feeProfileBindings).toHaveLength(2);

    // Soft-delete: account B disappears from the fresh fetch.
    render({
      open: true,
      settings,
      accounts: [accountA],
      feeProfiles: [profileA, profileB], // server may still include orphan; FE must prune
      feeProfileBindings: [
        { accountId: "acc-a", ticker: "2330", feeProfileId: "fp-a" },
      ],
    });

    // P2-1 invariant: every layer of the draft is pruned of acc-b refs.
    expect(latest!.draft!.accounts.map((a) => a.id)).toEqual(["acc-a"]);
    expect(latest!.draft!.feeProfiles.map((p) => p.id)).toEqual(["fp-a"]);
    expect(latest!.draft!.feeProfileBindings.map((b) => b.accountId)).toEqual([
      "acc-a",
    ]);
    expect(latest!.isDirty).toBe(false);
  });

  it("prunes per-symbol bindings owned by the removed account even when other accounts grow", () => {
    const settings = buildSettings();
    const profileA = buildFeeProfile({ id: "fp-a", accountId: "acc-a" });
    const profileB = buildFeeProfile({
      id: "fp-b",
      accountId: "acc-b",
      name: "USD Default",
      commissionCurrency: "USD",
    });

    render({
      open: true,
      settings,
      accounts: [
        buildAccount({ id: "acc-a", feeProfileId: "fp-a" }),
        buildAccount({ id: "acc-b", feeProfileId: "fp-b", defaultCurrency: "USD" }),
      ],
      feeProfiles: [profileA, profileB],
      feeProfileBindings: [
        { accountId: "acc-a", ticker: "2330", feeProfileId: "fp-a" },
        { accountId: "acc-b", ticker: "AAPL", feeProfileId: "fp-b" },
      ],
    });

    // Soft-delete acc-a AND a brand-new acc-c arrives in the same refresh.
    const profileC = buildFeeProfile({
      id: "fp-c",
      accountId: "acc-c",
      name: "AUD Default",
      commissionCurrency: "AUD",
    });
    render({
      open: true,
      settings,
      accounts: [
        buildAccount({ id: "acc-b", feeProfileId: "fp-b", defaultCurrency: "USD" }),
        buildAccount({ id: "acc-c", feeProfileId: "fp-c", defaultCurrency: "AUD" }),
      ],
      feeProfiles: [profileB, profileC],
      feeProfileBindings: [{ accountId: "acc-b", ticker: "AAPL", feeProfileId: "fp-b" }],
    });

    expect(latest!.draft!.accounts.map((a) => a.id).sort()).toEqual(["acc-b", "acc-c"]);
    expect(latest!.draft!.feeProfiles.map((p) => p.id).sort()).toEqual(["fp-b", "fp-c"]);
    // The per-symbol binding for the purged acc-a must not survive.
    expect(latest!.draft!.feeProfileBindings).toEqual([
      { accountId: "acc-b", ticker: "AAPL", feeProfileId: "fp-b" },
    ]);
  });
});
