import { randomUUID } from "node:crypto";
import type { Persistence } from "../persistence/types.js";
import { rebuildHoldingProjection } from "./accountingStore.js";
import { createTransaction } from "./portfolio.js";
import { ensureSymbolDefinition } from "./symbolRegistry.js";

interface DemoTransaction {
  accountId: string;
  symbol: string;
  type: "BUY" | "SELL";
  quantity: number;
  unitPrice: number;
  tradeDate: string;
}

function buildDemoTransactions(accountId: string): DemoTransaction[] {
  return [
    { accountId, symbol: "2330", type: "BUY", quantity: 2, unitPrice: 98000, tradeDate: "2026-01-15" },
    { accountId, symbol: "2330", type: "BUY", quantity: 1, unitPrice: 99500, tradeDate: "2026-01-22" },
    { accountId, symbol: "2317", type: "BUY", quantity: 5, unitPrice: 18200, tradeDate: "2026-01-16" },
    { accountId, symbol: "2454", type: "BUY", quantity: 1, unitPrice: 126000, tradeDate: "2026-01-17" },
    { accountId, symbol: "2454", type: "BUY", quantity: 1, unitPrice: 128500, tradeDate: "2026-02-05" },
    { accountId, symbol: "2881", type: "BUY", quantity: 10, unitPrice: 7850, tradeDate: "2026-01-20" },
    { accountId, symbol: "0050", type: "BUY", quantity: 3, unitPrice: 18500, tradeDate: "2026-01-21" },
    { accountId, symbol: "0050", type: "BUY", quantity: 2, unitPrice: 18900, tradeDate: "2026-02-10" },
    { accountId, symbol: "2330", type: "SELL", quantity: 1, unitPrice: 101000, tradeDate: "2026-02-15" },
    { accountId, symbol: "2317", type: "SELL", quantity: 2, unitPrice: 19100, tradeDate: "2026-02-20" },
    { accountId, symbol: "2881", type: "BUY", quantity: 5, unitPrice: 8050, tradeDate: "2026-02-25" },
    { accountId, symbol: "0050", type: "BUY", quantity: 1, unitPrice: 19200, tradeDate: "2026-03-01" },
  ];
}

export async function seedDemoTransactions(persistence: Persistence, userId: string): Promise<void> {
  const store = await persistence.loadStore(userId);
  if (store.accounting.facts.tradeEvents.length > 0) return;

  const accountId = store.accounts[0]?.id;
  if (!accountId) return;

  const transactions = buildDemoTransactions(accountId);

  // Process each trade through the full booking pipeline so that lots,
  // cash ledger entries, and holding projections are populated — not just
  // raw trade events. Without this, the portfolio page shows empty holdings.
  for (const tx of transactions) {
    ensureSymbolDefinition(store, tx.symbol);
    createTransaction(store, userId, {
      id: `demo-tx-${randomUUID()}`,
      accountId: tx.accountId,
      symbol: tx.symbol,
      type: tx.type,
      quantity: tx.quantity,
      unitPrice: tx.unitPrice,
      priceCurrency: "TWD",
      tradeDate: tx.tradeDate,
      isDayTrade: false,
    });
  }

  rebuildHoldingProjection(store);
  await persistence.saveStore(store);
}
