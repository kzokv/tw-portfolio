/**
 * KZO-161 — canonical dashboard card metadata.
 *
 * Metadata-only by design (locked decision 9 in scope-todo §Deltas): no
 * Component reference, no render-prop indirection at this layer. AppShell
 * wires heterogeneous card props inline via a slug `switch` (see §8 of
 * `docs/004-notes/kzo-158/design-202604241630-kzo-161-initial.md`).
 *
 * `fullWidth: true` cards render with `xl:col-span-2` inside the
 * `<SortableCardGrid>`'s `xl:grid-cols-2` + `[grid-auto-flow:dense]`
 * layout.
 *
 * When KZO-170 (or similar) adds a new dashboard card:
 *   1. Append the new `{ slug, fullWidth }` entry here.
 *   2. Add a matching `case "<slug>": return <NewCard ... />;` to the
 *      `<SortableCardGrid>` render-prop switch in `AppShell.tsx`.
 *   3. User order preferences that predate the new slug will have the
 *      new card appended at the end (see `mergeCardOrder` in
 *      `components/layout/mergeCardOrder.ts`).
 */
export interface DashboardCard {
  readonly slug: string;
  readonly fullWidth: boolean;
}

export const DASHBOARD_CARDS: ReadonlyArray<DashboardCard> = [
  { slug: "portfolio-trend", fullWidth: true },
  { slug: "allocation-snapshot", fullWidth: true },
  { slug: "return-percent", fullWidth: true },
  { slug: "holdings-table", fullWidth: true },
  { slug: "dividends-section", fullWidth: true },
  // Phase 5e — action-center removed; recompute/generate-snapshots moved
  // to FloatingQuickActions (rendered by AppShell on /dashboard).
  // mergeCardOrder drops the slug from existing user preferences.
] as const;
