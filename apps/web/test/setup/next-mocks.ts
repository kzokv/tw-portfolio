/**
 * Lightweight stubs for Next.js modules used in component tests.
 * Vitest cannot resolve next/* imports outside the Next.js runtime.
 * These stubs provide the minimum API surface used by our components.
 */
import { vi } from "vitest";

// --- next/link ---
// Default export: a component that renders <a> with the href.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [k: string]: unknown }) => {
    const React = globalThis.React;
    return React.createElement("a", { href, ...props }, children);
  },
}));

// --- next/navigation ---
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(() => {
    const error = new Error("NEXT_NOT_FOUND");
    (error as Error & { digest?: string }).digest = "NEXT_NOT_FOUND";
    throw error;
  }),
}));

// --- next/headers ---
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve({
    get: vi.fn(() => undefined),
    getAll: vi.fn(() => []),
    has: vi.fn(() => false),
    set: vi.fn(),
    delete: vi.fn(),
  })),
  headers: vi.fn(() => new Map()),
}));
