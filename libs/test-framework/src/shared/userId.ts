import { faker } from "@faker-js/faker";
import type { TestInfo } from "@playwright/test";

function buildAcronym(filename: string): string {
  const stem = (filename.split("/").pop() ?? "spec")
    .replace(/\.spec\.[jt]s$/, "")
    .replace(/\.[jt]s$/, "");
  return stem.split("-").map((segment) => segment[0] ?? "").join("").toLowerCase();
}

export function buildDisplayName(testInfo: TestInfo): string {
  const acronym = buildAcronym(testInfo.file);
  return `${acronym}:${testInfo.workerIndex}:${faker.person.firstName()}`;
}

export function buildE2EUserId(testInfo: TestInfo): string {
  const fileName = testInfo.file.split("/").pop() ?? "spec";
  const slug = `${fileName}-${testInfo.title}-${testInfo.workerIndex}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return `qa-${slug || "e2e"}`;
}
