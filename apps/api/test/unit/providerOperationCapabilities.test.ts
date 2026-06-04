import { describe, expect, it } from "vitest";
import { PROVIDER_OPERATION_ACTIONS } from "@vakwen/shared-types";
import {
  getProviderOperationCapability,
  listProviderOperationCapabilities,
} from "../../src/services/market-data/providerOperationCapabilities.js";

describe("provider operation capabilities", () => {
  it("exposes the locked action taxonomy for every provider", () => {
    const yahooKr = getProviderOperationCapability("yahoo-finance-kr");

    expect(yahooKr.actions.map((action) => action.action)).toEqual([...PROVIDER_OPERATION_ACTIONS]);
    expect(yahooKr).toMatchObject({
      providerId: "yahoo-finance-kr",
      supportsMappings: true,
      supportsRepair: true,
      supportsRenew: true,
      supportsRerun: true,
      supportsResolverModes: true,
    });
    expect(yahooKr.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "repair_mapping", supported: true, guardrail: "typed_preview" }),
        expect.objectContaining({ action: "revert_mapping", supported: true, guardrail: "typed_preview" }),
        expect.objectContaining({ action: "refresh_health", supported: true, guardrail: "none" }),
      ]),
    );
  });

  it("keeps unsupported actions visible with provider-specific reasons", () => {
    const twelveDataKr = getProviderOperationCapability("twelve-data-kr");

    expect(twelveDataKr).toMatchObject({
      supportsMappings: false,
      supportsRepair: false,
      supportsRenew: true,
      supportsRerun: false,
      emptyMappingReason:
        "Twelve Data KR is catalog evidence for KR bindings; Yahoo KR owns the durable provider mapping.",
    });
    expect(twelveDataKr.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "repair_mapping",
          supported: false,
          reason: "Twelve Data KR supplies catalog evidence; Yahoo Finance KR owns durable repair mappings.",
        }),
        expect.objectContaining({
          action: "rerun_backfill",
          supported: false,
          reason: "Twelve Data free-plan KR bars are plan-limited, so rerun is not available through this provider.",
        }),
      ]),
    );
  });

  it("deduplicates provider ids when listing capabilities", () => {
    expect(listProviderOperationCapabilities(["finmind-tw", "finmind-tw", "frankfurter"]).map((item) => item.providerId))
      .toEqual(["finmind-tw", "frankfurter"]);
  });
});
