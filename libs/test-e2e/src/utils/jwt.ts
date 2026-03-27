/**
 * Fabricates a deterministic JWT id_token for E2E tests.
 * Not cryptographically valid — uses a mock signature.
 */
export function makeDeterministicIdToken(overrides: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: "profile-e2e-sub",
      email: "profile-e2e@example.com",
      email_verified: true,
      name: "Profile E2E User",
      picture: "https://lh3.googleusercontent.com/profile-e2e.jpg",
      iss: "https://accounts.google.com",
      aud: "e2e-test-client-id",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...overrides,
    }),
  ).toString("base64url");
  return `${header}.${payload}.mock-sig`;
}
