# React Persisted UI Settings Stability

Persisted UI settings hooks must use stable defaults and skip value-equivalent writes. This applies to column visibility/order/widths, card order, view presets, filters, and any other client-side preference that normalizes state after mount.

## Required Pattern

- Hoist empty/default arrays and objects to module constants, or memoize them before passing them into a hook dependency list.
- Normalize persisted settings into a deterministic shape before comparing or saving them.
- In `setState` updaters, return the existing state object when the normalized next value is value-equal to the current value.
- When adding a new configurable column or preset, handle old saved preferences explicitly so default-hidden/default-visible behavior is stable for existing users.
- Add or update component tests that mount the hook-backed UI long enough to catch render loops.

## Why

The frontend-redesign-reliability holdings follow-up exposed a production-relevant loop: `HoldingsTable` passed a fresh default-hidden column array into `useHoldingsColumnSettings`, and the hook also defaulted omitted arrays to a fresh `[]`. Normalization wrote an equivalent-but-new settings object on each render, which made Portfolio/Reports component specs hang and could waste client rendering time. The fix hoisted default arrays, introduced value-equality checks, and avoided no-op writes.
