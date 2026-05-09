# Capability-Flag Polarity for Cross-Market / Cross-Provider Behavior Gating

When a feature toggles by provider/market identity (e.g., "use feed delisting" vs "use absence-diff delisting" vs "no detection at all"), prefer **explicit positive capability flags** on the provider/strategy interface. Do not gate behavior on the **negation** of an existing capability — that pattern accidentally enables the new feature for any provider that happens to lack the negated capability for unrelated reasons.

## The polarity trap

```ts
// ❌ Wrong — implicit polarity inversion
if (provider.supportsDelistingFeed) {
  // feed path
} else {
  // absence path — but this fires for EVERY provider that lacks a feed,
  //                including ones that should do nothing (e.g., FinMind-US).
}

// ✅ Correct — two positive capabilities, mutually independent
if (provider.supportsDelistingFeed) {
  // feed path
} else if (provider.absenceDetectionEnabled) {
  // absence path — only providers that explicitly opted in
} else {
  // bare upsert — no detection of any kind
}
```

The wrong shape is seductive because it looks like a clean dichotomy. It isn't: "no feed" and "uses absence" are *different* statements about the provider, and the codebase will eventually have providers that satisfy the first but not the second (or vice versa).

## Why two booleans, not one tri-valued enum

A `detectionMode: "feed" | "absence" | "none"` enum forces a single owner to decide the mode. Two independent booleans let each provider class declare its own capabilities — the provider author sets `supportsDelistingFeed` based on whether their data source has a feed; a different ticket can later flip `absenceDetectionEnabled` on without touching the feed flag. The enum couples concerns; the two-flag form keeps them independent.

## When the rule applies

- New behavioral switch keyed off provider / market / strategy identity.
- Any `if (!provider.X) { /* new feature path */ }` site — read carefully: is the path you're enabling intended for ALL `!X` providers, or only some? Default suspicion: only some.
- Feature gates added to a `*Provider` / `*Strategy` / `*Backend` interface.

## Audit recipe

When adding a capability flag, run:

```bash
grep -rln "as never\|as unknown as <ProviderInterfaceName>\|as <ProviderInterfaceName>" apps/ libs/
```

Every match is a site where the new flag must be set explicitly on inline mock literals (per `interface-caller-verification.md`). Cast-suppressed sites are invisible to `tsc --noEmit` — TypeScript will not catch a missing flag inside an `as never`-cast object literal.

## Why this is a rule

KZO-195 — original locked design used `!supportsDelistingFeed` as the absence-detection gate. Codex review at iter 9 caught that this enabled US absence detection (FinMind-US has `supportsDelistingFeed=false` for legitimate reasons — no feed exists — but US delistings were explicitly out of scope). Backend introduced `absenceDetectionEnabled` as a separate positive flag (true on TD-AU only); the 3-way runtime gate landed clean. Cost: one user-authorized iter 9 cycle plus the audit grep across 8 cast sites. Caught only because the user requested an external Codex review — internal CI / typecheck / suite-coverage did not surface it.

## How to apply

- New behavioral switch on a provider/strategy interface → declare a **positive** capability flag, not a negation.
- Existing code review: any `if (!provider.X)` on an interface-typed value is a smell — validate that ALL `!X` providers should follow the new path.
- Companion: `interface-caller-verification.md` (cast-grep audit when adding flags), `.claude/rules/test-placement-persistence-backend.md` (test placement), `.claude/rules/exit-check-non-regression-checklist.md` (verify no cross-market regression).
