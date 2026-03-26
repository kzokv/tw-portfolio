# Next.js i18n Dictionary Serialization

Functions in i18n dictionary objects cannot cross the Next.js server→client component boundary. If an i18n dictionary (e.g., `features/*/i18n.ts`) contains a function value and is passed as a prop from a server component to a client component, Next.js throws a serialization error at runtime.

**Wrong pattern:**
```ts
// ❌ Function cannot cross server→client boundary
itemCount: (count: number) => `${count} items selected`,
```

**Correct pattern:**
```ts
// ✅ String template, interpolated at call site
itemCount: "{count} items selected",

// Call site:
t.itemCount.replace("{count}", String(count))
```

**Why:** Discovered in KZO-114 PR2 when adding dynamic strings to portfolio i18n dictionaries. The dictionaries are defined in server modules and consumed by client components.

**How to apply:** When adding new entries to i18n dictionaries (`features/*/i18n.ts`), always use string templates with `{placeholder}` tokens, never inline functions. Check `libs/shared-types` i18n types for the expected string-only shape.
