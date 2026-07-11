import type { DividendDailyHighlightItemDto } from "@vakwen/shared-types";
import type { LocaleCode } from "@vakwen/shared-types";
import { formatDateLabel } from "../../lib/utils";

export type DividendDailyHighlightRow = DividendDailyHighlightItemDto & {
  marketDateLabel: string;
};

export function mapDividendDailyHighlightItem(
  item: DividendDailyHighlightItemDto,
  locale: LocaleCode,
): DividendDailyHighlightRow {
  return {
    ...item,
    marketDateLabel: `${item.marketCode} · ${formatDateLabel(item.applicableLocalDate, locale)}`,
  };
}
