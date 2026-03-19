import { WebEnv } from "@tw-portfolio/config/web";
import { cookies } from "next/headers";

export interface Session {
  userId: string;
}

/**
 * Returns the current session from the HTTP-only session cookie, or null.
 * Safe to call from Server Components and Route Handlers only.
 */
export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(WebEnv.SESSION_COOKIE_NAME)?.value;
  if (!value?.trim()) return null;
  return { userId: value.trim() };
}
