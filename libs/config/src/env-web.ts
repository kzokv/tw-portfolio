import { webEnvSchema } from "./env-schema.js";
import type { WebEnvConfig } from "./env-schema.js";

export { webEnvSchema } from "./env-schema.js";
export type { WebEnvConfig } from "./env-schema.js";

/**
 * Parsed web environment config. Safe to import in Edge Runtime (proxy.ts)
 * and Server Components — does not pull in any Node.js modules.
 */
export const WebEnv: WebEnvConfig = Object.freeze(webEnvSchema.parse(process.env));
