import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { createClient, type RedisClientType } from "redis";
import type { FeeProfile } from "@tw-portfolio/domain";
import type { Quote } from "../providers/marketData.js";
import {
  buildAccountingPolicy,
  deriveRealizedPnlForTrade,
  rebuildHoldingProjection,
  syncTradeEventRealizedPnl,
} from "../services/accountingStore.js";
import type {
  AccountingStore,
  CashLedgerEntry,
  DailyPortfolioSnapshot,
  LotAllocationProjection,
  RecomputeJob,
  RecomputePreviewItem,
  Store,
  Transaction,
} from "../types/store.js";
import type { Persistence, ReadinessStatus } from "./types.js";

export interface PostgresPersistenceOptions {
  databaseUrl: string;
  redisUrl: string;
}

export class PostgresPersistence implements Persistence {
  private readonly pool: Pool;
  private readonly redis: RedisClientType;

  constructor(private readonly options: PostgresPersistenceOptions) {
    this.pool = new Pool({ connectionString: options.databaseUrl });
    this.redis = createClient({ url: options.redisUrl });
  }

  async init(): Promise<void> {
    if (!this.redis.isOpen) await this.redis.connect();
    await this.runMigrations();
    await this.seedDefaults();
  }

  async close(): Promise<void> {
    if (this.redis.isOpen) await this.redis.quit();
    await this.pool.end();
  }

  async loadStore(userId: string): Promise<Store> {
    await this.ensureUserSeed(userId);
    const userResult = await this.pool.query(
      `SELECT id, locale, cost_basis_method, quote_poll_interval_seconds
       FROM users
       WHERE id = $1`,
      [userId],
    );

    const accountsResult = await this.pool.query(
      `SELECT id, user_id, name, fee_profile_id
       FROM accounts
       WHERE user_id = $1
       ORDER BY id`,
      [userId],
    );

    const feeProfilesResult = await this.pool.query(
      `SELECT id, name, commission_rate_bps, commission_discount_bps, min_commission_ntd,
              commission_rounding_mode, tax_rounding_mode,
              stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps,
              etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps
       FROM fee_profiles
       WHERE user_id = $1
       ORDER BY id`,
      [userId],
    );

    const tradeEventsResult = await this.pool.query(
      `SELECT id, user_id, account_id, symbol, instrument_type, trade_type, quantity,
              price_ntd, trade_date, trade_timestamp, booking_sequence, commission_ntd, tax_ntd,
              is_day_trade, fee_snapshot_json, source_type, source_reference, booked_at,
              reversal_of_trade_event_id
       FROM trade_events
       WHERE user_id = $1
       ORDER BY trade_date, booking_sequence, trade_timestamp, booked_at, id`,
      [userId],
    );

    const accountIds = accountsResult.rows.map((row) => row.id);
    const bindingsResult = accountIds.length
      ? await this.pool.query(
          `SELECT account_id, symbol, fee_profile_id
           FROM account_fee_profile_overrides
           WHERE account_id = ANY($1)
           ORDER BY account_id, symbol`,
          [accountIds],
        )
      : { rows: [] };

    const lotsResult = accountIds.length
      ? await this.pool.query(
          `SELECT id, account_id, symbol, open_quantity, total_cost_ntd, opened_at, opened_sequence
           FROM lots
           WHERE account_id = ANY($1)
           ORDER BY opened_at, opened_sequence, id`,
          [accountIds],
        )
      : { rows: [] };

    const lotAllocationsResult = await this.pool.query(
      `SELECT id, user_id, account_id, trade_event_id, symbol, lot_id, lot_opened_at,
              lot_opened_sequence, allocated_quantity, allocated_cost_ntd, created_at
       FROM lot_allocations
       WHERE user_id = $1
       ORDER BY trade_event_id, lot_opened_at, lot_opened_sequence, lot_id`,
      [userId],
    );

    const actionsResult = accountIds.length
      ? await this.pool.query(
          `SELECT id, account_id, symbol, action_type, numerator, denominator, action_date
           FROM corporate_actions
           WHERE account_id = ANY($1)
           ORDER BY action_date, id`,
          [accountIds],
        )
      : { rows: [] };

    const jobsResult = await this.pool.query(
      `SELECT id, user_id, account_id, profile_id, status, created_at
       FROM recompute_jobs
       WHERE user_id = $1
       ORDER BY created_at, id`,
      [userId],
    );

    const cashLedgerResult = await this.pool.query(
      `SELECT id, user_id, account_id, entry_date, entry_type, amount_ntd, currency,
              related_trade_event_id, related_dividend_ledger_entry_id, source_type,
              source_reference, note, booked_at, reversal_of_cash_ledger_entry_id
       FROM cash_ledger_entries
       WHERE user_id = $1
       ORDER BY entry_date, booked_at, id`,
      [userId],
    );

    const snapshotsResult = await this.pool.query(
      `SELECT id, snapshot_date, total_market_value_ntd, total_cost_ntd,
              total_unrealized_pnl_ntd, total_realized_pnl_ntd, total_dividend_received_ntd,
              total_cash_balance_ntd, total_nav_ntd, generated_at, generation_run_id
       FROM daily_portfolio_snapshots
       WHERE user_id = $1
       ORDER BY snapshot_date DESC, generated_at DESC, id DESC`,
      [userId],
    );

    const jobIds = jobsResult.rows.map((row) => row.id);
    const jobItemsResult = jobIds.length
      ? await this.pool.query(
          `SELECT id, job_id, transaction_id, previous_commission_ntd, previous_tax_ntd,
                  next_commission_ntd, next_tax_ntd
           FROM recompute_job_items
           WHERE job_id = ANY($1)
           ORDER BY id`,
          [jobIds],
        )
      : { rows: [] };

    const symbolsResult = await this.pool.query(
      `SELECT ticker, instrument_type
       FROM symbols
       ORDER BY ticker`,
    );

    const feeProfiles: FeeProfile[] = feeProfilesResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      commissionRateBps: row.commission_rate_bps,
      commissionDiscountBps: row.commission_discount_bps,
      minCommissionNtd: row.min_commission_ntd,
      commissionRoundingMode: row.commission_rounding_mode,
      taxRoundingMode: row.tax_rounding_mode,
      stockSellTaxRateBps: row.stock_sell_tax_rate_bps,
      stockDayTradeTaxRateBps: row.stock_day_trade_tax_rate_bps,
      etfSellTaxRateBps: row.etf_sell_tax_rate_bps,
      bondEtfSellTaxRateBps: row.bond_etf_sell_tax_rate_bps,
    }));

    const lotAllocations: LotAllocationProjection[] = lotAllocationsResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id,
      tradeEventId: row.trade_event_id,
      symbol: row.symbol,
      lotId: row.lot_id,
      lotOpenedAt: normalizeDate(row.lot_opened_at),
      lotOpenedSequence: row.lot_opened_sequence,
      allocatedQuantity: row.allocated_quantity,
      allocatedCostNtd: row.allocated_cost_ntd,
      createdAt: normalizeDateTime(row.created_at),
    }));

    const transactions: Transaction[] = tradeEventsResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id,
      symbol: row.symbol,
      instrumentType: row.instrument_type,
      type: row.trade_type,
      quantity: row.quantity,
      priceNtd: row.price_ntd,
      tradeDate: normalizeDate(row.trade_date),
      tradeTimestamp: normalizeDateTime(row.trade_timestamp),
      bookingSequence: row.booking_sequence,
      commissionNtd: row.commission_ntd,
      taxNtd: row.tax_ntd,
      isDayTrade: row.is_day_trade,
      feeSnapshot: JSON.parse(row.fee_snapshot_json),
      sourceType: row.source_type,
      sourceReference: row.source_reference ?? undefined,
      bookedAt: normalizeDateTime(row.booked_at),
      reversalOfTradeEventId: row.reversal_of_trade_event_id ?? undefined,
    }));

    const cashLedgerEntries: CashLedgerEntry[] = cashLedgerResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id,
      entryDate: normalizeDate(row.entry_date),
      entryType: row.entry_type,
      amountNtd: row.amount_ntd,
      currency: row.currency,
      relatedTradeEventId: row.related_trade_event_id ?? undefined,
      relatedDividendLedgerEntryId: row.related_dividend_ledger_entry_id ?? undefined,
      sourceType: row.source_type,
      sourceReference: row.source_reference ?? undefined,
      note: row.note ?? undefined,
      reversalOfCashLedgerEntryId: row.reversal_of_cash_ledger_entry_id ?? undefined,
      bookedAt: normalizeDateTime(row.booked_at),
    }));

    const snapshots: DailyPortfolioSnapshot[] = snapshotsResult.rows.map((row) => ({
      id: row.id,
      snapshotDate: normalizeDate(row.snapshot_date),
      totalMarketValueNtd: row.total_market_value_ntd,
      totalCostNtd: row.total_cost_ntd,
      totalUnrealizedPnlNtd: row.total_unrealized_pnl_ntd,
      totalRealizedPnlNtd: row.total_realized_pnl_ntd,
      totalDividendReceivedNtd: row.total_dividend_received_ntd,
      totalCashBalanceNtd: row.total_cash_balance_ntd,
      totalNavNtd: row.total_nav_ntd,
      generatedAt: normalizeDateTime(row.generated_at),
      generationRunId: row.generation_run_id,
    }));

    const recomputeItems = new Map<string, RecomputePreviewItem[]>();
    for (const item of jobItemsResult.rows) {
      const list = recomputeItems.get(item.job_id) ?? [];
      list.push({
        transactionId: item.transaction_id,
        previousCommissionNtd: item.previous_commission_ntd,
        previousTaxNtd: item.previous_tax_ntd,
        nextCommissionNtd: item.next_commission_ntd,
        nextTaxNtd: item.next_tax_ntd,
      });
      recomputeItems.set(item.job_id, list);
    }

    const recomputeJobs: RecomputeJob[] = jobsResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id ?? undefined,
      profileId: row.profile_id,
      status: row.status,
      createdAt: normalizeDateTime(row.created_at),
      items: recomputeItems.get(row.id) ?? [],
    }));

    const store: Store = {
      userId,
      settings: {
        userId,
        locale: userResult.rows[0].locale,
        costBasisMethod: userResult.rows[0].cost_basis_method,
        quotePollIntervalSeconds: userResult.rows[0].quote_poll_interval_seconds,
      },
      accounts: accountsResult.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        name: row.name,
        feeProfileId: row.fee_profile_id,
      })),
      feeProfileBindings: bindingsResult.rows.map((row) => ({
        accountId: row.account_id,
        symbol: row.symbol,
        feeProfileId: row.fee_profile_id,
      })),
      feeProfiles,
      accounting: {
        facts: {
          tradeEvents: transactions,
          cashLedgerEntries,
          corporateActions: actionsResult.rows.map((row) => ({
            id: row.id,
            accountId: row.account_id,
            symbol: row.symbol,
            actionType: row.action_type,
            numerator: row.numerator,
            denominator: row.denominator,
            actionDate: normalizeDate(row.action_date),
          })),
        },
        projections: {
          lots: lotsResult.rows.map((row) => ({
            id: row.id,
            accountId: row.account_id,
            symbol: row.symbol,
            openQuantity: row.open_quantity,
            totalCostNtd: row.total_cost_ntd,
            openedAt: normalizeDate(row.opened_at),
            openedSequence: row.opened_sequence,
          })),
          lotAllocations,
          holdings: [],
          dailyPortfolioSnapshots: snapshots,
        },
        policy: buildAccountingPolicy(),
      },
      symbols: symbolsResult.rows.map((row) => ({
        ticker: row.ticker,
        type: row.instrument_type,
      })),
      recomputeJobs,
      idempotencyKeys: new Set<string>(),
    };
    syncTradeEventRealizedPnl(store.accounting);
    rebuildHoldingProjection(store);
    return store;
  }

  async loadAccountingStore(userId: string): Promise<AccountingStore> {
    const store = await this.loadStore(userId);
    return store.accounting;
  }

  async saveStore(store: Store): Promise<void> {
    validateStoreInvariants(store);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE users
         SET locale = $2,
             cost_basis_method = $3,
             quote_poll_interval_seconds = $4
         WHERE id = $1`,
        [
          store.userId,
          store.settings.locale,
          store.settings.costBasisMethod,
          store.settings.quotePollIntervalSeconds,
        ],
      );

      const feeProfileIds = store.feeProfiles.map((item) => item.id);

      for (const profile of store.feeProfiles) {
        const upsertProfile = await client.query(
          `INSERT INTO fee_profiles (
             id, user_id, name, commission_rate_bps, commission_discount_bps,
             min_commission_ntd, commission_rounding_mode, tax_rounding_mode,
             stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps,
             bond_etf_sell_tax_rate_bps
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8,
             $9, $10, $11,
             $12
           )
           ON CONFLICT (id)
           DO UPDATE SET
             name = EXCLUDED.name,
             commission_rate_bps = EXCLUDED.commission_rate_bps,
             commission_discount_bps = EXCLUDED.commission_discount_bps,
             min_commission_ntd = EXCLUDED.min_commission_ntd,
             commission_rounding_mode = EXCLUDED.commission_rounding_mode,
             tax_rounding_mode = EXCLUDED.tax_rounding_mode,
             stock_sell_tax_rate_bps = EXCLUDED.stock_sell_tax_rate_bps,
             stock_day_trade_tax_rate_bps = EXCLUDED.stock_day_trade_tax_rate_bps,
             etf_sell_tax_rate_bps = EXCLUDED.etf_sell_tax_rate_bps,
             bond_etf_sell_tax_rate_bps = EXCLUDED.bond_etf_sell_tax_rate_bps
           WHERE fee_profiles.user_id = EXCLUDED.user_id`,
          [
            profile.id,
            store.userId,
            profile.name,
            profile.commissionRateBps,
            profile.commissionDiscountBps,
            profile.minCommissionNtd,
            profile.commissionRoundingMode,
            profile.taxRoundingMode,
            profile.stockSellTaxRateBps,
            profile.stockDayTradeTaxRateBps,
            profile.etfSellTaxRateBps,
            profile.bondEtfSellTaxRateBps,
          ],
        );

        if (upsertProfile.rowCount !== 1) {
          throw new Error(`Fee profile id conflict for id=${profile.id}`);
        }
      }

      const accountIds = store.accounts.map((item) => item.id);
      if (accountIds.length) {
        await client.query(
          `DELETE FROM accounts
           WHERE user_id = $1
             AND id <> ALL($2)`,
          [store.userId, accountIds],
        );
      }

      for (const account of store.accounts) {
        const upsertAccount = await client.query(
          `INSERT INTO accounts (id, user_id, name, fee_profile_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id)
           DO UPDATE SET
             name = EXCLUDED.name,
             fee_profile_id = EXCLUDED.fee_profile_id
           WHERE accounts.user_id = EXCLUDED.user_id`,
          [account.id, account.userId, account.name, account.feeProfileId],
        );

        if (upsertAccount.rowCount !== 1) {
          throw new Error(`Account id conflict for id=${account.id}`);
        }
      }

      if (accountIds.length) {
        await client.query(`DELETE FROM account_fee_profile_overrides WHERE account_id = ANY($1)`, [accountIds]);
        for (const binding of store.feeProfileBindings) {
          await client.query(
            `INSERT INTO account_fee_profile_overrides (account_id, symbol, fee_profile_id)
             VALUES ($1, $2, $3)`,
            [binding.accountId, binding.symbol, binding.feeProfileId],
          );
        }
      }

      await client.query(
        `DELETE FROM recompute_job_items
         WHERE job_id IN (
           SELECT id FROM recompute_jobs WHERE user_id = $1
         )`,
        [store.userId],
      );
      await client.query(`DELETE FROM recompute_jobs WHERE user_id = $1`, [store.userId]);
      await this.saveAccountingStoreTx(client, store.userId, store.accounting, accountIds);

      if (feeProfileIds.length) {
        await client.query(
          `DELETE FROM fee_profiles
           WHERE user_id = $1
             AND id <> ALL($2)`,
          [store.userId, feeProfileIds],
        );
      } else {
        await client.query(`DELETE FROM fee_profiles WHERE user_id = $1`, [store.userId]);
      }

      if (accountIds.length) {
        await client.query(`DELETE FROM lots WHERE account_id = ANY($1)`, [accountIds]);
        for (const lot of store.accounting.projections.lots) {
          await client.query(
            `INSERT INTO lots (id, account_id, symbol, open_quantity, total_cost_ntd, opened_at, opened_sequence)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [lot.id, lot.accountId, lot.symbol, lot.openQuantity, lot.totalCostNtd, lot.openedAt, lot.openedSequence ?? 1],
          );
        }

        await client.query(`DELETE FROM corporate_actions WHERE account_id = ANY($1)`, [accountIds]);
        for (const action of store.accounting.facts.corporateActions) {
          await client.query(
            `INSERT INTO corporate_actions (
               id, account_id, symbol, action_type, numerator, denominator, action_date
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              action.id,
              action.accountId,
              action.symbol,
              action.actionType,
              action.numerator,
              action.denominator,
              action.actionDate,
            ],
          );
        }
      }

      for (const job of store.recomputeJobs) {
        await client.query(
          `INSERT INTO recompute_jobs (id, user_id, account_id, profile_id, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [job.id, job.userId, job.accountId ?? null, job.profileId, job.status, job.createdAt],
        );

        for (const item of job.items) {
          await client.query(
            `INSERT INTO recompute_job_items (
               id, job_id, transaction_id, previous_commission_ntd, previous_tax_ntd,
               next_commission_ntd, next_tax_ntd
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              `${job.id}:${item.transactionId}`,
              job.id,
              item.transactionId,
              item.previousCommissionNtd,
              item.previousTaxNtd,
              item.nextCommissionNtd,
              item.nextTaxNtd,
            ],
          );
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async claimIdempotencyKey(userId: string, key: string): Promise<boolean> {
    const redisKey = `idempotency:${userId}:${key}`;
    const result = await this.redis.set(redisKey, "1", { EX: 86_400, NX: true });
    return result === "OK";
  }

  async releaseIdempotencyKey(userId: string, key: string): Promise<void> {
    await this.redis.del(`idempotency:${userId}:${key}`);
  }

  async getCachedQuotes(symbols: string[]): Promise<Record<string, Quote>> {
    if (symbols.length === 0) return {};
    const keys = symbols.map((symbol) => `quote:${symbol}`);
    const values = await this.redis.mGet(keys);
    const found: Record<string, Quote> = {};

    values.forEach((raw: string | null, index: number) => {
      if (!raw) return;
      found[symbols[index]] = JSON.parse(raw) as Quote;
    });

    return found;
  }

  async cacheQuotes(quotes: Quote[]): Promise<void> {
    if (quotes.length === 0) return;
    const pipeline = this.redis.multi();
    for (const quote of quotes) {
      pipeline.set(`quote:${quote.symbol}`, JSON.stringify(quote), { EX: 30 });
    }
    await pipeline.exec();
  }

  async readiness(): Promise<ReadinessStatus> {
    const status: ReadinessStatus = {
      backend: "postgres",
      postgres: false,
      redis: false,
    };

    try {
      await this.pool.query("SELECT 1");
      status.postgres = true;
    } catch {
      status.postgres = false;
    }

    try {
      if (!this.redis.isOpen) await this.redis.connect();
      await this.redis.ping();
      status.redis = true;
    } catch {
      status.redis = false;
    }

    return status;
  }

  async saveAccountingStore(userId: string, accounting: AccountingStore): Promise<void> {
    validateAccountingStoreInvariants(accounting);
    await this.ensureUserSeed(userId);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const accountIds = await this.listUserAccountIds(client, userId);
      await this.saveAccountingStoreTx(client, userId, accounting, accountIds);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async savePostedTrade(userId: string, accounting: AccountingStore, tradeEventId: string): Promise<void> {
    validateAccountingStoreInvariants(accounting);
    await this.ensureUserSeed(userId);

    const trade = accounting.facts.tradeEvents.find((item) => item.id === tradeEventId);
    if (!trade) {
      throw new Error(`trade event ${tradeEventId} not found in accounting store`);
    }

    const cashEntry = accounting.facts.cashLedgerEntries.find((entry) => entry.relatedTradeEventId === tradeEventId);
    if (!cashEntry) {
      throw new Error(`cash ledger entry for trade event ${tradeEventId} not found in accounting store`);
    }

    const nextAllocations = accounting.projections.lotAllocations.filter(
      (allocation) => allocation.tradeEventId === tradeEventId,
    );
    const nextLots = accounting.projections.lots.filter(
      (lot) => lot.accountId === trade.accountId && lot.symbol === trade.symbol,
    );
    const mirroredRealizedPnlNtd = deriveRealizedPnlForTrade(accounting, trade);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO trade_events (
           id, user_id, account_id, symbol, instrument_type, trade_type,
           quantity, price_ntd, trade_date, trade_timestamp, booking_sequence, commission_ntd,
           tax_ntd, is_day_trade, fee_snapshot_json, source_type, source_reference, booked_at,
           reversal_of_trade_event_id
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11, $12,
           $13, $14, $15, $16, $17, $18,
           $19
         )`,
        [
          trade.id,
          trade.userId,
          trade.accountId,
          trade.symbol,
          trade.instrumentType,
          trade.type,
          trade.quantity,
          trade.priceNtd,
          trade.tradeDate,
          trade.tradeTimestamp ?? trade.bookedAt ?? new Date(`${trade.tradeDate}T00:00:00.000Z`).toISOString(),
          trade.bookingSequence ?? 1,
          trade.commissionNtd,
          trade.taxNtd,
          trade.isDayTrade,
          JSON.stringify(trade.feeSnapshot),
          trade.sourceType ?? "legacy_transaction",
          trade.sourceReference ?? trade.id,
          trade.bookedAt ?? new Date(`${trade.tradeDate}T00:00:00.000Z`).toISOString(),
          trade.reversalOfTradeEventId ?? null,
        ],
      );

      await client.query(
        `INSERT INTO cash_ledger_entries (
           id, user_id, account_id, entry_date, entry_type, amount_ntd, currency,
           related_trade_event_id, related_dividend_ledger_entry_id, source_type,
           source_reference, note, booked_at, reversal_of_cash_ledger_entry_id
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10,
           $11, $12, $13, $14
         )`,
        [
          cashEntry.id,
          cashEntry.userId,
          cashEntry.accountId,
          cashEntry.entryDate,
          cashEntry.entryType,
          cashEntry.amountNtd,
          cashEntry.currency,
          cashEntry.relatedTradeEventId ?? null,
          cashEntry.relatedDividendLedgerEntryId ?? null,
          cashEntry.sourceType,
          cashEntry.sourceReference ?? null,
          cashEntry.note ?? null,
          cashEntry.bookedAt ?? new Date(`${cashEntry.entryDate}T00:00:00.000Z`).toISOString(),
          cashEntry.reversalOfCashLedgerEntryId ?? null,
        ],
      );

      await client.query(
        `INSERT INTO transactions (
           id, user_id, account_id, symbol, instrument_type, tx_type,
           quantity, price_ntd, trade_date, commission_ntd, tax_ntd,
           is_day_trade, fee_profile_id, fee_snapshot_json, realized_pnl_ntd
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11,
           $12, $13, $14, $15
         )`,
        [
          trade.id,
          trade.userId,
          trade.accountId,
          trade.symbol,
          trade.instrumentType,
          trade.type,
          trade.quantity,
          trade.priceNtd,
          trade.tradeDate,
          trade.commissionNtd,
          trade.taxNtd,
          trade.isDayTrade,
          trade.feeSnapshot.id,
          JSON.stringify(trade.feeSnapshot),
          mirroredRealizedPnlNtd ?? null,
        ],
      );

      await client.query(
        `DELETE FROM lot_allocations
         WHERE user_id = $1
           AND trade_event_id = $2`,
        [userId, tradeEventId],
      );
      for (const allocation of nextAllocations) {
        await client.query(
          `INSERT INTO lot_allocations (
             id, user_id, account_id, trade_event_id, symbol, lot_id, lot_opened_at,
             lot_opened_sequence, allocated_quantity, allocated_cost_ntd, created_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10, $11
           )`,
          [
            allocation.id,
            allocation.userId,
            allocation.accountId,
            allocation.tradeEventId,
            allocation.symbol,
            allocation.lotId,
            allocation.lotOpenedAt,
            allocation.lotOpenedSequence,
            allocation.allocatedQuantity,
            allocation.allocatedCostNtd,
            allocation.createdAt ?? new Date().toISOString(),
          ],
        );
      }

      await client.query(
        `DELETE FROM lots
         WHERE account_id = $1
           AND symbol = $2`,
        [trade.accountId, trade.symbol],
      );
      for (const lot of nextLots) {
        await client.query(
          `INSERT INTO lots (id, account_id, symbol, open_quantity, total_cost_ntd, opened_at, opened_sequence)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [lot.id, lot.accountId, lot.symbol, lot.openQuantity, lot.totalCostNtd, lot.openedAt, lot.openedSequence ?? 1],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async runMigrations(): Promise<void> {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
    const migrationFiles = (await fs.readdir(migrationsDir))
      .filter((file) => /^\d+_.*\.sql$/.test(file))
      .sort((a, b) => a.localeCompare(b));

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.ensureMigrationLedger(client);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["tw_portfolio_schema_migrations"]);

      const appliedResult = await client.query<{ name: string }>(
        "SELECT name FROM schema_migrations",
      );
      const applied = new Set(appliedResult.rows.map((row) => row.name));

      for (const file of migrationFiles) {
        if (applied.has(file)) continue;
        const migrationSql = await fs.readFile(path.join(migrationsDir, file), "utf8");
        await client.query(migrationSql);
        await client.query(
          "INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
          [file],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async ensureMigrationLedger(client: PoolClient): Promise<void> {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
    );
  }

  private async seedDefaults(): Promise<void> {
    await this.seedSymbols();
    await this.ensureUserSeed("user-1");
  }

  private async seedSymbols(): Promise<void> {
    await this.pool.query(
      `INSERT INTO symbols (ticker, instrument_type)
       VALUES
         ('2330', 'STOCK'),
         ('0050', 'ETF'),
         ('00679B', 'BOND_ETF')
       ON CONFLICT (ticker) DO UPDATE SET instrument_type = EXCLUDED.instrument_type`,
    );
  }

  private async ensureUserSeed(userId: string): Promise<void> {
    const feeProfileId = this.defaultFeeProfileId(userId);
    const accountId = this.defaultAccountId(userId);

    await this.pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
       VALUES ($1, $2, 'en', 'WEIGHTED_AVERAGE', 10)
       ON CONFLICT (id) DO NOTHING`,
      [userId, `${userId}@example.com`],
    );

    await this.pool.query(
      `INSERT INTO fee_profiles (
         id, user_id, name, commission_rate_bps, commission_discount_bps,
         min_commission_ntd, commission_rounding_mode, tax_rounding_mode,
         stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps,
         etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps
       ) VALUES (
         $1, $2, 'Default Broker', 14, 10000,
         20, 'FLOOR', 'FLOOR',
         30, 15,
         10, 0
       )
       ON CONFLICT (id) DO NOTHING`,
      [feeProfileId, userId],
    );

    await this.pool.query(
      `INSERT INTO accounts (id, user_id, name, fee_profile_id)
       VALUES ($1, $2, 'Main', $3)
       ON CONFLICT (id) DO NOTHING`,
      [accountId, userId, feeProfileId],
    );
  }

  private defaultFeeProfileId(userId: string): string {
    return `${userId}-fp-default`;
  }

  private defaultAccountId(userId: string): string {
    return `${userId}-acc-1`;
  }

  private async listUserAccountIds(client: PoolClient, userId: string): Promise<string[]> {
    const result = await client.query<{ id: string }>(
      `SELECT id
       FROM accounts
       WHERE user_id = $1
       ORDER BY id`,
      [userId],
    );
    return result.rows.map((row) => row.id);
  }

  private async saveAccountingStoreTx(
    client: PoolClient,
    userId: string,
    accounting: AccountingStore,
    accountIds: string[],
  ): Promise<void> {
    await client.query(`DELETE FROM cash_ledger_entries WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM lot_allocations WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM trade_events WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM daily_portfolio_snapshots WHERE user_id = $1`, [userId]);

    for (const tx of accounting.facts.tradeEvents) {
      await client.query(
        `INSERT INTO trade_events (
           id, user_id, account_id, symbol, instrument_type, trade_type,
           quantity, price_ntd, trade_date, trade_timestamp, booking_sequence, commission_ntd,
           tax_ntd, is_day_trade, fee_snapshot_json, source_type, source_reference, booked_at,
           reversal_of_trade_event_id
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11, $12,
           $13, $14, $15, $16, $17, $18,
           $19
         )`,
        [
          tx.id,
          tx.userId,
          tx.accountId,
          tx.symbol,
          tx.instrumentType,
          tx.type,
          tx.quantity,
          tx.priceNtd,
          tx.tradeDate,
          tx.tradeTimestamp ?? tx.bookedAt ?? new Date(`${tx.tradeDate}T00:00:00.000Z`).toISOString(),
          tx.bookingSequence ?? 1,
          tx.commissionNtd,
          tx.taxNtd,
          tx.isDayTrade,
          JSON.stringify(tx.feeSnapshot),
          tx.sourceType ?? "legacy_transaction",
          tx.sourceReference ?? tx.id,
          tx.bookedAt ?? new Date(`${tx.tradeDate}T00:00:00.000Z`).toISOString(),
          tx.reversalOfTradeEventId ?? null,
        ],
      );
    }

    for (const entry of accounting.facts.cashLedgerEntries) {
      await client.query(
        `INSERT INTO cash_ledger_entries (
           id, user_id, account_id, entry_date, entry_type, amount_ntd, currency,
           related_trade_event_id, related_dividend_ledger_entry_id, source_type,
           source_reference, note, booked_at, reversal_of_cash_ledger_entry_id
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10,
           $11, $12, $13, $14
         )`,
        [
          entry.id,
          entry.userId,
          entry.accountId,
          entry.entryDate,
          entry.entryType,
          entry.amountNtd,
          entry.currency,
          entry.relatedTradeEventId ?? null,
          entry.relatedDividendLedgerEntryId ?? null,
          entry.sourceType,
          entry.sourceReference ?? null,
          entry.note ?? null,
          entry.bookedAt ?? new Date(`${entry.entryDate}T00:00:00.000Z`).toISOString(),
          entry.reversalOfCashLedgerEntryId ?? null,
        ],
      );
    }

    for (const allocation of accounting.projections.lotAllocations) {
      await client.query(
        `INSERT INTO lot_allocations (
           id, user_id, account_id, trade_event_id, symbol, lot_id, lot_opened_at,
           lot_opened_sequence, allocated_quantity, allocated_cost_ntd, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11
         )`,
        [
          allocation.id,
          allocation.userId,
          allocation.accountId,
          allocation.tradeEventId,
          allocation.symbol,
          allocation.lotId,
          allocation.lotOpenedAt,
          allocation.lotOpenedSequence,
          allocation.allocatedQuantity,
          allocation.allocatedCostNtd,
          allocation.createdAt ?? new Date().toISOString(),
        ],
      );
    }

    for (const snapshot of accounting.projections.dailyPortfolioSnapshots) {
      await client.query(
        `INSERT INTO daily_portfolio_snapshots (
           id, user_id, snapshot_date, total_market_value_ntd, total_cost_ntd,
           total_unrealized_pnl_ntd, total_realized_pnl_ntd, total_dividend_received_ntd,
           total_cash_balance_ntd, total_nav_ntd, generated_at, generation_run_id
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8,
           $9, $10, $11, $12
         )`,
        [
          snapshot.id,
          userId,
          snapshot.snapshotDate,
          snapshot.totalMarketValueNtd,
          snapshot.totalCostNtd,
          snapshot.totalUnrealizedPnlNtd,
          snapshot.totalRealizedPnlNtd,
          snapshot.totalDividendReceivedNtd,
          snapshot.totalCashBalanceNtd,
          snapshot.totalNavNtd,
          snapshot.generatedAt,
          snapshot.generationRunId,
        ],
      );
    }

    await client.query(`DELETE FROM transactions WHERE user_id = $1`, [userId]);
    for (const tx of accounting.facts.tradeEvents) {
      const mirroredRealizedPnlNtd = deriveRealizedPnlForTrade(accounting, tx);
      await client.query(
        `INSERT INTO transactions (
           id, user_id, account_id, symbol, instrument_type, tx_type,
           quantity, price_ntd, trade_date, commission_ntd, tax_ntd,
           is_day_trade, fee_profile_id, fee_snapshot_json, realized_pnl_ntd
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11,
           $12, $13, $14, $15
         )`,
        [
          tx.id,
          tx.userId,
          tx.accountId,
          tx.symbol,
          tx.instrumentType,
          tx.type,
          tx.quantity,
          tx.priceNtd,
          tx.tradeDate,
          tx.commissionNtd,
          tx.taxNtd,
          tx.isDayTrade,
          tx.feeSnapshot.id,
          JSON.stringify(tx.feeSnapshot),
          mirroredRealizedPnlNtd ?? null,
        ],
      );
    }

    if (accountIds.length) {
      await client.query(`DELETE FROM lots WHERE account_id = ANY($1)`, [accountIds]);
      for (const lot of accounting.projections.lots) {
        await client.query(
          `INSERT INTO lots (id, account_id, symbol, open_quantity, total_cost_ntd, opened_at, opened_sequence)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [lot.id, lot.accountId, lot.symbol, lot.openQuantity, lot.totalCostNtd, lot.openedAt, lot.openedSequence ?? 1],
        );
      }

      await client.query(`DELETE FROM corporate_actions WHERE account_id = ANY($1)`, [accountIds]);
      for (const action of accounting.facts.corporateActions) {
        await client.query(
          `INSERT INTO corporate_actions (
             id, account_id, symbol, action_type, numerator, denominator, action_date
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            action.id,
            action.accountId,
            action.symbol,
            action.actionType,
            action.numerator,
            action.denominator,
            action.actionDate,
          ],
        );
      }
    }
  }
}

function validateStoreInvariants(store: Store): void {
  if (!store.userId) {
    throw new Error("store user id is required");
  }

  validateAccountingStoreInvariants(store.accounting);

  const profilesById = new Set(store.feeProfiles.map((profile) => profile.id));
  if (profilesById.size === 0) {
    throw new Error("at least one fee profile is required");
  }

  for (const account of store.accounts) {
    if (account.userId !== store.userId) {
      throw new Error(`account ${account.id} belongs to unexpected user`);
    }

    if (!profilesById.has(account.feeProfileId)) {
      throw new Error(`account ${account.id} references missing fee profile ${account.feeProfileId}`);
    }
  }

  const accountIds = new Set(store.accounts.map((account) => account.id));
  for (const binding of store.feeProfileBindings) {
    if (!accountIds.has(binding.accountId)) {
      throw new Error(`fee profile binding references unknown account ${binding.accountId}`);
    }
    if (!profilesById.has(binding.feeProfileId)) {
      throw new Error(`fee profile binding references unknown profile ${binding.feeProfileId}`);
    }
    if (!/^[A-Za-z0-9]{1,16}$/.test(binding.symbol)) {
      throw new Error(`fee profile binding has invalid symbol ${binding.symbol}`);
    }
  }
}

function validateAccountingStoreInvariants(accounting: AccountingStore): void {
  if (accounting.policy.inventoryModel !== "LOT_CAPABLE") {
    throw new Error("accounting policy must preserve lot-capable inventory");
  }

  if (accounting.policy.disposalPolicy !== "WEIGHTED_AVERAGE") {
    throw new Error("accounting policy must define weighted-average disposal behavior");
  }

  const tradeIds = new Set(accounting.facts.tradeEvents.map((trade) => trade.id));
  const lotIds = new Set(accounting.projections.lots.map((lot) => lot.id));
  const tradeBookingKeys = new Set<string>();
  for (const trade of accounting.facts.tradeEvents) {
    if (trade.bookingSequence !== undefined && trade.bookingSequence <= 0) {
      throw new Error(`trade ${trade.id} has invalid booking sequence`);
    }

    if (trade.bookingSequence !== undefined) {
      const bookingKey = `${trade.accountId}:${trade.tradeDate}:${trade.bookingSequence}`;
      if (tradeBookingKeys.has(bookingKey)) {
        throw new Error(
          `trade ${trade.id} duplicates booking sequence ${trade.bookingSequence} for ${trade.accountId} on ${trade.tradeDate}`,
        );
      }
      tradeBookingKeys.add(bookingKey);
    }
  }

  const lotOpenedKeys = new Set<string>();
  for (const lot of accounting.projections.lots) {
    if (lot.openedSequence !== undefined && lot.openedSequence <= 0) {
      throw new Error(`lot ${lot.id} has invalid opened sequence`);
    }

    if (lot.openedSequence !== undefined) {
      const openedKey = `${lot.accountId}:${lot.symbol}:${lot.openedAt}:${lot.openedSequence}`;
      if (lotOpenedKeys.has(openedKey)) {
        throw new Error(
          `lot ${lot.id} duplicates opened sequence ${lot.openedSequence} for ${lot.accountId} ${lot.symbol} on ${lot.openedAt}`,
        );
      }
      lotOpenedKeys.add(openedKey);
    }
  }

  for (const allocation of accounting.projections.lotAllocations) {
    if (!tradeIds.has(allocation.tradeEventId)) {
      throw new Error(`lot allocation ${allocation.id} references unknown trade ${allocation.tradeEventId}`);
    }
    if (!lotIds.has(allocation.lotId)) {
      throw new Error(`lot allocation ${allocation.id} references unknown lot ${allocation.lotId}`);
    }
  }
}

function normalizeDate(value: string | Date): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function normalizeDateTime(value: string | Date): string {
  if (typeof value === "string") return new Date(value).toISOString();
  return value.toISOString();
}
