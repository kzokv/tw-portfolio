/**
 * HTTP/AAA tests for KZO-168 FX transfers.
 *
 * Reserved FX-rate fixture dates for this spec: 2026-04-06..2026-04-08.
 * Keep any new currency-pair/date tuples inside that range to avoid collisions
 * with other FX-rate tests sharing the memory backend.
 */
import type { APIRequestContext } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import type {
  TDividendsApiAssistant,
  TFxTransfersApiAssistant,
} from "@vakwen/test-api/assistants";
import {
  dividendPostingPayload,
  seededDividendEventPayload,
} from "../../helpers/fixtures.js";
import { test } from "../fixtures.js";

const FX_DATE = "2026-04-06";

function apiPath(path: string): string {
  return new URL(path, TestEnv.apiBaseUrl).href;
}

async function resetAndSeedFxRates(
  request: APIRequestContext,
  cookie: string,
  fxTransfersApi: TFxTransfersApiAssistant,
): Promise<void> {
  await request.post(apiPath("/__e2e/reset-fx-rates"), { headers: { cookie } });
  const response = await request.post(apiPath("/__e2e/seed-fx-rates"), {
    headers: { cookie },
    data: {
      rates: [
        {
          date: FX_DATE,
          baseCurrency: "TWD",
          quoteCurrency: "USD",
          rate: 0.032,
          source: "e2e-fx-transfer",
        },
      ],
    },
  });
  await fxTransfersApi.assert.statusIs(response, 200);
}

async function fetchCashLedger(
  request: APIRequestContext,
  cookie: string,
  fxTransfersApi: TFxTransfersApiAssistant,
): Promise<Record<string, unknown>> {
  const url = new URL(apiPath("/portfolio/cash-ledger"));
  url.searchParams.append("entryType", "FX_TRANSFER_OUT");
  url.searchParams.append("entryType", "FX_TRANSFER_IN");
  url.searchParams.append("entryType", "REVERSAL");
  url.searchParams.set("limit", "20");
  const response = await request.get(url.href, { headers: { cookie } });
  await fxTransfersApi.assert.statusIs(response, 200);
  return (await response.json()) as Record<string, unknown>;
}

async function fundTwdAccount(
  dividendsApi: TDividendsApiAssistant,
): Promise<void> {
  const seedResponse = await dividendsApi.actions.seedDividendEvent(
    seededDividendEventPayload({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-04-05",
      paymentDate: FX_DATE,
      cashDividendPerShare: 0.01,
      eligibleQuantity: 0,
    }),
  );
  await dividendsApi.assert.statusIs(seedResponse, 200);
  const eventId = await dividendsApi.arrange.seededDividendEventId(
    await dividendsApi.arrange.seedBody(seedResponse),
  );

  const postResponse = await dividendsApi.actions.createOrUpdatePosting(
    dividendPostingPayload({
      dividendEventId: eventId,
      receivedCashAmount: 5000,
      deductions: [],
      sourceLines: [
        {
          sourceBucket: "DIVIDEND_INCOME",
          amount: 5000,
          currencyCode: "TWD",
          source: "e2e_fx_transfer_funding",
        },
      ],
    }),
  );
  await dividendsApi.assert.statusIs(postResponse, 200);
}

test.describe("FX transfers (KZO-168)", () => {
  test.beforeEach(async ({ request, testUser, fxTransfersApi }) => {
    await resetAndSeedFxRates(request, testUser.sessionCookie!, fxTransfersApi);
  });

  test("[create]: TWD to USD transfer creates linked cash-ledger legs", async ({
    accountsApi,
    dividendsApi,
    fxTransfersApi,
    request,
    testUser,
  }) => {
    await fundTwdAccount(dividendsApi);
    const usdAccountResponse = await accountsApi.actions.createAccount({
      name: "USD Settlement",
      defaultCurrency: "USD",
      accountType: "bank",
    });
    await accountsApi.assert.statusIs(usdAccountResponse, 200);
    const usdAccount = (await accountsApi.arrange.body(usdAccountResponse)) as Record<string, unknown>;

    const input = {
      fromAccountId: "acc-1",
      toAccountId: String(usdAccount.id),
      fromAmount: 1000,
      toAmount: 32,
      effectiveRate: 0.032,
      entryDate: FX_DATE,
      notes: "HTTP AAA create",
    };

    const estimateResponse = await fxTransfersApi.actions.estimateFxTransfer(input);
    await fxTransfersApi.assert.statusIs(estimateResponse, 200);
    const estimate = await fxTransfersApi.arrange.fxTransferBody(estimateResponse);
    await fxTransfersApi.assert.fieldEquals(estimate, "midRateAvailable", true);
    await fxTransfersApi.assert.fieldEquals(estimate, "toleranceState", "safe");
    await fxTransfersApi.assert.fieldEquals(estimate, "insufficientBalance", false);

    const createResponse = await fxTransfersApi.actions.createFxTransfer(input);
    await fxTransfersApi.assert.statusIs(createResponse, 200);
    const fxTransferId = await fxTransfersApi.arrange.fxTransferId(createResponse);

    const ledger = await fetchCashLedger(request, testUser.sessionCookie!, fxTransfersApi);
    const entries = ledger.entries as Array<Record<string, unknown>>;
    const fxRows = entries.filter((entry) => entry.fxTransferId === fxTransferId);
    await fxTransfersApi.assert.mxAssertEqual(fxRows.length, 2, "linked FX cash ledger row count");
    await fxTransfersApi.assert.mxAssertDeepEqual(
      fxRows.map((entry) => entry.entryType).sort(),
      ["FX_TRANSFER_IN", "FX_TRANSFER_OUT"],
      "linked FX cash ledger row types",
    );
    await fxTransfersApi.assert.mxAssertTruthy(
      fxRows.every((entry) => typeof entry.fxTransferDetail === "object"),
      "all FX rows include paired detail",
    );
  });

  test("[validation]: out-of-band rate surfaces toleranceState='block' on estimate and rejects 400 on create", async ({
    accountsApi,
    dividendsApi,
    fxTransfersApi,
  }) => {
    await fundTwdAccount(dividendsApi);
    const usdAccountResponse = await accountsApi.actions.createAccount({
      name: "USD Validation",
      defaultCurrency: "USD",
      accountType: "bank",
    });
    await accountsApi.assert.statusIs(usdAccountResponse, 200);
    const usdAccount = (await accountsApi.arrange.body(usdAccountResponse)) as Record<string, unknown>;

    const input = {
      fromAccountId: "acc-1",
      toAccountId: String(usdAccount.id),
      fromAmount: 1000,
      toAmount: 40,
      effectiveRate: 0.04,
      entryDate: FX_DATE,
    };

    // Estimate must return 200 with `toleranceState: "block"` so the form's
    // gauge can render the "outside the allowed band" copy. The 400 lives on
    // create/update only.
    const estimateResponse = await fxTransfersApi.actions.estimateFxTransfer(input);
    await fxTransfersApi.assert.statusIs(estimateResponse, 200);
    const estimate = await fxTransfersApi.arrange.fxTransferBody(estimateResponse);
    await fxTransfersApi.assert.fieldEquals(estimate, "toleranceState", "block");

    const createResponse = await fxTransfersApi.actions.createFxTransfer(input);
    await fxTransfersApi.assert.statusIs(createResponse, 400);
    const body = await fxTransfersApi.arrange.fxTransferBody(createResponse);
    await fxTransfersApi.assert.fieldEquals(body, "error", "fx_transfer_rate_out_of_tolerance");
  });

  test("[lifecycle]: edit then reverse succeeds and reverse-then-edit is blocked", async ({
    accountsApi,
    dividendsApi,
    fxTransfersApi,
    request,
    testUser,
  }) => {
    await fundTwdAccount(dividendsApi);
    const usdAccountResponse = await accountsApi.actions.createAccount({
      name: "USD Lifecycle",
      defaultCurrency: "USD",
      accountType: "bank",
    });
    await accountsApi.assert.statusIs(usdAccountResponse, 200);
    const usdAccount = (await accountsApi.arrange.body(usdAccountResponse)) as Record<string, unknown>;

    const createResponse = await fxTransfersApi.actions.createFxTransfer({
      fromAccountId: "acc-1",
      toAccountId: String(usdAccount.id),
      fromAmount: 1000,
      toAmount: 32,
      effectiveRate: 0.032,
      entryDate: FX_DATE,
    });
    await fxTransfersApi.assert.statusIs(createResponse, 200);
    const fxTransferId = await fxTransfersApi.arrange.fxTransferId(createResponse);

    const patchResponse = await fxTransfersApi.actions.patchFxTransfer(fxTransferId, {
      fromAmount: 500,
      toAmount: 16,
      effectiveRate: 0.032,
      entryDate: FX_DATE,
      notes: "edited",
    });
    await fxTransfersApi.assert.statusIs(patchResponse, 200);

    const reverseResponse = await fxTransfersApi.actions.reverseFxTransfer(fxTransferId, {
      reason: "HTTP lifecycle test",
    });
    await fxTransfersApi.assert.statusIs(reverseResponse, 200);

    const secondPatchResponse = await fxTransfersApi.actions.patchFxTransfer(fxTransferId, {
      fromAmount: 400,
      toAmount: 12.8,
      effectiveRate: 0.032,
      entryDate: FX_DATE,
    });
    await fxTransfersApi.assert.statusIs(secondPatchResponse, 409);
    const blocked = await fxTransfersApi.arrange.fxTransferBody(secondPatchResponse);
    await fxTransfersApi.assert.fieldEquals(blocked, "error", "fx_transfer_already_reversed");

    const ledger = await fetchCashLedger(request, testUser.sessionCookie!, fxTransfersApi);
    const entries = ledger.entries as Array<Record<string, unknown>>;
    const rows = entries.filter((entry) => entry.fxTransferId === fxTransferId);
    await fxTransfersApi.assert.mxAssertEqual(
      rows.filter((entry) => entry.entryType === "REVERSAL").length,
      2,
      "FX reversal row count",
    );
  });
});
