#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_RULESET_PATH = new URL("./chatgpt-mcp-skip-rule.json", import.meta.url);
const REQUIRED_PHASES = [
  "http_ratelimit",
  "http_request_firewall_managed",
  "http_request_sbfm",
];
const REQUIRED_PRODUCTS = [
  "bic",
  "rateLimit",
  "waf",
];
const REQUIRED_EXPRESSION_PARTS = [
  "http.host eq",
  'http.request.uri.path eq "/mcp"',
  'starts_with(http.request.uri.path, "/mcp/")',
  'starts_with(http.request.uri.path, "/oauth/")',
  'starts_with(http.request.uri.path, "/.well-known/oauth-")',
  'starts_with(http.request.uri.path, "/.well-known/openid-configuration")',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fail(message) {
  process.stderr.write(`Cloudflare ChatGPT MCP skip rule validation failed: ${message}\n`);
  process.exit(1);
}

function hasAll(actual, expected) {
  return expected.every((value) => actual.includes(value));
}

function findRule(document) {
  const rules = Array.isArray(document.rules) ? document.rules : [];
  return rules.find((rule) => rule.ref === "vakwen_chatgpt_mcp_oauth_skip")
    ?? rules.find((rule) => rule.action === "skip" && String(rule.expression ?? "").includes("/oauth/"));
}

const inputPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : fileURLToPath(DEFAULT_RULESET_PATH);
const document = readJson(inputPath);
const rule = findRule(document);

if (!rule) fail("missing skip rule with ref vakwen_chatgpt_mcp_oauth_skip");
if (rule.action !== "skip") fail("rule action must be skip");
if (rule.enabled === false) fail("rule must be enabled");

const expression = String(rule.expression ?? "");
for (const part of REQUIRED_EXPRESSION_PARTS) {
  if (!expression.includes(part)) fail(`rule expression missing ${part}`);
}

const actionParameters = rule.action_parameters ?? {};
if (actionParameters.ruleset !== "current") {
  fail('action_parameters.ruleset must be "current" to skip remaining custom rules');
}
const phases = Array.isArray(actionParameters.phases) ? actionParameters.phases : [];
if (!hasAll(phases, REQUIRED_PHASES)) {
  fail(`action_parameters.phases must include ${REQUIRED_PHASES.join(", ")}`);
}
const products = Array.isArray(actionParameters.products) ? actionParameters.products : [];
if (!hasAll(products, REQUIRED_PRODUCTS)) {
  fail(`action_parameters.products must include ${REQUIRED_PRODUCTS.join(", ")}`);
}
if (rule.logging?.enabled !== true) {
  fail("logging.enabled must be true so matching requests appear in Cloudflare Security Events");
}

process.stdout.write(`Cloudflare ChatGPT MCP skip rule validated: ${inputPath}\n`);
