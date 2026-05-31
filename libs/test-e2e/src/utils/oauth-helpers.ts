import type { TSessionAssistant } from "../assistants/auth/index.js";
import { TestEnv } from "@vakwen/config/test";

/**
 * Starts an OAuth flow and extracts the state parameter.
 * Composes: session.actions.requestOAuthStart() + session.arrange.oauthState()
 */
export async function startOAuthAndGetState(
  session: TSessionAssistant,
  returnTo?: string,
): Promise<string> {
  const response = await session.actions.requestOAuthStart(returnTo);
  return await session.arrange.oauthState(response);
}

/**
 * Starts an invite-backed OAuth flow and extracts the state parameter.
 * Composes:
 * - requestOAuthSession() to mint an admin cookie for invite creation
 * - requestInvite() to issue the first-signin invite
 * - requestOAuthStart() with invite_code
 * - oauthState()
 */
export async function startInvitedOAuthAndGetState(
  session: TSessionAssistant,
  email: string,
  returnTo?: string,
): Promise<string> {
  const adminSession = await session.actions.requestOAuthSession();
  const adminCookieValue = await session.arrange.extractSessionCookieValueFromHeader(
    adminSession.headers()["set-cookie"] ?? "",
  );

  if (!adminCookieValue) {
    throw new Error(`Admin session cookie "${TestEnv.sessionCookieName}" not found in Set-Cookie header`);
  }

  const inviteResponse = await session.actions.requestInvite(
    email,
    "member",
    `${TestEnv.sessionCookieName}=${adminCookieValue}`,
  );
  const inviteBody = await inviteResponse.json() as { code?: string; error?: string; message?: string };
  if (!inviteResponse.ok() || !inviteBody.code) {
    throw new Error(
      `Invite creation failed: ${inviteResponse.status()} ${JSON.stringify(inviteBody)}`,
    );
  }

  const response = await session.actions.requestOAuthStart(returnTo, inviteBody.code);
  return await session.arrange.oauthState(response);
}

/**
 * Starts an OAuth flow, extracts state, and tampers with the HMAC signature.
 * Composes: requestOAuthStart() + oauthState() + tamperSignedValue()
 */
export async function startOAuthAndGetTamperedState(
  session: TSessionAssistant,
  returnTo?: string,
): Promise<string> {
  const state = await startOAuthAndGetState(session, returnTo);
  return await session.arrange.tamperSignedValue(state);
}
