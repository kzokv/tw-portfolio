type RouteError = Error & {
  statusCode: number;
  code: string;
  metadata?: Record<string, unknown>;
};

export function routeError(
  statusCode: number,
  code: string,
  message: string,
  metadata?: Record<string, unknown>,
): RouteError {
  const error = new Error(message) as RouteError;
  error.statusCode = statusCode;
  error.code = code;
  if (metadata) {
    error.metadata = metadata;
  }
  return error;
}
