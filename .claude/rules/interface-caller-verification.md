# Interface Caller Verification

When designing persistence interfaces or service layer interfaces with many methods upfront, verify all methods have callers before shipping.

```bash
# Before submitting a PR that introduces or extends an interface:
grep -r "methodName" --include="*.ts" .
```

**Why:** KZO-114 code review caught an unused `updateTradeEventDerivedFields` method on the persistence interface. It was designed for separate fee updates but the PATCH route inlined fees into `updateTradeEvent`. Dead interface methods create maintenance burden and confusion about intended data flow.

**How to apply:** Before submitting a PR that introduces or extends a persistence/service interface, grep for all method names and verify each has at least one caller outside the interface definition. This complements the `process-refactor-rename-verification` rule (which covers renames of existing methods).
