import { transactionPayload } from "../../helpers/fixtures.js";
import { test } from "../fixtures.js";
import { seedSingleAnonymousShareToken } from "./helpers/anonymousShare.js";
import { createOauthSession } from "./helpers/sharing.js";

async function seedPublicViewPortfolio(
  ownerCookie: string,
  transactionsApi: {
    actions: {
      createTransactionForCookie: (
        cookie: string,
        contextUserId: string | undefined,
        data: unknown,
        idempotencyKey: string,
      ) => Promise<unknown>;
    };
  },
  quotesApi: {
    actions: {
      seedDailyBars: (bars: Array<{
        ticker: string;
        barDate: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        source?: string;
      }>) => Promise<unknown>;
    };
  },
) {
  await transactionsApi.actions.createTransactionForCookie(
    ownerCookie,
    undefined,
    transactionPayload({
      ticker: "6770",
      quantity: 100,
      unitPrice: 500,
      priceCurrency: "TWD",
      tradeDate: "2026-01-02",
    }),
    "anon-public-view-6770-buy",
  );
  await transactionsApi.actions.createTransactionForCookie(
    ownerCookie,
    undefined,
    transactionPayload({
      ticker: "5880",
      quantity: 10,
      unitPrice: 800,
      priceCurrency: "TWD",
      tradeDate: "2026-01-03",
    }),
    "anon-public-view-5880-buy",
  );
  await transactionsApi.actions.createTransactionForCookie(
    ownerCookie,
    undefined,
    transactionPayload({
      ticker: "6669",
      quantity: 4,
      unitPrice: 25,
      priceCurrency: "TWD",
      tradeDate: "2026-01-04",
    }),
    "anon-public-view-6669-buy",
  );
  await transactionsApi.actions.createTransactionForCookie(
    ownerCookie,
    undefined,
    transactionPayload({
      ticker: "6669",
      quantity: 4,
      unitPrice: 30,
      priceCurrency: "TWD",
      tradeDate: "2026-01-05",
      type: "SELL",
    }),
    "anon-public-view-6669-sell",
  );

  await quotesApi.actions.seedDailyBars([
    {
      ticker: "6770",
      barDate: "2026-04-18",
      open: 610,
      high: 610,
      low: 610,
      close: 610,
      volume: 1000,
    },
    {
      ticker: "5880",
      barDate: "2026-04-18",
      open: 920,
      high: 920,
      low: 920,
      close: 920,
      volume: 1000,
    },
    {
      ticker: "6669",
      barDate: "2026-04-18",
      open: 15,
      high: 15,
      low: 15,
      close: 15,
      volume: 1000,
    },
  ]);
}

test.describe("anonymous public view: dto contract", () => {
  test("[anon public view]: active token fetches public dto → forbidden fields hidden, zero qty filtered, sorted, per-currency summary present", async ({
    request,
    sessionApi,
    anonymousShareTokensApi,
    transactionsApi,
    quotesApi,
  }) => {
    const namedOwner = await createOauthSession(request, {
      sub: "anon-public-named-owner-sub",
      email: "anon-public-named-owner@example.com",
      name: "Named Public Owner",
      role: "member",
    });

    await seedPublicViewPortfolio(namedOwner.cookieHeader, transactionsApi, quotesApi);

    const namedToken = await seedSingleAnonymousShareToken(request, {
      ownerUserId: namedOwner.userId,
      expiresInDays: 30,
    });
    const namedResponse = await anonymousShareTokensApi.actions.fetchPublicView(namedToken.token);
    await anonymousShareTokensApi.assert.statusIs(namedResponse, 200);
    await anonymousShareTokensApi.assert.headerEquals(
      namedResponse,
      "cache-control",
      "private, no-store, max-age=0",
    );

    const namedBody = await anonymousShareTokensApi.arrange.publicViewBody(namedResponse);
    await anonymousShareTokensApi.assert.publicViewShapeIsValid(namedBody);
    await anonymousShareTokensApi.assert.publicViewExcludesForbiddenFields(namedBody);
    await anonymousShareTokensApi.assert.publicViewHasNoZeroQuantityRows(namedBody);
    await anonymousShareTokensApi.assert.publicViewSortedByMarketValueDesc(namedBody);
    await anonymousShareTokensApi.assert.publicViewContainsTicker(namedBody, "6770");
    await anonymousShareTokensApi.assert.publicViewContainsTicker(namedBody, "5880");
    await anonymousShareTokensApi.assert.mxAssertTruthy(
      !namedBody.holdings.some((holding) => holding.ticker === "6669"),
      "zero-quantity holding is filtered",
    );
    await anonymousShareTokensApi.assert.mxAssertEqual(
      namedBody.ownerDisplayName,
      "Named Public Owner",
      "owner display name uses profile display name when present",
    );
    await anonymousShareTokensApi.assert.mxAssertTruthy(
      namedBody.summary.totalValueByCurrency.some((row) => row.currency === "TWD"),
      "summary includes TWD total bucket",
    );
    await anonymousShareTokensApi.assert.mxAssertTruthy(
      namedBody.summary.returnByCurrency.some((row) => row.currency === "TWD"),
      "summary includes TWD return bucket",
    );

    const noNameSession = await sessionApi.actions.createOauthSessionForClaims({
      sub: "anon-public-prefix-owner-sub",
      email: "prefix-fallback@example.com",
    });
    const noNameCookie = await sessionApi.arrange.sessionCookieHeader(noNameSession);
    const noNameUserId = await sessionApi.arrange.sessionCookieUserId(noNameCookie);

    await seedPublicViewPortfolio(noNameCookie, transactionsApi, quotesApi);
    const noNameToken = await seedSingleAnonymousShareToken(request, {
      ownerUserId: noNameUserId,
      expiresInDays: 30,
    });

    const prefixResponse = await anonymousShareTokensApi.actions.fetchPublicView(noNameToken.token);
    const prefixBody = await anonymousShareTokensApi.arrange.publicViewBody(prefixResponse);
    await anonymousShareTokensApi.assert.mxAssertEqual(
      prefixBody.ownerDisplayName,
      "prefix-fallback",
      "owner display name falls back to email prefix when display name is absent",
    );
  });
});
