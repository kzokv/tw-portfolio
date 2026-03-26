import type { DividendEvent, Store } from "../types/store.js";

export function listDividendEvents(store: Store): DividendEvent[] {
  return store.marketData.dividendEvents;
}

export function upsertDividendEvent(store: Store, dividendEvent: DividendEvent): void {
  store.marketData.dividendEvents = [
    ...store.marketData.dividendEvents.filter((entry) => entry.id !== dividendEvent.id),
    dividendEvent,
  ].sort((left, right) => left.exDividendDate.localeCompare(right.exDividendDate) || left.id.localeCompare(right.id));
}
