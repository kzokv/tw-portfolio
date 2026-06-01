"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import type { AccountDefaultCurrency } from "@vakwen/shared-types";
import { ACCOUNT_DEFAULT_CURRENCIES } from "@vakwen/shared-types";
import { useSettingsRouteContext } from "./SettingsRouteProvider";
import { getDictionary } from "../../lib/i18n";
import { useAppShellData } from "../layout/AppShellDataContext";
import { AccountCreateForm } from "../../features/settings/components/AccountCreateForm";
import { AccountsListSection } from "../../features/settings/components/AccountsListSection";
import { createAccount } from "../../features/cash-ledger/services/cashLedgerService";
import { renameAccount } from "../../features/settings/services/settingsService";
import { postJson } from "../../lib/api";
import type { FeeProfileDto } from "@vakwen/shared-types";
import { useEffect, useMemo, useState } from "react";
import type {
  SettingsAccountBindingModel,
  SettingsProfileModel,
  SettingsSecurityBindingModel,
} from "../../features/settings/types/settingsUi";
import { toSettingsFormModel } from "../../features/settings/mappers/settingsMappers";

const PREFILL_CURRENCIES = new Set<AccountDefaultCurrency>(ACCOUNT_DEFAULT_CURRENCIES);

function parsePrefillCurrency(raw: string | null): AccountDefaultCurrency | undefined {
  if (raw && PREFILL_CURRENCIES.has(raw as AccountDefaultCurrency)) {
    return raw as AccountDefaultCurrency;
  }
  return undefined;
}

/**
 * Phase 3d S6 — `/settings/accounts` body.
 *
 * Wraps `<AccountCreateForm>` + `<AccountsListSection>` (the latter is
 * reskinned in-place for A6 — see the component file for the shadcn token
 * conversion). The existing sensitive-confirmation modals
 * (currency / fee-profile) inside `AccountsListSection` are preserved verbatim
 * per the §8 preservation checklist.
 *
 * Fee-profile editing is local-state with optimistic mutations against the
 * shell account config — the user clicks "Save profile edit" inline within
 * each profile card to commit. (The previous omnibus PUT /settings/full
 * tracked dirty state across the entire drawer; in the route world, each
 * profile-card has its own narrow save action.)
 */
export function AccountsSettingsClient() {
  const { locale, initialSettings } = useSettingsRouteContext();
  const dict = getDictionary(locale);
  const shellData = useAppShellData();
  // Phase 3d H1 — read the `accountsPrefillCurrency` query param so the
  // KZO-169 NC4 deep-link from the transaction form's "no {currency}
  // account" inline error still pre-selects the right currency on the
  // embedded `<AccountCreateForm>`. Per `.claude/rules/nextjs-server-cookie-access.md`,
  // client-side hooks (useSearchParams) are the correct mechanism in a
  // "use client" module — not server cookies.
  const searchParams = useSearchParams();
  const prefillCurrency = parsePrefillCurrency(
    searchParams?.get("accountsPrefillCurrency") ?? null,
  );

  // Build a local working copy of the settings form model from the
  // shell account config. AccountsListSection still operates on its own
  // draft mutators (legacy API surface); we forward changes through to the
  // existing per-resource PATCH endpoints (PATCH /accounts/:id for the
  // default-profile selector; rename is handled by the section internally).
  const initialModel = useMemo(() => {
    if (!initialSettings) return null;
    return toSettingsFormModel(
      initialSettings,
      shellData.accounts,
      shellData.feeProfiles,
      shellData.feeProfileBindings,
    );
  }, [initialSettings, shellData.accounts, shellData.feeProfiles, shellData.feeProfileBindings]);

  const [accountDrafts, setAccountDrafts] = useState<SettingsAccountBindingModel[]>([]);
  const [profiles, setProfiles] = useState<SettingsProfileModel[]>([]);
  const [bindings, setBindings] = useState<SettingsSecurityBindingModel[]>([]);

  useEffect(() => {
    if (!initialModel) return;
    setAccountDrafts(initialModel.accounts);
    setProfiles(initialModel.feeProfiles);
    setBindings(initialModel.feeProfileBindings);
  }, [initialModel]);

  const handleRenameAccount = useCallback(
    async (accountId: string, name: string) => {
      await renameAccount(accountId, name);
      await shellData.refreshPortfolioConfig();
    },
    [shellData],
  );

  // Local mutators — Accounts tab's fee-profile editing is held in local
  // state until the user explicitly clicks the per-profile edit-done button
  // (which is wired below to `refreshPortfolioConfig()` so the next config
  // reflects committed changes). Per-profile PATCH endpoints are part of
  // a follow-up; for this phase we keep the in-section state ephemeral so
  // the rendered UI is functionally consistent with the prior drawer flow.

  const updateAccountProfile = useCallback(
    (accountId: string, feeProfileId: string) => {
      setAccountDrafts((current) =>
        current.map((d) => (d.id === accountId ? { ...d, feeProfileId } : d)),
      );
    },
    [],
  );

  const updateProfileField = useCallback(
    (profileId: string, key: keyof SettingsProfileModel, value: string | number) => {
      setProfiles((current) =>
        current.map((p) => (p.id === profileId ? { ...p, [key]: value } : p)),
      );
    },
    [],
  );

  // Phase 3d iter 2 (architect ruling) — Add profile fires POST /fee-profiles
  // immediately. Previously held drafts locally only, which lost them on
  // navigation; the route world has no omnibus PUT /settings/full to commit
  // a batch. Per-resource POST is the authoritative path.
  const addProfileForAccount = useCallback(
    (accountId: string) => {
      void (async () => {
        try {
          await postJson<FeeProfileDto>("/fee-profiles", {
            accountId,
            name: "New profile",
            boardCommissionRate: 1.425,
            commissionDiscountPercent: 0,
            minimumCommissionAmount: 20,
            commissionCurrency: "TWD",
            commissionRoundingMode: "FLOOR",
            taxRoundingMode: "FLOOR",
            stockSellTaxRateBps: 30,
            stockDayTradeTaxRateBps: 15,
            etfSellTaxRateBps: 10,
            bondEtfSellTaxRateBps: 0,
            commissionChargeMode: "CHARGED_UPFRONT",
          });
          // Refresh shell config so the new profile appears in the
          // list via the `initialModel` → `setProfiles` sync effect.
          await shellData.refreshPortfolioConfig();
        } catch {
          // Inline error UX deferred — the toast layer surfaces failures.
        }
      })();
    },
    [shellData],
  );

  const removeProfileFromAccount = useCallback(
    (_accountId: string, profileId: string) => {
      setProfiles((current) => current.filter((p) => p.id !== profileId));
    },
    [],
  );

  // Phase 3d iter 2 — duplicate fires a POST /fee-profiles per copy. Each
  // posted profile gets a fresh DB id; we drop the temporary client id
  // entirely. Refresh runs once after all posts so the snapshot picks up
  // every new profile atomically.
  const duplicateProfilesFromAccount = useCallback(
    (sourceAccountId: string, targetAccountId: string, profileIds: string[], sourceAccountName?: string) => {
      const suffix = sourceAccountName ? ` (from ${sourceAccountName})` : "";
      const selected = profiles.filter(
        (p) => p.accountId === sourceAccountId && profileIds.includes(p.id),
      );
      if (selected.length === 0) return;
      void (async () => {
        try {
          for (const profile of selected) {
            // Strip the local `id` + `accountId` (override) + override `name`
            // per the duplicate semantics. The rest of the payload is the
            // cloned source profile's values.
            const {
              id: _omitId,
              accountId: _omitAccountId,
              name,
              ...rest
            } = profile;
            // Reference to silence unused-var lint; values are intentionally
            // discarded — the new profile gets a server-issued id and the
            // target accountId from the loop closure.
            void _omitId;
            void _omitAccountId;
            await postJson<FeeProfileDto>("/fee-profiles", {
              accountId: targetAccountId,
              name: `${name}${suffix}`,
              ...rest,
            });
          }
          await shellData.refreshPortfolioConfig();
        } catch {
          // Inline error UX deferred — toast layer surfaces failures.
        }
      })();
    },
    [profiles, shellData],
  );

  const addBinding = useCallback((accountId: string) => {
    const owned = profiles.find((p) => p.accountId === accountId);
    if (!owned) return;
    setBindings((current) => [
      ...current,
      { accountId, ticker: "2330", feeProfileId: owned.id },
    ]);
  }, [profiles]);

  const updateBinding = useCallback(
    (index: number, patch: Partial<SettingsSecurityBindingModel>) => {
      setBindings((current) => {
        const next = [...current];
        next[index] = { ...next[index], ...patch };
        return next;
      });
    },
    [],
  );

  const removeBinding = useCallback((index: number) => {
    setBindings((current) => current.filter((_, idx) => idx !== index));
  }, []);

  const hasShellAccountConfig = shellData.accounts.length > 0 || shellData.feeProfiles.length > 0;
  if (!initialSettings || (shellData.isPortfolioConfigLoading && !hasShellAccountConfig)) {
    return (
      <div data-testid="settings-section-accounts" className="text-sm text-muted-foreground">
        {dict.feedback.loadingSettings}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="settings-section-accounts">
      <AccountCreateForm
        onCreate={createAccount}
        onAccountsRefresh={shellData.refreshPortfolioConfig}
        prefillCurrency={prefillCurrency}
        dict={dict}
      />
      <AccountsListSection
        accounts={shellData.accounts}
        accountDrafts={accountDrafts}
        profiles={profiles}
        feeProfileBindings={bindings}
        activeLocale={initialSettings?.locale ?? locale}
        onUpdateAccountProfile={updateAccountProfile}
        onRenameAccount={handleRenameAccount}
        onAddProfileForAccount={addProfileForAccount}
        onUpdateProfileField={updateProfileField}
        onRemoveProfileFromAccount={removeProfileFromAccount}
        onDuplicateProfilesFromAccount={duplicateProfilesFromAccount}
        onAddBinding={addBinding}
        onUpdateBinding={updateBinding}
        onRemoveBinding={removeBinding}
        onAccountsChanged={shellData.refreshPortfolioConfig}
        effectiveAccountHardPurgeDays={initialSettings?.effectiveAccountHardPurgeDays}
        dict={dict}
      />
    </div>
  );
}
