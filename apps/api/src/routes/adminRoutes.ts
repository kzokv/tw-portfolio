import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfigDto } from "@tw-portfolio/shared-types";
import {
  DEFAULT_DASHBOARD_PERFORMANCE_RANGES,
  dashboardPerformanceRangesSchema,
} from "@tw-portfolio/shared-types";
import { Env } from "@tw-portfolio/config";
import { signImpersonationCookie } from "../auth/googleOAuth.js";
import { routeError } from "../lib/routeError.js";
import { requireAdminRole } from "../lib/routeGuards.js";
import { getEffectiveRepairCooldownMinutes } from "../services/market-data/repairCooldown.js";
import {
  impersonationClearCookieString,
  impersonationSetCookieString,
  requireSessionUserId,
  userRoleSchema,
  userScopedIdSchema,
} from "./registerRoutes.js";

export const patchAdminSettingsSchema = z
  .object({
    repairCooldownMinutes: z.union([z.number().int().min(1).max(10080), z.null()]).optional(),
    // KZO-159 (158A): admin override for the user-facing timeframe picker.
    // `null` clears the override (falls back to the hardcoded default list).
    dashboardPerformanceRanges: z
      .union([dashboardPerformanceRangesSchema, z.null()])
      .optional(),
  })
  .strict();

function resolveAdminContext(req: FastifyRequest, _app: FastifyInstance) {
  const sessionUserId = requireSessionUserId(req);
  return {
    sessionUserId,
    ipAddress: req.ip,
    email: req.authContext?.email ?? null,
  };
}

function assertNotSelf(sessionUserId: string, targetUserId: string): void {
  if (targetUserId === sessionUserId) {
    throw routeError(403, "self_operation_blocked", "Cannot perform this action on your own account");
  }
}

function resolveEffectiveDashboardPerformanceRanges(
  override: string[] | null,
): string[] {
  if (Array.isArray(override) && override.length > 0) {
    return [...override];
  }
  return [...DEFAULT_DASHBOARD_PERFORMANCE_RANGES];
}

async function loadAppConfigDto(app: FastifyInstance): Promise<AppConfigDto> {
  const [config, effective] = await Promise.all([
    app.persistence.getAppConfig(),
    getEffectiveRepairCooldownMinutes(app.persistence),
  ]);
  return {
    repairCooldownMinutes: config.repairCooldownMinutes,
    effectiveRepairCooldownMinutes: effective,
    dashboardPerformanceRanges: config.dashboardPerformanceRanges,
    effectiveDashboardPerformanceRanges: resolveEffectiveDashboardPerformanceRanges(
      config.dashboardPerformanceRanges,
    ),
    updatedAt: config.updatedAt,
  };
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/users", async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "50", 10) || 50));
    return app.persistence.listUsers({
      page,
      limit,
      search: query.search,
      role: query.role ? userRoleSchema.parse(query.role) : undefined,
      status: z.enum(["active", "disabled", "deleted"]).optional().parse(query.status || undefined),
    });
  });

  app.patch("/users/:id/role", async (req) => {
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);
    const body = z.object({ role: userRoleSchema }).parse(req.body);

    assertNotSelf(sessionUserId, id);

    const target = await app.persistence.getAuthUserById(id);
    if (!target) throw routeError(404, "user_not_found", "User not found");

    // Last-admin guard is enforced atomically inside changeUserRole transaction

    const result = await app.persistence.changeUserRole(id, body.role, {
      actorUserId: sessionUserId,
      ipAddress,
    });

    // Force logout when removing admin role
    if (target.role === "admin" && body.role !== "admin") {
      await app.persistence.appendAuditLog({
        actorUserId: sessionUserId,
        action: "session_force_logout",
        targetUserId: id,
        ipAddress,
        metadata: { targetEmail: target.email, reason: "admin_role_change" },
      });
    }

    return result;
  });

  app.post("/users/:id/disable", async (req) => {
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);

    assertNotSelf(sessionUserId, id);

    const target = await app.persistence.getAuthUserById(id);
    if (!target) throw routeError(404, "user_not_found", "User not found");

    // Last-admin guard is enforced atomically inside disableUser transaction
    await app.persistence.disableUser(id, {
      actorUserId: sessionUserId,
      ipAddress,
    });
    return { status: "ok" };
  });

  app.post("/users/:id/enable", async (req) => {
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);

    assertNotSelf(sessionUserId, id);

    const target = await app.persistence.getAuthUserById(id);
    if (!target) throw routeError(404, "user_not_found", "User not found");

    await app.persistence.enableUser(id, {
      actorUserId: sessionUserId,
      ipAddress,
    });
    return { status: "ok" };
  });

  app.delete("/users/:id", async (req) => {
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);

    assertNotSelf(sessionUserId, id);

    const target = await app.persistence.getAuthUserById(id);
    if (!target) throw routeError(404, "user_not_found", "User not found");

    // Last-admin guard is enforced atomically inside softDeleteUser transaction
    await app.persistence.softDeleteUser(id, {
      actorUserId: sessionUserId,
      ipAddress,
    });
    return { status: "ok" };
  });

  app.delete("/users/:id/purge", async (req, reply) => {
    const { sessionUserId, ipAddress, email: adminEmail } = resolveAdminContext(req, app);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);
    const body = z.object({
      confirmation: z.string(),
      adminEmail: z.string().email(),
    }).parse(req.body);

    assertNotSelf(sessionUserId, id);

    const target = await app.persistence.getAuthUserById(id);
    if (!target) throw routeError(404, "user_not_found", "User not found");
    if (!target.email) {
      throw routeError(400, "no_email_for_purge", "Cannot purge a user with no email address");
    }

    // Validate confirmation strings
    const expectedConfirmation = `PURGE ${target.email}`;
    if (body.confirmation !== expectedConfirmation) {
      throw routeError(400, "invalid_confirmation", `Confirmation must be "${expectedConfirmation}"`);
    }
    if (body.adminEmail.toLowerCase() !== (adminEmail ?? "").toLowerCase()) {
      throw routeError(400, "invalid_admin_email", "Admin email does not match");
    }

    // Last-admin guard is enforced atomically inside hardPurgeUser transaction

    // Check for active jobs
    const hasJobs = await app.persistence.hasActiveJobs(id);
    if (hasJobs) {
      throw routeError(409, "active_jobs_blocked", "User has active background jobs — wait for completion before purging");
    }

    await app.persistence.hardPurgeUser(id, {
      actorUserId: sessionUserId,
      ipAddress,
    });
    reply.code(204);
    return null;
  });

  app.post("/users/:id/impersonate", async (req, reply) => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { id: targetUserId } = z.object({ id: userScopedIdSchema }).parse(req.params);

    if (req.authContext?.isDemo) {
      throw routeError(403, "demo_cannot_impersonate", "Demo sessions cannot impersonate users");
    }
    if (targetUserId === sessionUserId) {
      throw routeError(400, "cannot_impersonate_self", "Cannot impersonate yourself");
    }

    const targetUser = await app.persistence.getAuthUserById(targetUserId);
    if (!targetUser || targetUser.deactivatedAt || targetUser.deletedAt) {
      throw routeError(404, "user_not_found", "User not found");
    }

    if (req.authContext?.isImpersonating && req.authContext.impersonation) {
      await app.persistence.appendAuditLog({
        actorUserId: sessionUserId,
        action: "impersonation_end",
        targetUserId: req.authContext.impersonation.targetUserId,
        ipAddress,
        metadata: {
          reason: "replaced",
          targetUserId: req.authContext.impersonation.targetUserId,
          targetEmail: req.authContext.impersonation.targetEmail,
        },
      });
    }

    const sessionSecret = app.oauthConfig?.sessionSecret ?? Env.SESSION_SECRET ?? "";
    if (!sessionSecret) {
      throw routeError(500, "missing_secret", "SESSION_SECRET is required for impersonation cookie signing");
    }

    const ttlMinutes = Env.ADMIN_IMPERSONATION_TTL_MINUTES;
    const expiresAtMs = Date.now() + ttlMinutes * 60_000;
    const expiresAt = new Date(expiresAtMs).toISOString();
    const cookieValue = signImpersonationCookie(sessionUserId, targetUserId, expiresAtMs, sessionSecret);

    req.__clearImpersonationCookie = false;
    reply.header("set-cookie", impersonationSetCookieString(cookieValue, ttlMinutes));

    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "impersonation_start",
      targetUserId,
      ipAddress,
      metadata: {
        targetUserId,
        targetEmail: targetUser.email ?? null,
        expiresAt,
      },
    });

    return {
      expiresAt,
      targetEmail: targetUser.email ?? null,
    };
  });

  app.delete("/impersonation", async (req, reply) => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    if (req.authContext?.isImpersonating && req.authContext.impersonation) {
      await app.persistence.appendAuditLog({
        actorUserId: sessionUserId,
        action: "impersonation_end",
        targetUserId: req.authContext.impersonation.targetUserId,
        ipAddress,
        metadata: {
          reason: "manual",
          targetUserId: req.authContext.impersonation.targetUserId,
          targetEmail: req.authContext.impersonation.targetEmail,
        },
      });
    }

    req.__clearImpersonationCookie = false;
    reply.header("set-cookie", impersonationClearCookieString());
    reply.code(204);
    return null;
  });

  app.get("/invites", async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "50", 10) || 50));
    return app.persistence.listInvites({
      page,
      limit,
      status: z.enum(["pending", "used", "expired", "revoked"]).optional().parse(query.status || undefined),
      email: query.email,
    });
  });

  app.get("/audit-log", async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "50", 10) || 50));
    return app.persistence.listAuditLog({
      page,
      limit,
      actorUserId: query.actorUserId,
      targetUserId: query.targetUserId,
      actions: query.action ? query.action.split(",").map((a) => a.trim()).filter(Boolean) : undefined,
      fromDate: query.fromDate,
      toDate: query.toDate,
    });
  });

  // ── Admin settings (KZO-142) ───────────────────────────────────────────────

  app.get("/settings", async (req): Promise<AppConfigDto> => {
    requireAdminRole(req);
    return loadAppConfigDto(app);
  });

  app.patch("/settings", async (req): Promise<AppConfigDto> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const body = patchAdminSettingsSchema.parse(req.body);

    const current = await app.persistence.getAppConfig();

    // KZO-159 (158A): diff each tracked field independently — a PATCH may
    // carry one, the other, both, or neither. `undefined` means "no change",
    // `null` means "clear override", array means "set override".
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (
      body.repairCooldownMinutes !== undefined
      && body.repairCooldownMinutes !== current.repairCooldownMinutes
    ) {
      before.repairCooldownMinutes = current.repairCooldownMinutes;
      after.repairCooldownMinutes = body.repairCooldownMinutes;
      await app.persistence.setRepairCooldownMinutes(body.repairCooldownMinutes);
    }

    if (body.dashboardPerformanceRanges !== undefined) {
      const currentList = current.dashboardPerformanceRanges;
      const nextList = body.dashboardPerformanceRanges;
      // Treat [a,b,c] vs [a,b,c] as equal (same length, same elements).
      const unchanged =
        currentList === nextList
        || (Array.isArray(currentList)
          && Array.isArray(nextList)
          && currentList.length === nextList.length
          && currentList.every((v, i) => v === nextList[i]));
      if (!unchanged) {
        before.dashboardPerformanceRanges = currentList;
        after.dashboardPerformanceRanges = nextList;
        await app.persistence.setDashboardPerformanceRanges(nextList);
      }
    }

    if (Object.keys(after).length === 0) {
      return loadAppConfigDto(app);
    }

    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "app_config_updated",
      metadata: { before, after },
      ipAddress,
    });

    return loadAppConfigDto(app);
  });
};
