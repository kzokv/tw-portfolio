/**
 * Format a cooldown duration (in milliseconds) for human display.
 *
 * - Values ≤ 0  → `"0s"`
 * - Values ≤ 120_000ms → `"Ns"` (rounded to nearest second)
 * - Values > 120_000ms → `"M min"` (rounded to nearest minute)
 *
 * Used by the admin Providers tab to interpolate the live cooldown into
 * per-provider tooltip strings (KZO-197). The placeholder contract is
 * `{cooldown}` per `.claude/rules/nextjs-i18n-serialization.md` — strings
 * stay pure templates; this formatter is the single interpolation point.
 */
export function formatCooldownLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms <= 120_000) {
    return `${Math.round(ms / 1000)}s`;
  }
  return `${Math.round(ms / 60_000)} min`;
}
