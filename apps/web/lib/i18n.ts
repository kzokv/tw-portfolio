import type { LocaleCode } from "@tw-portfolio/shared-types";
import { cashLedgerI18n } from "../features/cash-ledger/i18n";
import { dashboardI18n } from "../features/dashboard/i18n";
import { dividendsI18n } from "../features/dividends/i18n";
import { notificationsI18n } from "../features/notifications/i18n";
import { portfolioI18n } from "../features/portfolio/i18n";
import { sharingI18n } from "../features/sharing/i18n";
import { settingsI18n } from "../features/settings/i18n";
import { commonI18n } from "./i18n/common";
import type { AppDictionary } from "./i18n/types";

export type { AppDictionary } from "./i18n/types";
export { formatRecomputeMessage } from "../features/portfolio/i18n";

export function getDictionary(locale: LocaleCode): AppDictionary {
  const localeKey = locale === "zh-TW" ? "zh-TW" : "en";

  return {
    ...commonI18n[localeKey],
    ...cashLedgerI18n[localeKey],
    ...dashboardI18n[localeKey],
    ...dividendsI18n[localeKey],
    ...notificationsI18n[localeKey],
    ...settingsI18n[localeKey],
    ...portfolioI18n[localeKey],
    ...sharingI18n[localeKey],
    tooltips: {
      ...dashboardI18n[localeKey].tooltips,
      ...settingsI18n[localeKey].tooltips,
      ...portfolioI18n[localeKey].tooltips,
    },
  };
}
