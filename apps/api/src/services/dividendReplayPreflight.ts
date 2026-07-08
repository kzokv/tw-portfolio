import { MemoryPersistence } from "../persistence/memory.js";
import type { Store } from "../types/store.js";
import type { PreparedDividendUpdate } from "./dividends.js";
import { resolveDividendEventMarketCode, resolveDividendPostingDate } from "./dividends.js";
import { replayPositionHistory } from "./replayPositionHistory.js";

export interface DividendUpdateReplayScope {
  accountId: string;
  ticker: string;
  marketCode: string;
  actionDate: string;
}

export function getDividendUpdateReplayScope(prepared: PreparedDividendUpdate): DividendUpdateReplayScope | null {
  const { dividendEvent, dividendLedgerEntry, positionAction } = prepared.response;
  const touchesPositionActions = prepared.persistenceInput.positionActions.length > 0
    || (prepared.persistenceInput.replacePositionActionsForDividendLedgerEntryIds?.length ?? 0) > 0;

  if (!positionAction && dividendEvent.eventType === "CASH" && !touchesPositionActions) {
    return null;
  }

  return {
    accountId: dividendLedgerEntry.accountId,
    ticker: dividendEvent.ticker,
    marketCode: positionAction?.marketCode ?? resolveDividendEventMarketCode(dividendEvent),
    actionDate: positionAction?.actionDate ?? resolveDividendPostingDate(dividendEvent.paymentDate, dividendLedgerEntry.bookedAt),
  };
}

export async function assertDividendUpdateReplayCanApply(store: Store, userId: string, prepared: PreparedDividendUpdate): Promise<DividendUpdateReplayScope | null> {
  const replayScope = getDividendUpdateReplayScope(prepared);
  if (!replayScope) return null;

  await assertPositionReplayCanApply(store, userId, replayScope);

  return replayScope;
}

export async function assertPositionReplayCanApply(
  store: Store,
  userId: string,
  scope: Pick<DividendUpdateReplayScope, "accountId" | "ticker" | "marketCode">,
): Promise<void> {
  const preflightPersistence = new MemoryPersistence();
  await preflightPersistence.init();
  await preflightPersistence.saveStore(structuredClone(store));
  await replayPositionHistory(preflightPersistence, userId, scope.accountId, scope.ticker, {
    marketCode: scope.marketCode,
  });
}
