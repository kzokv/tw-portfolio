import type { Pool } from "pg";

export async function cleanupExpiredDemoUsers(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE is_demo = true AND demo_expires_at < NOW() - INTERVAL '1 hour'`,
  );

  if (rows.length === 0) return 0;

  const userIds = rows.map((r) => r.id);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 16 DELETEs in FK topological order
    await client.query(`DELETE FROM recompute_job_items WHERE job_id IN (SELECT id FROM recompute_jobs WHERE user_id = ANY($1))`, [userIds]);
    await client.query(`DELETE FROM cash_ledger_entries WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM dividend_deduction_entries WHERE dividend_ledger_entry_id IN (SELECT id FROM dividend_ledger_entries WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ANY($1)))`, [userIds]);
    await client.query(`DELETE FROM dividend_ledger_entries WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ANY($1))`, [userIds]);
    await client.query(`DELETE FROM lot_allocations WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM trade_events WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM trade_fee_policy_snapshots WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM lots WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ANY($1))`, [userIds]);
    await client.query(`DELETE FROM corporate_actions WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ANY($1))`, [userIds]);
    // KZO-115: daily_portfolio_snapshots is no longer written (replaced by
    // daily_holding_snapshots). The table still exists in the schema but is
    // effectively dead — cleaning it keeps demo cleanup defensive.
    await client.query(`DELETE FROM daily_holding_snapshots WHERE user_id = ANY($1)`, [userIds]);
    // KZO-165: composite FK (account_id, user_id) → accounts(id, user_id) — must
    // be cleared before the accounts row is deleted later in this cascade.
    await client.query(`DELETE FROM currency_wallet_snapshots WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM daily_portfolio_snapshots WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM recompute_jobs WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM accounts WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM fee_profile_tax_rules WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM fee_profiles WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM user_external_identities WHERE user_id = ANY($1)`, [userIds]);
    await client.query(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);

    await client.query("COMMIT");
    console.log(`[demo-cleanup] Deleted ${userIds.length} expired demo user(s)`);
    return userIds.length;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[demo-cleanup] Cleanup failed, rolled back:", err);
    throw err;
  } finally {
    client.release();
  }
}
