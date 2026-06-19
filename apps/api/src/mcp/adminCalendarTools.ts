import { z } from "zod";
import type { AdminMarketCalendarPreviewRequest } from "@vakwen/shared-types";
import { routeError } from "../lib/routeError.js";
import type { McpToolHandlerContext } from "./types.js";
import {
  buildAdminMarketCalendarStatus,
  confirmAdminMarketCalendarImport,
  isOfficialCalendarMarketCode,
  previewAdminMarketCalendarImport,
  updateAdminMarketCalendarSource,
} from "../services/market-data/marketCalendarService.js";

const marketCodeSchema = z.enum(["TW", "US", "AU", "KR"]);

const sourceUpdateInputSchema = z.object({
  marketCode: marketCodeSchema,
  sourceId: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(200).optional(),
  sourceType: z.enum(["official_source", "manual_ai_assisted"]).optional(),
  suggestedSourceUrl: z.string().trim().url().nullable().optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
}).strict();

const previewPayloadSchema = z.object({
  calendarYear: z.number().int().min(2000).max(2100),
  sourceId: z.string().trim().min(1).max(120).nullable().optional(),
  sourceType: z.enum(["official_source", "manual_ai_assisted"]).optional(),
  label: z.string().trim().min(1).max(200).nullable().optional(),
  sourceUrl: z.string().trim().url().nullable().optional(),
  retrievedAt: z.string().datetime({ offset: true }),
  coverage: z.object({
    scope: z.literal("full_year"),
    evidence: z.string().trim().min(1).max(500),
    notes: z.string().trim().max(1_000).nullable().optional(),
  }).strict(),
  exceptions: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(["open", "closed"]),
    name: z.string().trim().min(1).max(200),
    evidence: z.string().trim().min(1).max(500),
    overrideReason: z.string().trim().min(1).max(500),
    notes: z.string().trim().max(1_000).nullable().optional(),
  }).strict()).max(366),
  replaceConfirmed: z.boolean().optional(),
  replacementReason: z.string().trim().max(500).nullable().optional(),
}).strict();

const manageImportInputSchema = z.object({
  mode: z.enum(["preview", "confirm"]),
  marketCode: marketCodeSchema,
  payload: previewPayloadSchema.optional(),
  previewToken: z.string().trim().min(1).max(120).optional(),
  replaceConfirmed: z.boolean().optional(),
  replacementReason: z.string().trim().max(500).nullable().optional(),
}).strict();

async function assertMcpAdminCalendarAccess(
  context: McpToolHandlerContext,
): Promise<{ sessionUserId: string; ipAddress: string | null }> {
  const user = await context.app.persistence.getAuthUserById(context.requestContext.auth.sessionUserId);
  if (!user || user.role !== "admin" || user.deactivatedAt || user.deletedAt) {
    throw routeError(403, "admin_required", "Admin role required");
  }
  const settings = await context.app.persistence.getAiConnectorPolicySettings();
  if (!settings.groupToggles.write) {
    throw routeError(403, "mcp_tool_group_disabled", "Write MCP tools are disabled by admin policy");
  }
  return {
    sessionUserId: user.userId,
    ipAddress: context.requestContext.sourceIp,
  };
}

export async function getAdminMarketCalendarStatusTool(
  context: McpToolHandlerContext,
  args: { marketCode: "TW" | "US" | "AU" | "KR" },
) {
  await assertMcpAdminCalendarAccess(context);
  if (!isOfficialCalendarMarketCode(args.marketCode)) {
    throw routeError(404, "market_calendar_not_supported", "Calendar management is only supported for TW, US, AU, and KR");
  }
  return buildAdminMarketCalendarStatus(context.app.persistence, args.marketCode, new Date());
}

export async function listAdminMarketCalendarSourcesTool(
  context: McpToolHandlerContext,
  args: { marketCode: "TW" | "US" | "AU" | "KR" },
) {
  await assertMcpAdminCalendarAccess(context);
  const sources = await context.app.persistence.listMarketCalendarSources(args.marketCode);
  return {
    marketCode: args.marketCode,
    sources: sources.map((source) => ({ ...source, marketCode: args.marketCode })),
  };
}

export async function updateAdminMarketCalendarSourceTool(
  context: McpToolHandlerContext,
  rawArgs: unknown,
) {
  const { sessionUserId, ipAddress } = await assertMcpAdminCalendarAccess(context);
  const args = sourceUpdateInputSchema.parse(rawArgs);
  const { previous, saved } = await updateAdminMarketCalendarSource(context.app.persistence, args.marketCode, args.sourceId, args);
  await context.app.persistence.appendAuditLog({
    actorUserId: sessionUserId,
    action: "market_calendar_source_updated",
    ipAddress,
    metadata: {
      marketCode: args.marketCode,
      sourceId: saved.id,
      previous,
      next: saved,
      source: "mcp_tool",
    },
  });
  await context.app.persistence.createMarketCalendarActivityEvent({
    marketCode: args.marketCode,
    category: "calendar",
    result: "success",
    sourceKind: "official_calendar",
    sourceId: saved.id,
    eventType: "calendar_source_updated",
    title: "Calendar source updated",
    message: `${saved.label} source updated for ${args.marketCode}.`,
    dedupeKey: `calendar_source_updated:${args.marketCode}:${saved.id}:${saved.updatedAt}`,
    detail: { sourceId: saved.id, previous, next: saved, source: "mcp_tool" },
  });
  return {
    marketCode: args.marketCode,
    source: { ...saved, marketCode: args.marketCode },
  };
}

export async function manageAdminMarketCalendarImportTool(
  context: McpToolHandlerContext,
  rawArgs: unknown,
) {
  const { sessionUserId, ipAddress } = await assertMcpAdminCalendarAccess(context);
  const args = manageImportInputSchema.parse(rawArgs);

  if (args.mode === "preview") {
    if (!args.payload) {
      throw routeError(400, "market_calendar_preview_payload_required", "Preview mode requires a normalized calendar payload");
    }
    const previewArgs = args.payload satisfies AdminMarketCalendarPreviewRequest;
    const preview = await previewAdminMarketCalendarImport(context.app.persistence, args.marketCode, previewArgs);
    await context.app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "market_calendar_previewed",
      ipAddress,
      metadata: {
        marketCode: args.marketCode,
        calendarYear: preview.calendarYear,
        previewToken: preview.previewToken,
        source: "mcp_tool",
      },
    });
    return preview;
  }

  if (!args.previewToken) {
    throw routeError(400, "market_calendar_preview_token_required", "Confirm mode requires a preview token");
  }
  const previewToken = args.previewToken;
  const confirmed = await confirmAdminMarketCalendarImport(
    context.app.persistence,
    args.marketCode,
    previewToken,
    args.replaceConfirmed,
    args.replacementReason,
  );
  await context.app.persistence.appendAuditLog({
    actorUserId: sessionUserId,
    action: "market_calendar_confirmed",
    ipAddress,
    metadata: {
      marketCode: args.marketCode,
      calendarYear: confirmed.calendarYear,
      versionId: confirmed.versionId,
      source: "mcp_tool",
    },
  });
  await context.app.persistence.createMarketCalendarActivityEvent({
    marketCode: args.marketCode,
    category: "calendar",
    result: "success",
    sourceKind: "official_calendar",
    eventType: "calendar_confirmed",
    title: "Calendar confirmed",
    message: `${args.marketCode} ${confirmed.calendarYear} calendar confirmed.`,
    calendarYear: confirmed.calendarYear,
    dedupeKey: `calendar_confirmed:${args.marketCode}:${confirmed.versionId}`,
    detail: { versionId: confirmed.versionId, source: "mcp_tool" },
  });
  return confirmed;
}
