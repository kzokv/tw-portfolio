/**
 * KZO-179 — HTTP API tests for POST /accounts.
 *
 * Covers the route's happy paths + Zod validation rejections + GET round-trip.
 *
 * NOT covered here (placement rationale):
 *   - 409 duplicate-name: routed to suite 5
 *     (`apps/api/test/integration/account-creation-uniqueness.integration.test.ts`)
 *     per `test-placement-persistence-backend.md` + design memo §6. The
 *     in-memory pre-check would technically fire here, but keeping the 409
 *     placement Postgres-side preserves the canonical
 *     "DB-enforced semantics live in suite 5" signal that the parent
 *     KZO-167 ticket established.
 *   - Form rendering / preview chip: suite 3 (web-unit).
 *   - Golden-path UI flow: suite 6 (E2E dev_bypass).
 *
 * Body-envelope contract (`service-error-pattern.md`): the route's
 * `routeError(...)` envelope serialises as `{ error: "<code>", message: "<text>" }`.
 * Reads use `body.error` for the machine-readable code; never `body.code`.
 *
 * Memory backend uses the seeded user with `acc-1` ("Main") + `fp-default`.
 */

import { test } from "../fixtures.js";

test.describe("POST /accounts (KZO-179)", () => {
  // ── Happy path + DTO shape ─────────────────────────────────────────────────

  test("happy path: returns 200 with bare AccountDto and resolves the default fee profile", async ({
    accountsApi,
  }) => {
    const response = await accountsApi.actions.createAccount({
      name: "USD Brokerage",
      defaultCurrency: "USD",
      accountType: "bank",
    });
    await accountsApi.assert.statusIs(response, 200);

    const body = (await accountsApi.arrange.body(response)) as Record<string, unknown>;

    // AccountDto fields per D7 — no envelope, no createdAt.
    await accountsApi.assert.fieldEquals(body, "name", "USD Brokerage");
    await accountsApi.assert.fieldEquals(body, "defaultCurrency", "USD");
    await accountsApi.assert.fieldEquals(body, "accountType", "bank");
    // Memory backend's default user has profile id "fp-default" (D5 cascade
    // step 3 — store.feeProfiles[0] when ${userId}-fp-default is absent).
    await accountsApi.assert.fieldEquals(body, "feeProfileId", "fp-default");
    // id (uuid) and userId are present.
    if (typeof body.id !== "string" || body.id.length < 16) {
      throw new Error(`Expected body.id to be a uuid string; got ${String(body.id)}`);
    }
    if (typeof body.userId !== "string" || body.userId.length === 0) {
      throw new Error(`Expected body.userId to be a non-empty string`);
    }

    // D2 / D7 — createdAt MUST NOT be exposed on the read DTO.
    if ("createdAt" in body) {
      throw new Error(`Expected body to NOT include 'createdAt'; received: ${JSON.stringify(body)}`);
    }
  });

  // ── Default fee-profile resolution (omitted body field) ────────────────────

  test("default fee-profile resolution when feeProfileId is omitted", async ({
    accountsApi,
  }) => {
    const response = await accountsApi.actions.createAccount({
      name: "TWD Wallet",
      defaultCurrency: "TWD",
      accountType: "wallet",
    });
    await accountsApi.assert.statusIs(response, 200);

    const body = (await accountsApi.arrange.body(response)) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(body, "feeProfileId", "fp-default");
  });

  // ── Explicit fee-profile resolution ────────────────────────────────────────

  test("explicit feeProfileId in body is honored", async ({
    accountsApi,
    feeProfilesApi,
  }) => {
    // Arrange — create a second profile via the fee-profiles route.
    const { feeProfilePayload } = await import("../../helpers/fixtures.js");
    const createProfileResponse = await feeProfilesApi.actions.createFeeProfile(
      feeProfilePayload({ name: "Alt" }),
    );
    await feeProfilesApi.assert.statusIs(createProfileResponse, 200);
    const profile = (await feeProfilesApi.arrange.body(createProfileResponse)) as Record<string, unknown>;
    const altProfileId = profile.id;
    if (typeof altProfileId !== "string") {
      throw new Error("Expected new fee profile id to be a string");
    }

    // Act
    const response = await accountsApi.actions.createAccount({
      name: "AUD Brokerage",
      defaultCurrency: "AUD",
      accountType: "broker",
      feeProfileId: altProfileId,
    });

    // Assert
    await accountsApi.assert.statusIs(response, 200);
    const body = (await accountsApi.arrange.body(response)) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(body, "feeProfileId", altProfileId);
  });

  // ── Validation rejections (Zod 400) ────────────────────────────────────────

  test("validation: empty name → 400", async ({ accountsApi }) => {
    const response = await accountsApi.actions.createAccount({
      name: "",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    await accountsApi.assert.statusIs(response, 400);
  });

  test("validation: name longer than 80 chars → 400", async ({ accountsApi }) => {
    const response = await accountsApi.actions.createAccount({
      name: "A".repeat(81),
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    await accountsApi.assert.statusIs(response, 400);
  });

  test("validation: defaultCurrency='EUR' (not in enum) → 400", async ({ accountsApi }) => {
    const response = await accountsApi.actions.createAccount({
      name: "Bad Currency",
      defaultCurrency: "EUR",
      accountType: "broker",
    });
    await accountsApi.assert.statusIs(response, 400);
  });

  test("validation: accountType='savings' (not in enum) → 400", async ({ accountsApi }) => {
    const response = await accountsApi.actions.createAccount({
      name: "Bad Type",
      defaultCurrency: "TWD",
      accountType: "savings",
    });
    await accountsApi.assert.statusIs(response, 400);
  });

  test("validation: missing defaultCurrency → 400", async ({ accountsApi }) => {
    const response = await accountsApi.actions.createAccount({
      name: "No Currency",
      accountType: "broker",
    });
    await accountsApi.assert.statusIs(response, 400);
  });

  test("validation: invalid feeProfileId reference (does not match any user profile) → 404 fee_profile_not_found", async ({
    accountsApi,
  }) => {
    // Memory-seeded user has only "fp-default"; supplying a valid-shape but
    // non-existent userScopedIdSchema-compatible id triggers `requireProfile`
    // (registerRoutes.ts:1117) which throws routeError(404,
    // "fee_profile_not_found", ...). Per `service-error-pattern.md` the body
    // envelope is `{ error, message }`; we read `body.error`, never `body.code`.
    const response = await accountsApi.actions.createAccount({
      name: "Bogus FP",
      defaultCurrency: "TWD",
      accountType: "broker",
      feeProfileId: "fp-does-not-exist",
    });
    await accountsApi.assert.statusIs(response, 404);
    const body = (await accountsApi.arrange.body(response)) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(body, "error", "fee_profile_not_found");
  });

  // ── Trim semantics (Zod .trim() chain at registerRoutes.ts:2504) ───────────

  test("trim: leading/trailing whitespace is stripped before persistence", async ({
    accountsApi,
  }) => {
    const response = await accountsApi.actions.createAccount({
      name: "  Padded Account  ",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    await accountsApi.assert.statusIs(response, 200);

    const body = (await accountsApi.arrange.body(response)) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(body, "name", "Padded Account");
  });

  // ── Round-trip via GET /accounts ───────────────────────────────────────────

  test("GET /accounts after POST reflects the new account with the same id and fields", async ({
    accountsApi,
  }) => {
    const createResponse = await accountsApi.actions.createAccount({
      name: "Round Trip",
      defaultCurrency: "AUD",
      accountType: "broker",
    });
    await accountsApi.assert.statusIs(createResponse, 200);
    const created = (await accountsApi.arrange.body(createResponse)) as Record<string, unknown>;
    const newId = created.id;
    if (typeof newId !== "string") {
      throw new Error("Expected created account id to be a string");
    }

    const listResponse = await accountsApi.actions.listAccounts();
    await accountsApi.assert.statusIs(listResponse, 200);
    const accounts = await accountsApi.arrange.accounts(listResponse);

    const found = accounts.find((account) => account["id"] === newId);
    if (!found) {
      throw new Error(`Expected GET /accounts to include the new account ${newId}`);
    }
    await accountsApi.assert.fieldEquals(found, "name", "Round Trip");
    await accountsApi.assert.fieldEquals(found, "defaultCurrency", "AUD");
    await accountsApi.assert.fieldEquals(found, "accountType", "broker");
  });
});
