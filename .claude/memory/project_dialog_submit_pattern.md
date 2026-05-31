---
name: project_dialog_submit_pattern
description: Dialog auto-close-on-success requires the submit handler to return a boolean indicating success; closing unconditionally on resolve hides validation errors reported via state
type: project
---

# Dialog auto-close-on-success — submit handler returns boolean

When a dialog should auto-close on successful submit, the underlying submit hook MUST return a `Promise<boolean>` and the caller MUST gate `setOpen(false)` on the return value. Closing unconditionally after `await submit()` hides validation/API failures that are reported via state (`setErrorMessage(...)`, `setMessage(...)`) rather than thrown.

```ts
// ❌ Wrong — closes the dialog even when submit recorded a validation error
onSubmit={async () => {
  await transactionSubmission.submit();
  setOpen(false);
}}

// ✅ Correct — only closes on success
onSubmit={async () => {
  const ok = await transactionSubmission.submit();
  if (ok) setOpen(false);
}}
```

## Hook contract

The hook's `submit` callback should return `false` for every validation/abort early-return path and `true` only when the underlying API call resolved without throwing. Inline error state stays populated either way; the boolean is the dialog-close signal only.

```ts
const submit = useCallback(async (): Promise<boolean> => {
  if (!hasRequiredField) {
    setErrorMessage(missingFieldMessage);
    return false;
  }
  try {
    await apiCall(...);
    setMessage(successMessage);
    return true;
  } catch (error) {
    setErrorMessage(resolveErrorMessage(error));
    return false;
  } finally {
    setIsSubmitting(false);
  }
}, [...]);
```

## Why React state-read after `await` doesn't work

Reading `transactionSubmission.errorMessage` immediately after `await submit()` returns the closure-captured stale value, not the freshly-set state. React batches the state update; by the time the wrapper `async` function resumes, the new `errorMessage` is queued but not visible to the outer closure. The boolean-return pattern sidesteps the batching entirely.

## Open call sites that should follow this pattern

Audit any dialog wrapper that performs a mutation via a state-managed hook and then auto-closes. Examples in this codebase:

- `apps/web/components/portfolio/AddTransactionDialog.tsx` (via `useTransactionSubmission`) — already migrated 2026-05-17.
- `apps/web/components/transactions/TransactionsClient.tsx` — uses the same hook without auto-close; OK as-is.
- `apps/web/app/tickers/[ticker]/TickerHistoryClient.tsx` — same shape; OK as-is.
- Any future dialog wrapping `useRecomputeAction`, profile-edit submit, account-create submit, etc.

**Why:** Codex review of the post-Phase-3d UI sweep (2026-05-17) flagged `AppShell.tsx:351` as HIGH — the closure called `transactionSubmission.submit()` then `setAddTransactionDialogOpen(false)` unconditionally. Validation failures (no account selected, empty ticker) and API failures would have closed the dialog before the user saw the error.

**How to apply:** Whenever wrapping a mutation hook in a dialog with auto-close, audit the hook's `submit` for thrown-vs-state error semantics. If state-based: change the hook to return `Promise<boolean>` and gate `setOpen(false)` on the return value. If thrown-based: the natural try/catch around `await submit()` is sufficient (the throw blocks `setOpen(false)`).

**Promotion gate:** Save as memory until a 2nd data point lands (a different dialog hook needs the same migration). Then promote to `.claude/rules/dialog-auto-close-submit-boolean.md` with the audit checklist baked in.
