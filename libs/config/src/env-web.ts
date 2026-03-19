import { z } from "zod";

export const webEnvSchema = z.object({
  NEXT_PUBLIC_AUTH_MODE: z.enum(["oauth", "dev_bypass"]).default("dev_bypass"),
  NEXT_PUBLIC_API_BASE_URL: z.string().default("http://localhost:4000"),
  SESSION_COOKIE_NAME: z.string().min(1).default("__Host-g_auth_session"),
});

export type WebEnvConfig = z.infer<typeof webEnvSchema>;

/**
 * Parsed web environment config. Safe to import in Edge Runtime (proxy.ts)
 * and Server Components — does not pull in any Node.js modules.
 */
export const WebEnv: WebEnvConfig = webEnvSchema.parse(process.env);
