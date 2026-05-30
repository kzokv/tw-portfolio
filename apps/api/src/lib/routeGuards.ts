import type { FastifyRequest } from "fastify";
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
