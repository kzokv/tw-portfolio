---
name: i18n_function_serialization
description: Functions in i18n dictionary objects can't cross Next.js server→client serialization boundary — use string templates with .replace() instead
type: project
---

Next.js cannot serialize functions across the server→client component boundary. If an i18n dictionary object (e.g., `features/portfolio/i18n.ts`) contains a function value like `(count: number) => \`${count} items\`` and that object is passed as a prop from a server component to a client component, Next.js will throw a serialization error at runtime.

**Fix:** Replace function values with string templates and use `.replace()` at the call site:

```ts
// ❌ Wrong — function cannot cross server→client boundary
itemCount: (count: number) => `${count} items selected`,

// ✅ Correct — string template, interpolated at call site
itemCount: "{count} items selected",

// Call site:
t.itemCount.replace("{count}", String(count))
```

**Why:** Discovered in KZO-114 PR2 when adding dynamic strings to portfolio i18n dictionaries. The dictionaries are defined in server modules and consumed by client components — any function value in the dictionary triggers a Next.js serialization error.

**How to apply:** When adding new entries to i18n dictionaries in this project (e.g., `features/*/i18n.ts`), always use string templates with `{placeholder}` tokens, never inline functions. Check `libs/shared-types` i18n types for the expected string-only shape.
