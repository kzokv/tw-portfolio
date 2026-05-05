import path from "path";
import { fileURLToPath } from "url";
import { createPlaywrightConfig } from "@tw-portfolio/test-framework/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

export default createPlaywrightConfig({
  testDir: "./specs",
  repoRoot,
  webServers: "full",
  authMode: "dev_bypass",
  workers: 2,
  apiEnvOverrides: {
    AU_PROVIDER_MOCK: "true",
  },
});
