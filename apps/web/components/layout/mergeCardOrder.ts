import type { DashboardCard } from "../dashboard/cards";

/**
 * KZO-161 — merge canonical card metadata with a user-saved order array.
 *
 * Properties (design §6):
 *   - Unknown slugs are dropped silently. If a saved order mentions a slug
 *     that was later removed from the canonical list, the merge returns only
 *     known canonical cards.
 *   - New canonical slugs are appended at the end. A card added to
 *     `DASHBOARD_CARDS` after a user saved their order becomes visible at
 *     the tail of that user's grid — no migration needed.
 *   - Empty or null `userOrder` returns the canonical order (identity merge).
 *
 * Pure function — no React, no side effects. Safe to unit-test.
 */
export function mergeCardOrder<T extends { readonly slug: string }>(
  canonical: ReadonlyArray<T>,
  userOrder: ReadonlyArray<string> | null | undefined,
): T[] {
  if (!userOrder || userOrder.length === 0) return [...canonical];

  const canonicalBySlug = new Map<string, T>(canonical.map((card) => [card.slug, card]));
  const userKnown: T[] = [];
  const seen = new Set<string>();
  for (const slug of userOrder) {
    if (seen.has(slug)) continue;
    const match = canonicalBySlug.get(slug);
    if (match) {
      userKnown.push(match);
      seen.add(slug);
    }
  }

  const appended = canonical.filter((card) => !seen.has(card.slug));
  return [...userKnown, ...appended];
}

export type { DashboardCard };
