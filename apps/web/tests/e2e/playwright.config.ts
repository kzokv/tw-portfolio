import path from "path";
import { fileURLToPath } from "url";
import { devices } from "@playwright/test";
import { createPlaywrightConfig } from "@vakwen/test-framework/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

// Phase 3g (§12 A8) — mobile + tablet viewport gates.
//
// The default desktop `chromium` project runs every spec EXCEPT
// `mobile-*-aaa.spec.ts`. The two narrow projects below run ONLY
// `mobile-*-aaa.spec.ts` at their pinned viewports. This keeps the
// existing 100+ specs from being multiplied 3× across viewports while
// surfacing mobile / tablet regressions in dedicated specs.
//
// Pinned viewports:
//   - chromium-mobile: 375 × 667 (iPhone SE — smallest viable target)
//   - chromium-tablet: 768 × 1024 (iPad portrait — `md` boundary)
export default createPlaywrightConfig({
  testDir: "./specs",
  repoRoot,
  webServers: "full",
  authMode: "dev_bypass",
  workers: 1,
  retries: 1,
  videoMode: "off",
  apiEnvOverrides: {
    AU_PROVIDER_MOCK: "true",
    AU_CATALOG_PROVIDER_MOCK: "true",
    KR_PROVIDER_MOCK: "true",
    KR_CATALOG_PROVIDER_MOCK: "true",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /mobile-.*-aaa\.spec\.ts/,
    },
    {
      name: "chromium-mobile",
      use: { ...devices["iPhone SE"], viewport: { width: 375, height: 667 } },
      testMatch: /mobile-.*-aaa\.spec\.ts/,
    },
    {
      name: "chromium-tablet",
      use: { ...devices["iPad Mini"], viewport: { width: 768, height: 1024 } },
      testMatch: /mobile-.*-aaa\.spec\.ts/,
    },
  ],
});
