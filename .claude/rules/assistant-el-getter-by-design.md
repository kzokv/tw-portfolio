# Assistant `get el()` Duplication Is By Design

The `private get el() { return this._instance.elements; }` pattern repeated across 13+ test-e2e assistants is intentional, not tech debt.

**Why it can't be consolidated into a base class:**

Each assistant narrows `_instance` via `declare protected readonly _instance: SpecificPage`. The per-assistant `get el()` is defined in the subclass where `this._instance` resolves to the narrowed type, returning the specific elements type (e.g. `AppShellElements`).

Moving the getter to a base class (where `_instance: BasePage<unknown>`) makes it return `unknown` — breaking type-safe element access like `this.el.topBar.elements.avatarButton`. TypeScript resolves getter return types at definition site, not call site; subclass `declare` only narrows direct property access, not inherited getters.

**Do not flag this as duplication in code reviews.** The 1-line getter is the correct TypeScript pattern for type-safe access with `declare`-narrowed instance types.

Evaluated and documented in Phase 5d code review (CR-3), 2026-03-27.
