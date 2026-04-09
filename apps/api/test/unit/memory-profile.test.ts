import { beforeEach, describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";

describe("MemoryPersistence getProfile / updateProfileEmail", () => {
  let persistence: MemoryPersistence;

  beforeEach(async () => {
    persistence = new MemoryPersistence();
    await persistence.init();
  });

  it("getProfile returns profile for an existing user", async () => {
    const userId = await persistence.resolveOrCreateUser("google", "sub-1", {
      email: "alice@example.com",
      name: "Alice Chen",
      picture: "https://lh3.googleusercontent.com/alice.jpg",
    });

    const profile = await persistence.getProfile(userId);

    expect(profile.userId).toBe(userId);
    expect(profile.email).toBe("alice@example.com");
    expect(profile.displayName).toBe("Alice Chen");
    expect(profile.providerPictureUrl).toBe("https://lh3.googleusercontent.com/alice.jpg");
    expect(profile.providerDisplayName).toBe("Alice Chen");
    expect(profile.linkedAt).toBeNull();
    expect(profile.lastSeenAt).toBeNull();
  });

  it("getProfile throws for non-existent userId", async () => {
    await expect(persistence.getProfile("non-existent-id")).rejects.toThrow(/not found/i);
  });

  it("updateProfileEmail changes the user email and returns updated profile", async () => {
    const userId = await persistence.resolveOrCreateUser("google", "sub-2", {
      email: "bob@example.com",
      name: "Bob",
    });

    const updated = await persistence.updateProfileEmail(userId, "bob-new@example.com");

    expect(updated.email).toBe("bob-new@example.com");
    expect(updated.userId).toBe(userId);
    expect(updated.displayName).toBe("Bob");
  });

  it("updateProfileEmail re-keys the map so subsequent lookups work", async () => {
    const userId = await persistence.resolveOrCreateUser("google", "sub-3", {
      email: "carol@example.com",
      name: "Carol",
    });

    await persistence.updateProfileEmail(userId, "carol-updated@example.com");

    // getProfile should still find the user
    const profile = await persistence.getProfile(userId);
    expect(profile.email).toBe("carol-updated@example.com");
  });

  it("updateProfileEmail throws for non-existent userId", async () => {
    await expect(persistence.updateProfileEmail("non-existent", "x@test.com")).rejects.toThrow(/not found/i);
  });

  it("updateProfileEmail throws 409 when email belongs to another user", async () => {
    await persistence.resolveOrCreateUser("google", "sub-conflict-a", {
      email: "taken@example.com",
      name: "User A",
    });

    const userIdB = await persistence.resolveOrCreateUser("google", "sub-conflict-b", {
      email: "free@example.com",
      name: "User B",
    });

    const error = await persistence.updateProfileEmail(userIdB, "taken@example.com").catch((e) => e);
    expect(error).toHaveProperty("statusCode", 409);
    expect(error).toHaveProperty("code", "email_conflict");
  });

  it("getProfile returns null provider fields when claims have no picture", async () => {
    const userId = await persistence.resolveOrCreateUser("google", "sub-4", {
      email: "dan@example.com",
    });

    const profile = await persistence.getProfile(userId);
    expect(profile.displayName).toBeNull();
    expect(profile.providerPictureUrl).toBeNull();
    expect(profile.providerDisplayName).toBeNull();
  });

  it("getProfile returns seeded user-1 when seedDevBypassUser is enabled", async () => {
    const seeded = new MemoryPersistence({ seedDevBypassUser: true });
    await seeded.init();
    const profile = await seeded.getProfile("user-1");
    expect(profile.userId).toBe("user-1");
    expect(profile.email).toBe("user-1@placeholder.local");
    expect(profile.displayName).toBeNull();
    expect(profile.providerPictureUrl).toBeNull();
    expect(profile.providerDisplayName).toBeNull();
    expect(profile.linkedAt).toBeNull();
    expect(profile.lastSeenAt).toBeNull();
  });
});
