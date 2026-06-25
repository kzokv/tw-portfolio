import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

const SCAN_TARGETS = [
  "apps/web/components/layout/ThemeToggle.tsx",
  "apps/web/components/layout/CommandPaletteTrigger.tsx",
  "apps/web/components/layout/SidebarResizeRail.tsx",
  "apps/web/components/connectors/scopeLabels.ts",
  "apps/web/components/chatgpt/ChatGptTransactionDraftWidget.tsx",
  "apps/web/components/chatgpt/ChatGptAccountManagerWidget.tsx",
  "apps/web/components/transactions/AiInboxPanel.tsx",
] as const;

const EXACT_ALLOWLIST = new Set([
  "",
  "AI",
  "API",
  "Apps",
  "ASX",
  "AU",
  "BUY",
  "CSS",
  "ChatGPT",
  "Google",
  "KR",
  "KRW",
  "KRX",
  "MCP",
  "NASDAQ",
  "NYSE",
  "OAuth",
  "SELL",
  "TWD",
  "TW",
  "TWSE",
  "US",
  "USD",
  "Vakwen",
  "Yahoo",
  "use client",
  "Enter",
  "ArrowLeft",
  "ArrowRight",
]);

const TECHNICAL_NOUN_PATTERN = /\b(?:AI|API|Apps|ASX|AU|ChatGPT|CSS|FX|Google|KR|KRW|KRX|MCP|NASDAQ|NYSE|OAuth|TWD|TW|TWSE|US|USD|Vakwen|Yahoo)\b/g;

function normalizeLiteral(value: string): string {
  return value
    .replace(/\$\{[^}]+\}/g, "{expr}")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldIgnoreLiteral(value: string): boolean {
  if (!/[A-Za-z]/.test(value)) return true;
  if (/^\{expr\}(?:\s*[/: -]\s*\{expr\})*$/.test(value)) return true;
  if (EXACT_ALLOWLIST.has(value)) return true;
  const latinRemainder = value.replace(TECHNICAL_NOUN_PATTERN, "").replace(/[^A-Za-z]+/g, "");
  if (latinRemainder.length === 0) return true;
  if (/[<>]/.test(value)) return true;
  if (/(?:className|href|src|target|rel|on[A-Z][A-Za-z]+)=/.test(value)) return true;
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) return true;
  if (/^https?:\/\//.test(value)) return true;
  if (/^[a-z][a-z0-9:_-]*$/i.test(value) && !/[A-Z]/.test(value)) return true;
  if (/^[a-z0-9:_-]+$/i.test(value) && (value.includes("/") || value.includes(":") || value.includes("-") || value.includes("_"))) return true;
  if (/^(?:[A-Z]{2,}|[A-Z][a-z]+)(?:\s+(?:[A-Z]{2,}|[A-Z][a-z]+))*$/.test(value)) {
    const words = value.split(/\s+/);
    if (words.every((word) => EXACT_ALLOWLIST.has(word))) return true;
  }
  if (!/\s/.test(value) && !/^[A-Z][A-Za-z]+(?:[ -][A-Z][A-Za-z]+)*$/.test(value)) return true;
  if (/(?:^|\s)(?:after:|bg-|border-|data-\[|flex|focus-visible:|gap-|grid|group-data-\[|h-|hover:|items-|justify-|lg:|max-|mb-|md:|min-|ml-|mr-|mt-|mx-|my-|px-|py-|rounded|shadow|sm:|text-|tracking-|w-|xl:|2xl:)/.test(value)) return true;
  if (value.includes("data-testid") || value.includes("aria-hidden")) return true;
  if (value.includes("http://") || value.includes("https://")) return true;
  if (/^[A-Z0-9_:. -]+$/.test(value) && !/[a-z]/.test(value)) return true;
  if (/^POST \{expr\} TRADES$/.test(value)) return true;
  return false;
}

function isExplicitLocaleBranch(scanSource: string, matchIndex: number): boolean {
  const before = scanSource.slice(Math.max(0, matchIndex - 240), matchIndex);
  return /(?:resolvedLocale|locale)\s*={0,2}=+\s*"zh-TW"[\s\S]*[?:][\s\S]*$/.test(before);
}

function extractForbiddenEnglishLiterals(relativePath: string): string[] {
  const source = readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
  const scanSource = source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/\/\/.*$/gm, "");
  const matches = [...scanSource.matchAll(/(["`])((?:\\.|(?!\1)[\s\S])*?)\1/g)];
  const findings: string[] = [];

  for (const match of matches) {
    const literal = normalizeLiteral(match[2] ?? "");
    if (shouldIgnoreLiteral(literal)) continue;
    if (isExplicitLocaleBranch(scanSource, match.index ?? 0)) continue;

    const prefix = scanSource.slice(0, match.index ?? 0);
    const line = prefix.split("\n").length;
    findings.push(`${relativePath}:${line} -> ${literal}`);
  }

  return findings;
}

describe("hardcoded English guardrail", () => {
  it("keeps high-risk i18n scope files free of frontend-owned English literals", () => {
    const findings = SCAN_TARGETS.flatMap((relativePath) => extractForbiddenEnglishLiterals(relativePath));

    expect(
      findings,
      findings.length === 0
        ? undefined
        : `Move these literals into locale-aware dictionaries or extend the scan allowlist for approved technical nouns only:\n${findings.slice(0, 80).join("\n")}`,
    ).toEqual([]);
  });
});
