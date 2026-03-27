import { TestEnv } from "@tw-portfolio/config/test";

/** Full URL for an app path. Passthrough if already absolute. */
export function appUrl(path = "/"): string {
  return path.startsWith("http") ? path : new URL(path, TestEnv.appBaseUrl).href;
}

/** Full URL for an API path. Passthrough if already absolute. */
export function apiUrl(path = "/"): string {
  return path.startsWith("http") ? path : new URL(path, TestEnv.apiBaseUrl).href;
}
