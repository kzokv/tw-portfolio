/**
 * Make React available as a global for tests that use server-side rendering
 * (renderToStaticMarkup) with page components that use JSX.
 *
 * Vitest's esbuild SSR transform does not apply the automatic JSX runtime
 * to source files in all cases; components compiled in classic mode reference
 * React via the global scope. This setup ensures React is available.
 */
import * as React from "react";

Object.assign(globalThis, { React });
