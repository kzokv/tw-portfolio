import type { FastifyReply } from "fastify";

export function sendOAuthError(reply: FastifyReply, statusCode: number, error: string, description: string) {
  return reply.code(statusCode).send({
    error,
    error_description: description,
  });
}

export function setMcpOAuthNoStoreHeaders(reply: FastifyReply): void {
  reply.header("cache-control", "no-store");
  reply.header("pragma", "no-cache");
}
