import type { FastifyRequest } from "fastify";
import type { ShareCapability } from "@vakwen/shared-types";
import { routeError } from "./routeError.js";

export function requireWriterRole(req: FastifyRequest): void {
  if (req.authContext?.role === "viewer") {
    throw routeError(403, "write_blocked_viewer_role", "viewer role cannot mutate portfolio data");
  }
}

export function requireAdminRole(req: FastifyRequest): void {
  if (req.authContext?.role !== "admin") {
    throw routeError(403, "admin_role_required", "admin role required");
  }
}

export function requireShareGrantorRole(req: FastifyRequest): void {
  if (req.authContext?.isDemo || req.authContext?.role === "viewer") {
    throw routeError(403, "share_grant_forbidden", "share grant forbidden");
  }
}

export function requireWriteableContext(req: FastifyRequest): void {
  if (req.authContext?.isSharedContext) {
    throw routeError(
      403,
      "write_blocked_viewing_shared",
      "Writes are disabled while viewing a shared portfolio.",
    );
  }
}

type ActiveSharedCapabilityContext = {
  ownerUserId: string;
  sessionUserId: string;
  shareId: string;
  shareCapabilities: ShareCapability[];
};

const activeSharedCapabilityContextCache = new WeakMap<FastifyRequest, ActiveSharedCapabilityContext | null>();

export async function resolveActiveSharedCapabilityContext(
  req: FastifyRequest,
): Promise<ActiveSharedCapabilityContext | null> {
  if (activeSharedCapabilityContextCache.has(req)) {
    return activeSharedCapabilityContextCache.get(req) ?? null;
  }

  if (!req.authContext?.isSharedContext) {
    activeSharedCapabilityContextCache.set(req, null);
    return null;
  }

  const { sessionUserId, contextUserId } = req.authContext;
  const inbound = await req.server.persistence.listInboundSharesForGrantee(sessionUserId);
  const share = inbound.active.find((candidate) => candidate.ownerUserId === contextUserId) ?? null;
  if (!share) {
    activeSharedCapabilityContextCache.set(req, null);
    return null;
  }

  const context = {
    ownerUserId: contextUserId,
    sessionUserId,
    shareId: share.id,
    shareCapabilities: await req.server.persistence.getShareCapabilities(share.id),
  };
  activeSharedCapabilityContextCache.set(req, context);
  return context;
}

export async function requireSharedCapability(
  req: FastifyRequest,
  routeKey: string,
  capabilityMatrix: Readonly<Record<string, ShareCapability>>,
): Promise<void> {
  const sharedContext = await resolveActiveSharedCapabilityContext(req);
  if (!sharedContext) {
    throw routeError(403, "write_blocked_viewing_shared", "Writes are disabled while viewing a shared portfolio.");
  }

  const requiredCapability = capabilityMatrix[routeKey];
  if (requiredCapability && sharedContext.shareCapabilities.includes(requiredCapability)) {
    return;
  }

  throw routeError(
    403,
    "shared_capability_required",
    requiredCapability
      ? `Shared portfolio capability ${requiredCapability} is required for this route.`
      : "This write route is not available while viewing a shared portfolio.",
    {
      routeKey,
      ...(requiredCapability ? { requiredCapability } : {}),
      shareId: sharedContext.shareId,
      sessionUserId: sharedContext.sessionUserId,
      contextUserId: sharedContext.ownerUserId,
    },
  );
}
