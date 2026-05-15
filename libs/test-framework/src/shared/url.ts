import { TestEnv } from "@vakwen/config/test";

export function appUrl(path = "/"): string {
  return path.startsWith("http") ? path : new URL(path, TestEnv.appBaseUrl).href;
}

export function apiUrl(path = "/"): string {
  return path.startsWith("http") ? path : new URL(path, TestEnv.apiBaseUrl).href;
}
