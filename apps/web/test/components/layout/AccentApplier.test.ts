import { describe, expect, it } from "vitest";
import { shouldSkipPreferenceHydration } from "../../../components/layout/AccentApplier";

describe("AccentApplier", () => {
  it("skips preference hydration on public auth and invite surfaces", () => {
    expect(shouldSkipPreferenceHydration("/login")).toBe(true);
    expect(shouldSkipPreferenceHydration("/auth/error")).toBe(true);
    expect(shouldSkipPreferenceHydration("/invite")).toBe(true);
    expect(shouldSkipPreferenceHydration("/invite/CHGGDFXB")).toBe(true);
    expect(shouldSkipPreferenceHydration("/share")).toBe(true);
    expect(shouldSkipPreferenceHydration("/share/public-token")).toBe(true);
  });

  it("hydrates preferences on authenticated app surfaces", () => {
    expect(shouldSkipPreferenceHydration("/dashboard")).toBe(false);
    expect(shouldSkipPreferenceHydration("/settings/profile")).toBe(false);
    expect(shouldSkipPreferenceHydration("/sharing")).toBe(false);
  });
});
