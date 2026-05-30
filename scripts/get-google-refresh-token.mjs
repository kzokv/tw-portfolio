#!/usr/bin/env node

/**
 * get-google-refresh-token.mjs
 *
 * Standalone helper to obtain a Google OAuth refresh token for local E2E testing.
 * Reads GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from .env.local at the repo root,
 * starts a temporary HTTP server, opens the browser for Google consent, exchanges
 * the authorization code for tokens, and persists the refresh_token to .env.local.
 *
 * IMPORTANT: Before running this script, you must:
 *   1. Fill in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local
 *   2. Register http://localhost:9876/callback as an authorized redirect URI
 *      in your Google Cloud Console OAuth 2.0 client configuration.
 *
 * Usage:
 *   node scripts/get-google-refresh-token.mjs
 */

import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const envLocalPath = resolve(repoRoot, ".env.local");

const REDIRECT_URI = "http://localhost:9876/callback";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "openid email profile";
const PORT = 9876;

// ---------------------------------------------------------------------------
// Parse .env.local
// ---------------------------------------------------------------------------

function parseDotEnv(filePath) {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, "utf8");
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip inline comment
    const commentStart = value.indexOf(" #");
    if (commentStart !== -1) value = value.slice(0, commentStart).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const envVars = parseDotEnv(envLocalPath);

const clientId = envVars.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
const clientSecret = envVars.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("ERROR: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env.local (or environment).");
  console.error(`       Looked in: ${envLocalPath}`);
  process.exit(1);
}

// Build the authorization URL
const authParams = new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  response_type: "code",
  access_type: "offline",
  prompt: "consent", // forces refresh token issuance
  scope: SCOPE,
});
const authUrl = `${GOOGLE_AUTH_URL}?${authParams.toString()}`;

// Start the temporary HTTP server
const server = createServer(async (req, res) => {
  if (!req.url?.startsWith("/callback")) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<h1>Error</h1><p>Google returned an error: ${error}</p><p>You can close this window.</p>`);
    console.error(`\nGoogle returned an error: ${error}`);
    shutdown(1);
    return;
  }

  if (!code) {
    res.writeHead(400, { "content-type": "text/html" });
    res.end("<h1>Error</h1><p>No authorization code received.</p>");
    console.error("\nNo authorization code in callback.");
    shutdown(1);
    return;
  }

  // Exchange code for tokens
  try {
    const tokenBody = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    });

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error("\nToken exchange failed:", tokenData);
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<h1>Token Exchange Failed</h1><p>See terminal output for details.</p>");
      shutdown(1);
      return;
    }

    const refreshToken = tokenData.refresh_token;
    if (!refreshToken) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        "<h1>No Refresh Token</h1>" +
        "<p>Google did not return a refresh_token. This can happen if you already consented.</p>" +
        '<p>Try revoking access at <a href="https://myaccount.google.com/permissions">Google Account Permissions</a> and running again.</p>'
      );
      console.error("\nNo refresh_token in response. Revoke app access and try again.");
      shutdown(1);
      return;
    }

    // Write refresh token to .env.local
    updateEnvLocal("GOOGLE_OAUTH_REFRESH_TOKEN", refreshToken);

    res.writeHead(200, { "content-type": "text/html" });
    res.end(
      "<h1>Success!</h1>" +
      "<p>Refresh token saved to <code>.env.local</code>.</p>" +
      "<p>You can close this window.</p>"
    );
    console.log("\nRefresh token obtained and saved to .env.local");
    console.log("GOOGLE_OAUTH_REFRESH_TOKEN has been set.");
    shutdown(0);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/html" });
    res.end(`<h1>Error</h1><pre>${err.message}</pre>`);
    console.error("\nError during token exchange:", err);
    shutdown(1);
  }
});

function updateEnvLocal(key, value) {
  let content = "";
  if (existsSync(envLocalPath)) {
    content = readFileSync(envLocalPath, "utf8");
  }

  // Check if key already exists
  const lines = content.split(/\r?\n/);
  let found = false;
  const updatedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) return line;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) return line;
    const lineKey = trimmed.slice(0, eqIndex).trim();
    if (lineKey === key) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (found) {
    writeFileSync(envLocalPath, updatedLines.join("\n"), "utf8");
  } else {
    // Append
    const separator = content.endsWith("\n") ? "" : "\n";
    writeFileSync(envLocalPath, content + separator + `${key}=${value}\n`, "utf8");
  }
}

function shutdown(code) {
  const timer = setTimeout(() => process.exit(code), 2_000);
  server.close(() => { clearTimeout(timer); process.exit(code); });
}

server.listen(PORT, () => {
  console.log(`\nTemporary server listening on http://localhost:${PORT}`);
  console.log(`\nOpening browser for Google OAuth consent...`);
  console.log(`\nIf the browser doesn't open, visit this URL manually:\n${authUrl}\n`);

  // Open browser (platform-specific)
  const platform = process.platform;
  const openCmd =
    platform === "darwin" ? "open" :
    platform === "win32" ? "start" :
    "xdg-open";
  exec(`${openCmd} "${authUrl}"`, (err) => {
    if (err) console.error(`\nCould not open browser automatically. Please visit:\n${authUrl}\n`);
  });
});
