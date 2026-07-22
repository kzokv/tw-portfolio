import { roundToDecimal } from "@vakwen/domain";
import type { SellAvailabilityDto, SellAvailabilityQueryDto } from "@vakwen/shared-types";
import { routeError } from "../lib/routeError.js";
import { listPositionActions, listTradeEvents } from "./accountingStore.js";
import { assertTradeMarketMatchesAccount } from "./portfolio.js";
import { buildReplayLotsBeforeBoundary } from "./replayPositionHistory.js";
import type { Store } from "../types/store.js";

export function resolveSellAvailability(
  store: Store,
  userId: string,
  input: SellAvailabilityQueryDto,
): SellAvailabilityDto {
  const account = store.accounts.find((item) => item.id === input.accountId && item.userId === userId);
  if (!account) {
    throw routeError(404, "account_not_found", "Account not found");
  }
  assertTradeMarketMatchesAccount(account, input.marketCode);
  const tradeTimestamp = input.tradeTimestamp
    ?? new Date(`${input.tradeDate}T00:00:00.000Z`).toISOString();

  try {
    const lots = buildReplayLotsBeforeBoundary(
      listTradeEvents(store).filter((trade) =>
        trade.userId === userId
        && trade.accountId === input.accountId
        && trade.ticker === input.ticker
        && trade.marketCode === input.marketCode),
      listPositionActions(store).filter((action) =>
        action.accountId === input.accountId
        && action.ticker === input.ticker
        && action.marketCode === input.marketCode),
      {
        tradeDate: input.tradeDate,
        tradeTimestamp,
        bookingSequence: input.bookingSequence,
      },
    );

    return {
      status: "ready",
      accountId: input.accountId,
      ticker: input.ticker,
      marketCode: input.marketCode,
      tradeDate: input.tradeDate,
      tradeTimestamp,
      bookingSequence: input.bookingSequence,
      availableQuantity: roundToDecimal(
        lots.filter((lot) => lot.openQuantity > 0).reduce((sum, lot) => sum + lot.openQuantity, 0),
        6,
      ),
    };
  } catch {
    return {
      status: "unavailable",
      accountId: input.accountId,
      ticker: input.ticker,
      marketCode: input.marketCode,
      tradeDate: input.tradeDate,
      tradeTimestamp,
      bookingSequence: input.bookingSequence,
      reason: "unreplayable_history",
    };
  }
}
