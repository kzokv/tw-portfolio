import http from "node:http";

const port = Number(process.env.MOCK_OAUTH_PORT ?? 4445);

const jwtHeader = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
const jwtPayload = Buffer.from(
  JSON.stringify({
    sub: "e2e-google-sub-001",
    email: "e2e-user@example.com",
    name: "E2E Test User",
    email_verified: true,
    iss: "https://accounts.google.com",
    aud: "e2e-test-client-id",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  }),
).toString("base64url");
const mockIdToken = `${jwtHeader}.${jwtPayload}.mock-e2e-sig`;

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/token") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const params = new URLSearchParams(body);
      const grantType = params.get("grant_type");

      if (grantType === "authorization_code") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            access_token: "mock-e2e-access-token",
            id_token: mockIdToken,
            refresh_token: "mock-e2e-refresh-token",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "openid email profile",
          }),
        );
        return;
      }

      if (grantType === "refresh_token") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            access_token: "mock-e2e-refreshed-access-token",
            expires_in: 3600,
            token_type: "Bearer",
          }),
        );
        return;
      }

      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unsupported_grant_type" }));
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(port, "0.0.0.0", () => {
  process.stderr.write(`Mock OAuth server listening on http://localhost:${port}\n`);
});
