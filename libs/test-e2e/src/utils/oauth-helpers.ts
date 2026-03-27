import type { TSessionAssistant } from "../assistants/auth/index.js";

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
