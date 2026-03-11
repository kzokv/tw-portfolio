import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { createClient, type RedisClientType } from "redis";
import type { FeeProfile } from "@tw-portfolio/domain";
import type { Quote } from "../providers/marketData.js";
import { loadMigrationManifest } from "./migrationManifest.js";
import {
  buildAccountingPolicy,
  rebuildHoldingProjection,
  syncTradeEventRealizedPnl,
} from "../services/accountingStore.js";
import type {
  AccountingStore,
  CashLedgerEntry,
  DailyPortfolioSnapshot,
  DividendDeductionEntry,
  DividendEvent,
  DividendLedgerEntry,
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
      `SELECT id, name, commission_rate_bps, board_commission_rate, commission_discount_percent, commission_discount_bps, minimum_commission_amount,
              commission_currency,
              commission_rounding_mode, tax_rounding_mode,
              stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps, commission_charge_mode,
              etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps
       FROM fee_profiles
       WHERE user_id = $1
       ORDER BY id`,
      [userId],
    );

    const tradeEventsResult = await this.pool.query(
      `SELECT trade_event.id, trade_event.user_id, trade_event.account_id, trade_event.symbol,
              trade_event.instrument_type, trade_event.trade_type, trade_event.quantity,
              trade_event.unit_price, trade_event.price_currency, trade_event.trade_date,
              trade_event.trade_timestamp, trade_event.booking_sequence, trade_event.commission_amount,
              trade_event.tax_amount, trade_event.is_day_trade, trade_event.source_type,
              trade_event.source_reference, trade_event.booked_at, trade_event.reversal_of_trade_event_id,
              snapshot.profile_id_at_booking, snapshot.profile_name_at_booking, snapshot.board_commission_rate,
              snapshot.commission_discount_percent, snapshot.minimum_commission_amount,
              snapshot.commission_currency, snapshot.commission_rounding_mode, snapshot.tax_rounding_mode,
              snapshot.stock_sell_tax_rate_bps, snapshot.stock_day_trade_tax_rate_bps,
              snapshot.etf_sell_tax_rate_bps, snapshot.bond_etf_sell_tax_rate_bps,
              snapshot.commission_charge_mode
       FROM trade_events AS trade_event
       JOIN trade_fee_policy_snapshots AS snapshot
         ON snapshot.id = trade_event.fee_policy_snapshot_id
       WHERE trade_event.user_id = $1
       ORDER BY trade_event.trade_date, trade_event.booking_sequence, trade_event.trade_timestamp, trade_event.booked_at, trade_event.id`,
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
          `SELECT id, account_id, symbol, open_quantity, total_cost_amount, cost_currency, opened_at, opened_sequence
           FROM lots
           WHERE account_id = ANY($1)
           ORDER BY opened_at, opened_sequence, id`,
          [accountIds],
        )
      : { rows: [] };

    const lotAllocationsResult = await this.pool.query(
      `SELECT id, user_id, account_id, trade_event_id, symbol, lot_id, lot_opened_at,
              lot_opened_sequence, allocated_quantity, allocated_cost_amount, cost_currency, created_at
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

    const dividendEventsResult = await this.pool.query(
      `SELECT id, symbol, event_type, ex_dividend_date, payment_date,
              cash_dividend_per_share, cash_dividend_currency, stock_dividend_per_share,
              source_type, source_reference, created_at
       FROM dividend_events
       ORDER BY ex_dividend_date, id`,
    );
    const dividendLedgerEntriesResult = accountIds.length
      ? await this.pool.query(
          `SELECT id, account_id, dividend_event_id, eligible_quantity,
                  expected_cash_amount, expected_stock_quantity,
                  received_stock_quantity,
                  posting_status, reconciliation_status, booked_at,
                  reversal_of_dividend_ledger_entry_id, superseded_at
           FROM dividend_ledger_entries
           WHERE account_id = ANY($1)
           ORDER BY booked_at, id`,
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
      `SELECT id, user_id, account_id, entry_date, entry_type, amount, currency,
              related_trade_event_id, related_dividend_ledger_entry_id, source_type,
              source_reference, note, booked_at, reversal_of_cash_ledger_entry_id
       FROM cash_ledger_entries
       WHERE user_id = $1
       ORDER BY entry_date, booked_at, id`,
      [userId],
    );

    const snapshotsResult = await this.pool.query(
      `SELECT id, snapshot_date, total_market_value_amount, total_cost_amount,
              total_unrealized_pnl_amount, total_realized_pnl_amount, total_dividend_received_amount,
              total_cash_balance_amount, total_nav_amount, currency, generated_at, generation_run_id
       FROM daily_portfolio_snapshots
       WHERE user_id = $1
       ORDER BY snapshot_date DESC, generated_at DESC, id DESC`,
      [userId],
    );

    const jobIds = jobsResult.rows.map((row) => row.id);
    const jobItemsResult = jobIds.length
      ? await this.pool.query(
          `SELECT id, job_id, trade_event_id, previous_commission_amount, previous_tax_amount,
                  next_commission_amount, next_tax_amount
           FROM recompute_job_items
           WHERE job_id = ANY($1)
           ORDER BY id`,
          [jobIds],
        )
      : { rows: [] };

    const dividendLedgerEntryIds = dividendLedgerEntriesResult.rows.map((row) => row.id);
    const dividendDeductionsResult = dividendLedgerEntryIds.length
      ? await this.pool.query(
          `SELECT id, dividend_ledger_entry_id, deduction_type, amount, currency_code,
                  withheld_at_source, source_type, source_reference, note, booked_at
           FROM dividend_deduction_entries
           WHERE dividend_ledger_entry_id = ANY($1)
           ORDER BY dividend_ledger_entry_id, booked_at, id`,
          [dividendLedgerEntryIds],
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
      boardCommissionRate: Number(row.board_commission_rate ?? row.commission_rate_bps / 10),
      commissionDiscountPercent:
        row.commission_discount_percent !== null
          ? Number(row.commission_discount_percent)
          : legacyCommissionDiscountPercent(row.commission_discount_bps),
      minimumCommissionAmount: row.minimum_commission_amount,
      commissionCurrency: row.commission_currency,
      commissionRoundingMode: row.commission_rounding_mode,
      taxRoundingMode: row.tax_rounding_mode,
      stockSellTaxRateBps: row.stock_sell_tax_rate_bps,
      stockDayTradeTaxRateBps: row.stock_day_trade_tax_rate_bps,
      etfSellTaxRateBps: row.etf_sell_tax_rate_bps,
      bondEtfSellTaxRateBps: row.bond_etf_sell_tax_rate_bps,
      commissionChargeMode: row.commission_charge_mode ?? "CHARGED_UPFRONT",
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
      allocatedCostAmount: row.allocated_cost_amount,
      costCurrency: row.cost_currency,
      createdAt: normalizeDateTime(row.created_at),
    }));

    const tradeEvents: Transaction[] = tradeEventsResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id,
      symbol: row.symbol,
      instrumentType: row.instrument_type,
      type: row.trade_type,
      quantity: row.quantity,
      unitPrice: row.unit_price,
      priceCurrency: row.price_currency,
      tradeDate: normalizeDate(row.trade_date),
      tradeTimestamp: normalizeDateTime(row.trade_timestamp),
      bookingSequence: row.booking_sequence,
      commissionAmount: row.commission_amount,
      taxAmount: row.tax_amount,
      isDayTrade: row.is_day_trade,
      feeSnapshot: hydrateTradeFeeSnapshot(row),
      sourceType: row.source_type,
      sourceReference: row.source_reference ?? undefined,
      bookedAt: normalizeDateTime(row.booked_at),
      realizedPnlCurrency: row.price_currency,
      reversalOfTradeEventId: row.reversal_of_trade_event_id ?? undefined,
    }));

    const cashLedgerEntries: CashLedgerEntry[] = cashLedgerResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id,
      entryDate: normalizeDate(row.entry_date),
      entryType: row.entry_type,
      amount: row.amount,
      currency: row.currency,
      relatedTradeEventId: row.related_trade_event_id ?? undefined,
      relatedDividendLedgerEntryId: row.related_dividend_ledger_entry_id ?? undefined,
      sourceType: row.source_type,
      sourceReference: row.source_reference ?? undefined,
      note: row.note ?? undefined,
      reversalOfCashLedgerEntryId: row.reversal_of_cash_ledger_entry_id ?? undefined,
      bookedAt: normalizeDateTime(row.booked_at),
    }));

    const dividendEvents: DividendEvent[] = dividendEventsResult.rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      eventType: row.event_type,
      exDividendDate: normalizeDate(row.ex_dividend_date),
      paymentDate: normalizeDate(row.payment_date),
      cashDividendPerShare: Number(row.cash_dividend_per_share),
      cashDividendCurrency: row.cash_dividend_currency,
      stockDividendPerShare: Number(row.stock_dividend_per_share),
      sourceType: row.source_type,
      sourceReference: row.source_reference ?? undefined,
      createdAt: normalizeDateTime(row.created_at),
    }));

    const dividendDeductionEntries: DividendDeductionEntry[] = dividendDeductionsResult.rows.map((row) => ({
      id: row.id,
      dividendLedgerEntryId: row.dividend_ledger_entry_id,
      deductionType: row.deduction_type,
      amount: row.amount,
      currencyCode: row.currency_code,
      withheldAtSource: row.withheld_at_source,
      sourceType: row.source_type,
      sourceReference: row.source_reference ?? undefined,
      note: row.note ?? undefined,
      bookedAt: normalizeDateTime(row.booked_at),
    }));

    const receivedCashAmountByDividendLedgerId = new Map<string, number>();
    for (const entry of cashLedgerEntries) {
      if (entry.entryType !== "DIVIDEND_RECEIPT" || !entry.relatedDividendLedgerEntryId) {
        continue;
      }

      receivedCashAmountByDividendLedgerId.set(
        entry.relatedDividendLedgerEntryId,
        (receivedCashAmountByDividendLedgerId.get(entry.relatedDividendLedgerEntryId) ?? 0) + entry.amount,
      );
    }

    const dividendLedgerEntries: DividendLedgerEntry[] = dividendLedgerEntriesResult.rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      dividendEventId: row.dividend_event_id,
      eligibleQuantity: row.eligible_quantity,
      expectedCashAmount: row.expected_cash_amount,
      expectedStockQuantity: row.expected_stock_quantity,
      receivedCashAmount: receivedCashAmountByDividendLedgerId.get(row.id) ?? 0,
      receivedStockQuantity: row.received_stock_quantity,
      postingStatus: row.posting_status,
      reconciliationStatus: row.reconciliation_status,
      reversalOfDividendLedgerEntryId: row.reversal_of_dividend_ledger_entry_id ?? undefined,
      supersededAt: row.superseded_at ? normalizeDateTime(row.superseded_at) : undefined,
      bookedAt: normalizeDateTime(row.booked_at),
    }));

    const snapshots: DailyPortfolioSnapshot[] = snapshotsResult.rows.map((row) => ({
      id: row.id,
      snapshotDate: normalizeDate(row.snapshot_date),
      totalMarketValueAmount: row.total_market_value_amount,
      totalCostAmount: row.total_cost_amount,
      totalUnrealizedPnlAmount: row.total_unrealized_pnl_amount,
      totalRealizedPnlAmount: row.total_realized_pnl_amount,
      totalDividendReceivedAmount: row.total_dividend_received_amount,
      totalCashBalanceAmount: row.total_cash_balance_amount,
      totalNavAmount: row.total_nav_amount,
      currency: row.currency,
      generatedAt: normalizeDateTime(row.generated_at),
      generationRunId: row.generation_run_id,
    }));

    const recomputeItems = new Map<string, RecomputePreviewItem[]>();
    for (const item of jobItemsResult.rows) {
      const list = recomputeItems.get(item.job_id) ?? [];
      list.push({
        tradeEventId: item.trade_event_id,
        previousCommissionAmount: item.previous_commission_amount,
        previousTaxAmount: item.previous_tax_amount,
        nextCommissionAmount: item.next_commission_amount,
        nextTaxAmount: item.next_tax_amount,
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
          tradeEvents,
          cashLedgerEntries,
          dividendEvents,
          dividendLedgerEntries,
          dividendDeductionEntries,
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
            totalCostAmount: row.total_cost_amount,
            costCurrency: row.cost_currency,
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
             id, user_id, name, commission_rate_bps, board_commission_rate, commission_discount_percent, commission_discount_bps,
             minimum_commission_amount, commission_currency, commission_rounding_mode, tax_rounding_mode,
             stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps,
             bond_etf_sell_tax_rate_bps, commission_charge_mode
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10, $11,
             $12, $13, $14,
             $15, $16
           )
           ON CONFLICT (id)
           DO UPDATE SET
             name = EXCLUDED.name,
             commission_rate_bps = EXCLUDED.commission_rate_bps,
             board_commission_rate = EXCLUDED.board_commission_rate,
             commission_discount_percent = EXCLUDED.commission_discount_percent,
             commission_discount_bps = EXCLUDED.commission_discount_bps,
             minimum_commission_amount = EXCLUDED.minimum_commission_amount,
             commission_currency = EXCLUDED.commission_currency,
             commission_rounding_mode = EXCLUDED.commission_rounding_mode,
             tax_rounding_mode = EXCLUDED.tax_rounding_mode,
             stock_sell_tax_rate_bps = EXCLUDED.stock_sell_tax_rate_bps,
             stock_day_trade_tax_rate_bps = EXCLUDED.stock_day_trade_tax_rate_bps,
             etf_sell_tax_rate_bps = EXCLUDED.etf_sell_tax_rate_bps,
             bond_etf_sell_tax_rate_bps = EXCLUDED.bond_etf_sell_tax_rate_bps,
             commission_charge_mode = EXCLUDED.commission_charge_mode
           WHERE fee_profiles.user_id = EXCLUDED.user_id`,
          [
            profile.id,
            store.userId,
            profile.name,
            legacyCommissionRateBps(profile.boardCommissionRate),
            profile.boardCommissionRate,
            profile.commissionDiscountPercent,
            legacyCommissionDiscountBps(profile.commissionDiscountPercent),
            profile.minimumCommissionAmount,
            profile.commissionCurrency,
            profile.commissionRoundingMode,
            profile.taxRoundingMode,
            profile.stockSellTaxRateBps,
            profile.stockDayTradeTaxRateBps,
            profile.etfSellTaxRateBps,
            profile.bondEtfSellTaxRateBps,
            profile.commissionChargeMode,
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

      for (const job of store.recomputeJobs) {
        await client.query(
          `INSERT INTO recompute_jobs (id, user_id, account_id, profile_id, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [job.id, job.userId, job.accountId ?? null, job.profileId, job.status, job.createdAt],
        );

        for (const item of job.items) {
          await client.query(
            `INSERT INTO recompute_job_items (
               id, job_id, trade_event_id, previous_commission_amount, previous_tax_amount,
               next_commission_amount, next_tax_amount
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              `${job.id}:${item.tradeEventId}`,
              job.id,
              item.tradeEventId,
              item.previousCommissionAmount,
              item.previousTaxAmount,
              item.nextCommissionAmount,
              item.nextTaxAmount,
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

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const feePolicySnapshotId = feePolicySnapshotIdForTrade(trade.id);
      await insertTradeFeePolicySnapshot(client, userId, feePolicySnapshotId, trade.feeSnapshot, trade.bookedAt);

      await client.query(
        `INSERT INTO trade_events (
           id, user_id, account_id, symbol, instrument_type, trade_type,
           quantity, unit_price, price_currency, trade_date, trade_timestamp, booking_sequence, commission_amount,
           tax_amount, is_day_trade, fee_policy_snapshot_id, source_type, source_reference, booked_at,
           reversal_of_trade_event_id
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11, $12, $13,
           $14, $15, $16, $17, $18, $19,
           $20
         )`,
        [
          trade.id,
          trade.userId,
          trade.accountId,
          trade.symbol,
          trade.instrumentType,
          trade.type,
          trade.quantity,
          trade.unitPrice,
          trade.priceCurrency,
          trade.tradeDate,
          trade.tradeTimestamp ?? trade.bookedAt ?? new Date(`${trade.tradeDate}T00:00:00.000Z`).toISOString(),
          trade.bookingSequence ?? 1,
          trade.commissionAmount,
          trade.taxAmount,
          trade.isDayTrade,
          feePolicySnapshotId,
          trade.sourceType ?? "legacy_transaction",
          trade.sourceReference ?? trade.id,
          trade.bookedAt ?? new Date(`${trade.tradeDate}T00:00:00.000Z`).toISOString(),
          trade.reversalOfTradeEventId ?? null,
        ],
      );

      await client.query(
        `INSERT INTO cash_ledger_entries (
           id, user_id, account_id, entry_date, entry_type, amount, currency,
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
          cashEntry.amount,
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
        `DELETE FROM lot_allocations
         WHERE user_id = $1
           AND trade_event_id = $2`,
        [userId, tradeEventId],
      );
      for (const allocation of nextAllocations) {
        await client.query(
          `INSERT INTO lot_allocations (
             id, user_id, account_id, trade_event_id, symbol, lot_id, lot_opened_at,
             lot_opened_sequence, allocated_quantity, allocated_cost_amount, cost_currency, created_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10, $11, $12
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
            allocation.allocatedCostAmount,
            allocation.costCurrency,
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
            `INSERT INTO lots (id, account_id, symbol, open_quantity, total_cost_amount, cost_currency, opened_at, opened_sequence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [lot.id, lot.accountId, lot.symbol, lot.openQuantity, lot.totalCostAmount, lot.costCurrency, lot.openedAt, lot.openedSequence ?? 1],
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

  async savePostedDividend(userId: string, accounting: AccountingStore, dividendLedgerEntryId: string): Promise<void> {
    validateAccountingStoreInvariants(accounting);
    await this.ensureUserSeed(userId);

    const dividendLedgerEntry = accounting.facts.dividendLedgerEntries.find((entry) => entry.id === dividendLedgerEntryId);
    if (!dividendLedgerEntry) {
      throw new Error(`dividend ledger entry ${dividendLedgerEntryId} not found in accounting store`);
    }

    const dividendEvent = accounting.facts.dividendEvents.find((entry) => entry.id === dividendLedgerEntry.dividendEventId);
    if (!dividendEvent) {
      throw new Error(`dividend event ${dividendLedgerEntry.dividendEventId} not found in accounting store`);
    }

    const linkedCashEntries = accounting.facts.cashLedgerEntries.filter(
      (entry) => entry.relatedDividendLedgerEntryId === dividendLedgerEntryId,
    );
    const dividendDeductions = accounting.facts.dividendDeductionEntries.filter(
      (entry) => entry.dividendLedgerEntryId === dividendLedgerEntryId,
    );
    const nextLots = accounting.projections.lots.filter(
      (lot) => lot.accountId === dividendLedgerEntry.accountId && lot.symbol === dividendEvent.symbol,
    );

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const existingDividendLedgerEntry = await client.query<{ posting_status: string }>(
        `SELECT posting_status
         FROM dividend_ledger_entries
         WHERE id = $1
         FOR UPDATE`,
        [dividendLedgerEntry.id],
      );
      if (
        existingDividendLedgerEntry.rows[0] &&
        existingDividendLedgerEntry.rows[0].posting_status !== "expected"
      ) {
        throw new Error(
          `posted dividend ledger entry ${dividendLedgerEntry.id} already exists and cannot be overwritten in place`,
        );
      }

      await client.query(
        `INSERT INTO dividend_events (
           id, symbol, event_type, ex_dividend_date, payment_date,
           cash_dividend_per_share, cash_dividend_currency, stock_dividend_per_share,
           source_type, source_reference, created_at
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8,
           $9, $10, $11
         )
         ON CONFLICT (id)
         DO UPDATE SET
           symbol = EXCLUDED.symbol,
           event_type = EXCLUDED.event_type,
           ex_dividend_date = EXCLUDED.ex_dividend_date,
           payment_date = EXCLUDED.payment_date,
           cash_dividend_per_share = EXCLUDED.cash_dividend_per_share,
           cash_dividend_currency = EXCLUDED.cash_dividend_currency,
           stock_dividend_per_share = EXCLUDED.stock_dividend_per_share,
           source_type = EXCLUDED.source_type,
           source_reference = EXCLUDED.source_reference`,
        [
          dividendEvent.id,
          dividendEvent.symbol,
          dividendEvent.eventType,
          dividendEvent.exDividendDate,
          dividendEvent.paymentDate,
          dividendEvent.cashDividendPerShare,
          dividendEvent.cashDividendCurrency,
          dividendEvent.stockDividendPerShare,
          dividendEvent.sourceType,
          dividendEvent.sourceReference ?? null,
          dividendEvent.createdAt ?? new Date().toISOString(),
        ],
      );

      await client.query(
        `INSERT INTO dividend_ledger_entries (
           id, account_id, dividend_event_id, eligible_quantity,
           expected_cash_amount, expected_stock_quantity,
           received_stock_quantity,
           posting_status, reconciliation_status, booked_at,
           reversal_of_dividend_ledger_entry_id, superseded_at
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6,
           $7,
           $8, $9, $10,
           $11, $12
         )
         ON CONFLICT (id)
         DO UPDATE SET
           account_id = EXCLUDED.account_id,
           dividend_event_id = EXCLUDED.dividend_event_id,
           eligible_quantity = EXCLUDED.eligible_quantity,
           expected_cash_amount = EXCLUDED.expected_cash_amount,
           expected_stock_quantity = EXCLUDED.expected_stock_quantity,
           received_stock_quantity = EXCLUDED.received_stock_quantity,
           posting_status = EXCLUDED.posting_status,
           reconciliation_status = EXCLUDED.reconciliation_status,
           booked_at = EXCLUDED.booked_at,
           reversal_of_dividend_ledger_entry_id = EXCLUDED.reversal_of_dividend_ledger_entry_id,
           superseded_at = EXCLUDED.superseded_at`,
        [
          dividendLedgerEntry.id,
          dividendLedgerEntry.accountId,
          dividendLedgerEntry.dividendEventId,
          dividendLedgerEntry.eligibleQuantity,
          dividendLedgerEntry.expectedCashAmount,
          dividendLedgerEntry.expectedStockQuantity,
          dividendLedgerEntry.receivedStockQuantity,
          dividendLedgerEntry.postingStatus,
          dividendLedgerEntry.reconciliationStatus,
          dividendLedgerEntry.bookedAt ?? new Date().toISOString(),
          dividendLedgerEntry.reversalOfDividendLedgerEntryId ?? null,
          dividendLedgerEntry.supersededAt ?? null,
        ],
      );

      await client.query(`DELETE FROM dividend_deduction_entries WHERE dividend_ledger_entry_id = $1`, [dividendLedgerEntry.id]);
      for (const deduction of dividendDeductions) {
        await client.query(
          `INSERT INTO dividend_deduction_entries (
             id, dividend_ledger_entry_id, deduction_type, amount, currency_code,
             withheld_at_source, source_type, source_reference, note, booked_at
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8, $9, $10
           )`,
          [
            deduction.id,
            deduction.dividendLedgerEntryId,
            deduction.deductionType,
            deduction.amount,
            deduction.currencyCode,
            deduction.withheldAtSource,
            deduction.sourceType,
            deduction.sourceReference ?? null,
            deduction.note ?? null,
            deduction.bookedAt ?? dividendLedgerEntry.bookedAt ?? new Date().toISOString(),
          ],
        );
      }

      await client.query(
        `DELETE FROM cash_ledger_entries
         WHERE user_id = $1
           AND related_dividend_ledger_entry_id = $2`,
        [userId, dividendLedgerEntry.id],
      );
      for (const cashEntry of linkedCashEntries) {
        await client.query(
          `INSERT INTO cash_ledger_entries (
             id, user_id, account_id, entry_date, entry_type, amount, currency,
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
            cashEntry.amount,
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
      }

      await client.query(
        `DELETE FROM lots
         WHERE account_id = $1
           AND symbol = $2`,
        [dividendLedgerEntry.accountId, dividendEvent.symbol],
      );
      for (const lot of nextLots) {
        await client.query(
          `INSERT INTO lots (id, account_id, symbol, open_quantity, total_cost_amount, cost_currency, opened_at, opened_sequence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [lot.id, lot.accountId, lot.symbol, lot.openQuantity, lot.totalCostAmount, lot.costCurrency, lot.openedAt, lot.openedSequence ?? 1],
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
    const manifest = await loadMigrationManifest(migrationsDir);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.ensureMigrationLedger(client);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["tw_portfolio_schema_migrations"]);

      const appliedResult = await client.query<{ name: string }>(
        "SELECT name FROM schema_migrations",
      );
      const applied = new Set(appliedResult.rows.map((row) => row.name));

      if (await this.shouldBootstrapFromBaseline(client, applied, manifest.baselineMigration)) {
        const baselineSql = await fs.readFile(
          path.join(migrationsDir, manifest.baselineMigration!),
          "utf8",
        );
        await client.query(baselineSql);
        await this.recordAppliedMigrations(client, [
          manifest.baselineMigration!,
          ...manifest.baselineSupersedes,
        ]);
        applied.add(manifest.baselineMigration!);
        for (const file of manifest.baselineSupersedes) applied.add(file);
      } else if (await this.shouldReconcileCurrentSchemaToBaseline(client, applied, manifest)) {
        await this.recordAppliedMigrations(client, [
          manifest.baselineMigration!,
          ...manifest.baselineSupersedes,
        ]);
        applied.add(manifest.baselineMigration!);
        for (const file of manifest.baselineSupersedes) applied.add(file);
      }

      for (const file of manifest.numberedMigrations) {
        if (applied.has(file)) continue;
        if (await this.isMigrationAlreadyReflected(client, file)) {
          await this.recordAppliedMigrations(client, [file]);
          applied.add(file);
          continue;
        }
        const migrationSql = await fs.readFile(path.join(migrationsDir, file), "utf8");
        await client.query(migrationSql);
        await this.recordAppliedMigrations(client, [file]);
        applied.add(file);
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

  private async shouldBootstrapFromBaseline(
    client: PoolClient,
    applied: Set<string>,
    baselineMigration: string | null,
  ): Promise<boolean> {
    if (!baselineMigration || applied.size > 0) return false;

    const tableResult = await client.query<{ has_tables: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_type = 'BASE TABLE'
           AND table_name <> 'schema_migrations'
       ) AS has_tables`,
    );

    return !tableResult.rows[0]?.has_tables;
  }

  private async shouldReconcileCurrentSchemaToBaseline(
    client: PoolClient,
    applied: Set<string>,
    manifest: { baselineMigration: string | null; baselineSupersedes: string[] },
  ): Promise<boolean> {
    if (!manifest.baselineMigration || applied.size > 0) return false;
    if (!manifest.baselineSupersedes.length) return false;

    const [hasTables, baselineReflected] = await Promise.all([
      this.hasUserTables(client),
      this.isCurrentBaselineSchemaReflected(client),
    ]);

    return hasTables && baselineReflected;
  }

  private async isCurrentBaselineSchemaReflected(client: PoolClient): Promise<boolean> {
    const [hasCoreTables, migration009Reflected, migration010Reflected] = await Promise.all([
      Promise.all([
        this.tableExists(client, "users"),
        this.tableExists(client, "fee_profiles"),
        this.tableExists(client, "accounts"),
        this.tableExists(client, "trade_events"),
      ]).then((results) => results.every(Boolean)),
      this.isMigrationAlreadyReflected(client, "009_retire_twd_ntd_fields.sql"),
      this.isMigrationAlreadyReflected(client, "010_trade_snapshot_recompute_normalization.sql"),
    ]);

    return hasCoreTables && migration009Reflected && migration010Reflected;
  }

  private async isMigrationAlreadyReflected(client: PoolClient, file: string): Promise<boolean> {
    switch (file) {
      case "009_retire_twd_ntd_fields.sql":
        return this.isMigration009Reflected(client);
      case "010_trade_snapshot_recompute_normalization.sql":
        return this.isMigration010Reflected(client);
      default:
        return false;
    }
  }

  private async isMigration009Reflected(client: PoolClient): Promise<boolean> {
    const [
      hasMinimumCommissionAmount,
      hasLegacyMinCommissionNtd,
      hasTradeEventUnitPrice,
      hasTradeEventLegacyPrice,
      hasLotTotalCostAmount,
      hasLotLegacyTotalCost,
      hasSnapshotCurrency,
      hasSnapshotLegacyNav,
    ] = await Promise.all([
      this.columnExists(client, "fee_profiles", "minimum_commission_amount"),
      this.columnExists(client, "fee_profiles", "min_commission_ntd"),
      this.columnExists(client, "trade_events", "unit_price"),
      this.columnExists(client, "trade_events", "price_ntd"),
      this.columnExists(client, "lots", "total_cost_amount"),
      this.columnExists(client, "lots", "total_cost_ntd"),
      this.columnExists(client, "daily_portfolio_snapshots", "currency"),
      this.columnExists(client, "daily_portfolio_snapshots", "total_nav_ntd"),
    ]);

    return (
      hasMinimumCommissionAmount &&
      !hasLegacyMinCommissionNtd &&
      hasTradeEventUnitPrice &&
      !hasTradeEventLegacyPrice &&
      hasLotTotalCostAmount &&
      !hasLotLegacyTotalCost &&
      hasSnapshotCurrency &&
      !hasSnapshotLegacyNav
    );
  }

  private async isMigration010Reflected(client: PoolClient): Promise<boolean> {
    const [
      hasTradeFeePolicySnapshots,
      hasTradeEventSnapshotId,
      hasLegacyTradeEventSnapshotJson,
      hasRecomputeTradeEventId,
      hasLegacyRecomputeTransactionId,
      hasTransactionsTable,
    ] = await Promise.all([
      this.tableExists(client, "trade_fee_policy_snapshots"),
      this.columnExists(client, "trade_events", "fee_policy_snapshot_id"),
      this.columnExists(client, "trade_events", "fee_snapshot_json"),
      this.columnExists(client, "recompute_job_items", "trade_event_id"),
      this.columnExists(client, "recompute_job_items", "transaction_id"),
      this.tableExists(client, "transactions"),
    ]);

    return (
      hasTradeFeePolicySnapshots &&
      hasTradeEventSnapshotId &&
      !hasLegacyTradeEventSnapshotJson &&
      hasRecomputeTradeEventId &&
      !hasLegacyRecomputeTransactionId &&
      !hasTransactionsTable
    );
  }

  private async hasUserTables(client: PoolClient): Promise<boolean> {
    const tableResult = await client.query<{ has_tables: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_type = 'BASE TABLE'
           AND table_name <> 'schema_migrations'
       ) AS has_tables`,
    );

    return Boolean(tableResult.rows[0]?.has_tables);
  }

  private async tableExists(client: PoolClient, tableName: string): Promise<boolean> {
    const tableResult = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = $1
       ) AS exists`,
      [tableName],
    );

    return Boolean(tableResult.rows[0]?.exists);
  }

  private async columnExists(client: PoolClient, tableName: string, columnName: string): Promise<boolean> {
    const columnResult = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = $1
           AND column_name = $2
       ) AS exists`,
      [tableName, columnName],
    );

    return Boolean(columnResult.rows[0]?.exists);
  }

  private async recordAppliedMigrations(client: PoolClient, migrationNames: string[]): Promise<void> {
    if (!migrationNames.length) return;

    await client.query(
      `INSERT INTO schema_migrations (name)
       SELECT migration_name
       FROM unnest($1::text[]) AS migration_name
       ON CONFLICT (name) DO NOTHING`,
      [migrationNames],
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
         id, user_id, name, commission_rate_bps, board_commission_rate, commission_discount_percent, commission_discount_bps,
         minimum_commission_amount, commission_currency, commission_rounding_mode, tax_rounding_mode,
         stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps,
         etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps, commission_charge_mode
       ) VALUES (
         $1, $2, 'Default Broker', 14, 1.425, 0, 10000,
         20, 'TWD', 'FLOOR', 'FLOOR',
         30, 15,
         10, 0, 'CHARGED_UPFRONT'
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
    if (accountIds.length) {
      await client.query(
        `DELETE FROM dividend_deduction_entries dde
         USING dividend_ledger_entries dle
         WHERE dde.dividend_ledger_entry_id = dle.id
           AND dle.account_id = ANY($1)`,
        [accountIds],
      );
      await client.query(`DELETE FROM dividend_ledger_entries WHERE account_id = ANY($1)`, [accountIds]);
    }
    await client.query(`DELETE FROM lot_allocations WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM trade_events WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM trade_fee_policy_snapshots WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM daily_portfolio_snapshots WHERE user_id = $1`, [userId]);

    for (const dividendEvent of accounting.facts.dividendEvents) {
      await client.query(
        `INSERT INTO dividend_events (
           id, symbol, event_type, ex_dividend_date, payment_date,
           cash_dividend_per_share, cash_dividend_currency, stock_dividend_per_share,
           source_type, source_reference, created_at
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8,
           $9, $10, $11
         )
         ON CONFLICT (id)
         DO UPDATE SET
           symbol = EXCLUDED.symbol,
           event_type = EXCLUDED.event_type,
           ex_dividend_date = EXCLUDED.ex_dividend_date,
           payment_date = EXCLUDED.payment_date,
           cash_dividend_per_share = EXCLUDED.cash_dividend_per_share,
           cash_dividend_currency = EXCLUDED.cash_dividend_currency,
           stock_dividend_per_share = EXCLUDED.stock_dividend_per_share,
           source_type = EXCLUDED.source_type,
           source_reference = EXCLUDED.source_reference`,
        [
          dividendEvent.id,
          dividendEvent.symbol,
          dividendEvent.eventType,
          dividendEvent.exDividendDate,
          dividendEvent.paymentDate,
          dividendEvent.cashDividendPerShare,
          dividendEvent.cashDividendCurrency,
          dividendEvent.stockDividendPerShare,
          dividendEvent.sourceType,
          dividendEvent.sourceReference ?? null,
          dividendEvent.createdAt ?? new Date().toISOString(),
        ],
      );
    }

    for (const dividendLedgerEntry of accounting.facts.dividendLedgerEntries) {
      await client.query(
        `INSERT INTO dividend_ledger_entries (
           id, account_id, dividend_event_id, eligible_quantity,
           expected_cash_amount, expected_stock_quantity,
           received_stock_quantity,
           posting_status, reconciliation_status, booked_at,
           reversal_of_dividend_ledger_entry_id, superseded_at
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6,
           $7,
           $8, $9, $10,
           $11, $12
         )`,
        [
          dividendLedgerEntry.id,
          dividendLedgerEntry.accountId,
          dividendLedgerEntry.dividendEventId,
          dividendLedgerEntry.eligibleQuantity,
          dividendLedgerEntry.expectedCashAmount,
          dividendLedgerEntry.expectedStockQuantity,
          dividendLedgerEntry.receivedStockQuantity,
          dividendLedgerEntry.postingStatus,
          dividendLedgerEntry.reconciliationStatus,
          dividendLedgerEntry.bookedAt ?? new Date().toISOString(),
          dividendLedgerEntry.reversalOfDividendLedgerEntryId ?? null,
          dividendLedgerEntry.supersededAt ?? null,
        ],
      );

      for (const deduction of accounting.facts.dividendDeductionEntries.filter(
        (entry) => entry.dividendLedgerEntryId === dividendLedgerEntry.id,
      )) {
        await client.query(
          `INSERT INTO dividend_deduction_entries (
             id, dividend_ledger_entry_id, deduction_type, amount, currency_code,
             withheld_at_source, source_type, source_reference, note, booked_at
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8, $9, $10
           )`,
          [
            deduction.id,
            deduction.dividendLedgerEntryId,
            deduction.deductionType,
            deduction.amount,
            deduction.currencyCode,
            deduction.withheldAtSource,
            deduction.sourceType,
            deduction.sourceReference ?? null,
            deduction.note ?? null,
            deduction.bookedAt ?? dividendLedgerEntry.bookedAt ?? new Date().toISOString(),
          ],
        );
      }
    }

    for (const tx of accounting.facts.tradeEvents) {
      const feePolicySnapshotId = feePolicySnapshotIdForTrade(tx.id);
      await insertTradeFeePolicySnapshot(client, userId, feePolicySnapshotId, tx.feeSnapshot, tx.bookedAt);

      await client.query(
        `INSERT INTO trade_events (
           id, user_id, account_id, symbol, instrument_type, trade_type,
           quantity, unit_price, price_currency, trade_date, trade_timestamp, booking_sequence, commission_amount,
           tax_amount, is_day_trade, fee_policy_snapshot_id, source_type, source_reference, booked_at,
           reversal_of_trade_event_id
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11, $12, $13,
           $14, $15, $16, $17, $18, $19,
           $20
         )`,
        [
          tx.id,
          tx.userId,
          tx.accountId,
          tx.symbol,
          tx.instrumentType,
          tx.type,
          tx.quantity,
          tx.unitPrice,
          tx.priceCurrency,
          tx.tradeDate,
          tx.tradeTimestamp ?? tx.bookedAt ?? new Date(`${tx.tradeDate}T00:00:00.000Z`).toISOString(),
          tx.bookingSequence ?? 1,
          tx.commissionAmount,
          tx.taxAmount,
          tx.isDayTrade,
          feePolicySnapshotId,
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
           id, user_id, account_id, entry_date, entry_type, amount, currency,
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
          entry.amount,
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
           lot_opened_sequence, allocated_quantity, allocated_cost_amount, cost_currency, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11, $12
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
          allocation.allocatedCostAmount,
          allocation.costCurrency,
          allocation.createdAt ?? new Date().toISOString(),
        ],
      );
    }

    for (const snapshot of accounting.projections.dailyPortfolioSnapshots) {
      await client.query(
        `INSERT INTO daily_portfolio_snapshots (
           id, user_id, snapshot_date, total_market_value_amount, total_cost_amount,
           total_unrealized_pnl_amount, total_realized_pnl_amount, total_dividend_received_amount,
           total_cash_balance_amount, total_nav_amount, currency, generated_at, generation_run_id
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8,
           $9, $10, $11, $12, $13
         )`,
        [
          snapshot.id,
          userId,
          snapshot.snapshotDate,
          snapshot.totalMarketValueAmount,
          snapshot.totalCostAmount,
          snapshot.totalUnrealizedPnlAmount,
          snapshot.totalRealizedPnlAmount,
          snapshot.totalDividendReceivedAmount,
          snapshot.totalCashBalanceAmount,
          snapshot.totalNavAmount,
          snapshot.currency,
          snapshot.generatedAt,
          snapshot.generationRunId,
        ],
      );
    }

    if (accountIds.length) {
      await client.query(`DELETE FROM lots WHERE account_id = ANY($1)`, [accountIds]);
      for (const lot of accounting.projections.lots) {
        await client.query(
          `INSERT INTO lots (id, account_id, symbol, open_quantity, total_cost_amount, cost_currency, opened_at, opened_sequence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [lot.id, lot.accountId, lot.symbol, lot.openQuantity, lot.totalCostAmount, lot.costCurrency, lot.openedAt, lot.openedSequence ?? 1],
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
  for (const profile of store.feeProfiles) {
    if (profile.commissionDiscountPercent < 0 || profile.commissionDiscountPercent > 100) {
      throw new Error(`fee profile ${profile.id} has invalid commission discount percent`);
    }
    if (!isCurrencyCode(profile.commissionCurrency)) {
      throw new Error(`fee profile ${profile.id} has invalid commission currency ${profile.commissionCurrency}`);
    }
  }
  validateAccountingStoreInvariants(store.accounting, accountIds);
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

function validateAccountingStoreInvariants(accounting: AccountingStore, accountIds?: Set<string>): void {
  if (accounting.policy.inventoryModel !== "LOT_CAPABLE") {
    throw new Error("accounting policy must preserve lot-capable inventory");
  }

  if (accounting.policy.disposalPolicy !== "WEIGHTED_AVERAGE") {
    throw new Error("accounting policy must define weighted-average disposal behavior");
  }

  const tradeIds = new Set(accounting.facts.tradeEvents.map((trade) => trade.id));
  const lotIds = new Set(accounting.projections.lots.map((lot) => lot.id));
  const dividendEventIds = new Set(accounting.facts.dividendEvents.map((event) => event.id));
  const dividendLedgerIds = new Set(accounting.facts.dividendLedgerEntries.map((entry) => entry.id));
  const tradeBookingKeys = new Set<string>();

  for (const trade of accounting.facts.tradeEvents) {
    if (!isCurrencyCode(trade.priceCurrency)) {
      throw new Error(`trade ${trade.id} has invalid price currency ${trade.priceCurrency}`);
    }

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
  const supersededDividendLedgerEntryIds = new Set(
    accounting.facts.dividendLedgerEntries
      .map((entry) => entry.reversalOfDividendLedgerEntryId)
      .filter((entry): entry is string => Boolean(entry)),
  );
  const activeDividendKeys = new Set<string>();

  for (const dividendEvent of accounting.facts.dividendEvents) {
    if (!isCurrencyCode(dividendEvent.cashDividendCurrency)) {
      throw new Error(`dividend event ${dividendEvent.id} has invalid cash currency ${dividendEvent.cashDividendCurrency}`);
    }
  }

  for (const lot of accounting.projections.lots) {
    if (!isCurrencyCode(lot.costCurrency)) {
      throw new Error(`lot ${lot.id} has invalid cost currency ${lot.costCurrency}`);
    }

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

  for (const dividendLedgerEntry of accounting.facts.dividendLedgerEntries) {
    if (!dividendEventIds.has(dividendLedgerEntry.dividendEventId)) {
      throw new Error(
        `dividend ledger entry ${dividendLedgerEntry.id} references unknown dividend event ${dividendLedgerEntry.dividendEventId}`,
      );
    }
    if (accountIds && !accountIds.has(dividendLedgerEntry.accountId)) {
      throw new Error(
        `dividend ledger entry ${dividendLedgerEntry.id} references unknown account ${dividendLedgerEntry.accountId}`,
      );
    }
    if (dividendLedgerEntry.postingStatus === "expected" && dividendLedgerEntry.reconciliationStatus !== "open") {
      throw new Error(`expected dividend ledger entry ${dividendLedgerEntry.id} must remain reconciliation open`);
    }
    if (
      ["matched", "explained", "resolved"].includes(dividendLedgerEntry.reconciliationStatus) &&
      !["posted", "adjusted"].includes(dividendLedgerEntry.postingStatus)
    ) {
      throw new Error(`dividend ledger entry ${dividendLedgerEntry.id} has invalid posting/reconciliation status pair`);
    }
    if (
      !dividendLedgerEntry.reversalOfDividendLedgerEntryId &&
      !dividendLedgerEntry.supersededAt &&
      !supersededDividendLedgerEntryIds.has(dividendLedgerEntry.id)
    ) {
      const activeKey = `${dividendLedgerEntry.accountId}:${dividendLedgerEntry.dividendEventId}`;
      if (activeDividendKeys.has(activeKey)) {
        throw new Error(`dividend ledger entry ${dividendLedgerEntry.id} duplicates active row for ${activeKey}`);
      }
      activeDividendKeys.add(activeKey);
    }
  }

  for (const allocation of accounting.projections.lotAllocations) {
    if (!tradeIds.has(allocation.tradeEventId)) {
      throw new Error(`lot allocation ${allocation.id} references unknown trade ${allocation.tradeEventId}`);
    }
    if (!lotIds.has(allocation.lotId)) {
      throw new Error(`lot allocation ${allocation.id} references unknown lot ${allocation.lotId}`);
    }
    if (!isCurrencyCode(allocation.costCurrency)) {
      throw new Error(`lot allocation ${allocation.id} has invalid cost currency ${allocation.costCurrency}`);
    }
  }

  for (const cashEntry of accounting.facts.cashLedgerEntries) {
    if (!isCurrencyCode(cashEntry.currency)) {
      throw new Error(`cash ledger entry ${cashEntry.id} has invalid currency ${cashEntry.currency}`);
    }

    if (
      cashEntry.relatedDividendLedgerEntryId &&
      !dividendLedgerIds.has(cashEntry.relatedDividendLedgerEntryId)
    ) {
      throw new Error(
        `cash ledger entry ${cashEntry.id} references unknown dividend ledger ${cashEntry.relatedDividendLedgerEntryId}`,
      );
    }
  }

  const dividendEventCurrencyByLedgerId = new Map(
    accounting.facts.dividendLedgerEntries.map((entry) => {
      const event = accounting.facts.dividendEvents.find((item) => item.id === entry.dividendEventId);
      return [entry.id, event?.cashDividendCurrency];
    }),
  );

  for (const deduction of accounting.facts.dividendDeductionEntries) {
    if (!dividendLedgerIds.has(deduction.dividendLedgerEntryId)) {
      throw new Error(
        `dividend deduction ${deduction.id} references unknown dividend ledger ${deduction.dividendLedgerEntryId}`,
      );
    }
    if (!isCurrencyCode(deduction.currencyCode)) {
      throw new Error(`dividend deduction ${deduction.id} has invalid currency ${deduction.currencyCode}`);
    }

    const expectedCurrency = dividendEventCurrencyByLedgerId.get(deduction.dividendLedgerEntryId);
    if (!expectedCurrency) {
      throw new Error(`dividend deduction ${deduction.id} is missing parent dividend currency context`);
    }

    if (deduction.currencyCode !== expectedCurrency) {
      throw new Error(`dividend deduction ${deduction.id} currency must match parent dividend currency ${expectedCurrency}`);
    }
  }

  for (const snapshot of accounting.projections.dailyPortfolioSnapshots) {
    if (!isCurrencyCode(snapshot.currency)) {
      throw new Error(`snapshot ${snapshot.id} has invalid currency ${snapshot.currency}`);
    }
  }
}

function normalizeDate(value: string | Date): string {
  if (typeof value === "string") return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDateTime(value: string | Date): string {
  if (typeof value === "string") return new Date(value).toISOString();
  return value.toISOString();
}

function feePolicySnapshotIdForTrade(tradeEventId: string): string {
  return `trade-fee-snapshot:${tradeEventId}`;
}

async function insertTradeFeePolicySnapshot(
  client: PoolClient,
  userId: string,
  snapshotId: string,
  feeSnapshot: FeeProfile,
  bookedAt?: string,
): Promise<void> {
  await client.query(
    `INSERT INTO trade_fee_policy_snapshots (
       id, user_id, profile_id_at_booking, profile_name_at_booking, board_commission_rate,
       commission_discount_percent, minimum_commission_amount, commission_currency,
       commission_rounding_mode, tax_rounding_mode, stock_sell_tax_rate_bps,
       stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps,
       commission_charge_mode, booked_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8,
       $9, $10, $11,
       $12, $13, $14,
       $15, $16
     )`,
    [
      snapshotId,
      userId,
      feeSnapshot.id,
      feeSnapshot.name,
      feeSnapshot.boardCommissionRate,
      feeSnapshot.commissionDiscountPercent,
      feeSnapshot.minimumCommissionAmount,
      feeSnapshot.commissionCurrency,
      feeSnapshot.commissionRoundingMode,
      feeSnapshot.taxRoundingMode,
      feeSnapshot.stockSellTaxRateBps,
      feeSnapshot.stockDayTradeTaxRateBps,
      feeSnapshot.etfSellTaxRateBps,
      feeSnapshot.bondEtfSellTaxRateBps,
      feeSnapshot.commissionChargeMode,
      bookedAt ?? new Date().toISOString(),
    ],
  );
}

function legacyCommissionRateBps(boardCommissionRate: number): number {
  return Math.round(boardCommissionRate * 10);
}

function legacyCommissionDiscountBps(commissionDiscountPercent: number): number {
  return Math.round((100 - commissionDiscountPercent) * 100);
}

function legacyCommissionDiscountPercent(commissionDiscountBps: number | null | undefined): number {
  return Number(((10_000 - Number(commissionDiscountBps ?? 10_000)) / 100).toFixed(2));
}

function isCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

function hydrateTradeFeeSnapshot(row: Record<string, unknown>): FeeProfile {
  return {
    id: String(row.profile_id_at_booking),
    name: String(row.profile_name_at_booking),
    boardCommissionRate: Number(row.board_commission_rate),
    commissionDiscountPercent: Number(row.commission_discount_percent),
    minimumCommissionAmount: Number(row.minimum_commission_amount),
    commissionCurrency: String(row.commission_currency),
    commissionRoundingMode: String(row.commission_rounding_mode) as FeeProfile["commissionRoundingMode"],
    taxRoundingMode: String(row.tax_rounding_mode) as FeeProfile["taxRoundingMode"],
    stockSellTaxRateBps: Number(row.stock_sell_tax_rate_bps),
    stockDayTradeTaxRateBps: Number(row.stock_day_trade_tax_rate_bps),
    etfSellTaxRateBps: Number(row.etf_sell_tax_rate_bps),
    bondEtfSellTaxRateBps: Number(row.bond_etf_sell_tax_rate_bps),
    commissionChargeMode: String(row.commission_charge_mode) as FeeProfile["commissionChargeMode"],
  };
}
