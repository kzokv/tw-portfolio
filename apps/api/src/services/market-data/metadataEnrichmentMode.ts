import { Env } from "@tw-portfolio/config";
import type { Persistence } from "../../persistence/types.js";

/**
 * Effective AU metadata enrichment mode (KZO-189): DB value when set, else env fallback.
 * Single source of truth — admin route DTO mapper and the backfill worker functor both call this.
 *
 * Mirrors `getEffectiveRepairCooldownMinutes` exactly: tight one-column read via the
 * dedicated persistence method, then falls back to the env default when the override is null.
 */
export async function getEffectiveMetadataEnrichmentMode(
  persistence: Persistence,
): Promise<"unconditional" | "conditional"> {
  const db = await persistence.getMetadataEnrichmentMode();
  return db ?? Env.METADATA_ENRICHMENT_MODE;
}
