import { describe, expect, it } from "vitest";
import { adminI18n } from "../../components/admin/admin-i18n";
import { getRouteLoadingLabels, layoutI18n } from "../../components/layout/i18n";
import { sharingI18n } from "../../features/sharing/i18n";
import { commonI18n } from "../../lib/i18n/common";

function collectLeafPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectLeafPaths(entry, `${prefix}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([key, entry]) => collectLeafPaths(entry, prefix ? `${prefix}.${key}` : key));
  }
  return [prefix];
}

function expectLocaleParity(name: string, enValue: unknown, zhTwValue: unknown) {
  expect(
    collectLeafPaths(zhTwValue),
    `${name} must keep the same leaf-key shape in en and zh-TW`,
  ).toEqual(collectLeafPaths(enValue));
}

describe("i18n guardrails", () => {
  it("keeps layout shell dictionaries in en/zh-TW parity", () => {
    expectLocaleParity("layoutI18n", layoutI18n.en, layoutI18n["zh-TW"]);
  });

  it("keeps route loading dictionaries in en/zh-TW parity", () => {
    expectLocaleParity("routeLoadingLabels", getRouteLoadingLabels("en"), getRouteLoadingLabels("zh-TW"));
  });

  it("keeps common error/action dictionaries in en/zh-TW parity", () => {
    expectLocaleParity("commonI18n", commonI18n.en, commonI18n["zh-TW"]);
  });

  it("keeps admin dictionaries in en/zh-TW parity", () => {
    expectLocaleParity("adminI18n", adminI18n.en, adminI18n["zh-TW"]);
  });

  it("keeps sharing capability labels in en/zh-TW parity", () => {
    expectLocaleParity(
      "sharing capabilityLabels",
      sharingI18n.en.sharing.capabilityLabels,
      sharingI18n["zh-TW"].sharing.capabilityLabels,
    );
  });
});
