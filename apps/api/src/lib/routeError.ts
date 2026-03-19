type RouteError = Error & { statusCode: number; code: string };

export function routeError(statusCode: number, code: string, message: string): RouteError {
  const error = new Error(message) as RouteError;
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
