import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const AMBIGUOUS = new Set(["O", "I", "L", "U"]);

describe("invite code generator (observed via createInvite)", () => {
  let persistence: MemoryPersistence;

  beforeEach(() => {
    persistence = new MemoryPersistence();
  });

  afterEach(async () => {
    await persistence.close();
  });

  it("produces 8-character uppercase codes", async () => {
    // Arrange
    const input = {
      email: "a@example.com",
      role: "member" as const,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      issuedByUserId: null,
    };

    // Act
    const invite = await persistence.createInvite(input);

    // Assert
    expect(invite.code).toHaveLength(8);
    expect(invite.code).toBe(invite.code.toUpperCase());
  });

  it("uses only Crockford base32 alphabet — no 0/O/1/I/l confusables", async () => {
    // Arrange
    const samples: string[] = [];

    // Act — generate a large sample to make alphabet violations statistically detectable
    for (let i = 0; i < 100; i += 1) {
      const invite = await persistence.createInvite({
        email: `user-${i}@example.com`,
        role: "member",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        issuedByUserId: null,
      });
      samples.push(invite.code);
    }

    // Assert — every character of every code must be in the Crockford alphabet
    for (const code of samples) {
      for (const ch of code) {
        expect(CROCKFORD_BASE32.includes(ch)).toBe(true);
        expect(AMBIGUOUS.has(ch)).toBe(false);
      }
    }
  });

  it("generates unique codes across a realistic batch (no visible collisions)", async () => {
    // Arrange + Act
    const codes = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const invite = await persistence.createInvite({
        email: `u${i}@example.com`,
        role: "member",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        issuedByUserId: null,
      });
      codes.add(invite.code);
    }

    // Assert
    expect(codes.size).toBe(200);
  });
});
