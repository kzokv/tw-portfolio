import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import type { OAuthClaims } from "../../src/persistence/types.js";

describe("resolveOrCreateUser", () => {
  let persistence: MemoryPersistence;

  const googleClaims: OAuthClaims = {
    email: "alice@example.com",
    name: "Alice Chen",
    picture: "https://lh3.googleusercontent.com/alice.jpg",
  };

  beforeEach(async () => {
    persistence = new MemoryPersistence();
    await persistence.init();
  });

  afterEach(async () => {
    await persistence.close();
  });

  it("creates a new user and returns a UUID on first login", async () => {
    const { userId } = await persistence.resolveOrCreateUser("google", "google-sub-001", googleClaims);

    expect(userId).toBeTruthy();
    // UUID v4 format: 8-4-4-4-12 hex chars
    expect(userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("returns the same UUID for an existing user with the same email", async () => {
    const { userId: firstId } = await persistence.resolveOrCreateUser("google", "google-sub-001", googleClaims);
    const { userId: secondId } = await persistence.resolveOrCreateUser("google", "google-sub-001", googleClaims);

    expect(secondId).toBe(firstId);
  });

  it("seeds display_name from Google on first login and surfaces it in store settings", async () => {
    const { userId } = await persistence.resolveOrCreateUser("google", "google-sub-001", googleClaims);

    const store = await persistence.loadStore(userId);
    expect(store.userId).toBe(userId);
    expect(store.settings.displayName).toBe("Alice Chen");
  });

  it("updates display_name from Google on subsequent login", async () => {
    const { userId } = await persistence.resolveOrCreateUser("google", "google-sub-001", googleClaims);

    // Log in again with updated name
    const updatedClaims: OAuthClaims = { ...googleClaims, name: "Alice Chen-Smith" };
    const { userId: sameId } = await persistence.resolveOrCreateUser("google", "google-sub-001", updatedClaims);

    expect(sameId).toBe(userId);
    const store = await persistence.loadStore(userId);
    expect(store.settings.displayName).toBe("Alice Chen-Smith");
  });

  it("different email in claims creates a new user (email is the identity key)", async () => {
    const { userId: aliceId } = await persistence.resolveOrCreateUser("google", "google-sub-001", googleClaims);

    // Same Google sub but different email → treated as a new user
    const differentEmailClaims: OAuthClaims = { ...googleClaims, email: "newalice@example.com" };
    const { userId: newId } = await persistence.resolveOrCreateUser("google", "google-sub-001", differentEmailClaims);

    expect(newId).not.toBe(aliceId);
  });

  it("updates provider_subject when sub changes for the same email", async () => {
    const { userId } = await persistence.resolveOrCreateUser("google", "google-sub-001", googleClaims);

    // Same email, different Google sub (account recreated)
    const { userId: secondId } = await persistence.resolveOrCreateUser("google", "google-sub-002", googleClaims);

    expect(secondId).toBe(userId);
    // Verify provider_subject was actually updated in the identity store.
    // MemoryPersistence stores this in the private usersByEmail map; cast to access it in this unit test.
    // Integration tests cover this behaviour at the DB level via postgres persistence.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const memUser = (persistence as any).usersByEmail.get(googleClaims.email);
    expect(memUser?.providerSubject).toBe("google-sub-002");
  });

  it("does not enforce emailVerified — that check is the caller's responsibility (route-level guard)", async () => {
    // resolveOrCreateUser itself does not check emailVerified.
    // The guard lives in the /auth/google/callback route handler (registerRoutes.ts),
    // which rejects unverified emails before calling this function.
    // Integration tests cover the route-level rejection path.
    const { userId } = await persistence.resolveOrCreateUser("google", "sub-unverified", {
      email: "unverified@example.com",
      emailVerified: false,
    });
    expect(userId).toBeTruthy();
    expect(userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("creates a different user for a different email", async () => {
    const { userId: aliceId } = await persistence.resolveOrCreateUser("google", "google-sub-001", googleClaims);

    const bobClaims: OAuthClaims = {
      email: "bob@example.com",
      name: "Bob Lee",
      picture: "https://lh3.googleusercontent.com/bob.jpg",
    };
    const { userId: bobId } = await persistence.resolveOrCreateUser("google", "google-sub-002", bobClaims);

    expect(bobId).not.toBe(aliceId);
  });
});

describe("ensureDefaultPortfolioData (dev_bypass)", () => {
  let persistence: MemoryPersistence;

  beforeEach(async () => {
    persistence = new MemoryPersistence();
    await persistence.init();
  });

  afterEach(async () => {
    await persistence.close();
  });

  it("creates default store for arbitrary userId without resolveOrCreateUser", async () => {
    // In dev_bypass mode, loadStore triggers ensureDefaultPortfolioData
    await persistence.ensureDefaultPortfolioData("dev-user-1");
    const store = await persistence.loadStore("dev-user-1");

    expect(store.userId).toBe("dev-user-1");
    expect(store.accounts.length).toBeGreaterThan(0);
  });

  it("ensureDefaultPortfolioData is idempotent", async () => {
    await persistence.ensureDefaultPortfolioData("dev-user-2");
    await persistence.ensureDefaultPortfolioData("dev-user-2");

    const store = await persistence.loadStore("dev-user-2");
    expect(store.userId).toBe("dev-user-2");
  });
});
