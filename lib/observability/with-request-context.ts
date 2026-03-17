import { handleRouteError } from "@/lib/utils/http";

import { runWithRequestContext } from "./request-context";

/**
 * Type-preserving wrapper that establishes a route-scoped request context.
 * Reads x-request-id from the incoming header (set by proxy.ts) or generates one.
 * Catches unhandled errors via handleRouteError.
 */
export function withRequestContext<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends (request: Request, ...args: any[]) => Promise<Response>,
>(handler: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (async (request: Request, ...args: any[]) => {
    const requestId =
      request.headers.get("x-request-id") ?? crypto.randomUUID();
    const url = new URL(request.url);
    return runWithRequestContext(
      { requestId, method: request.method, path: url.pathname },
      async () => {
        try {
          return await handler(request, ...args);
        } catch (error) {
          return handleRouteError(error);
        }
      },
    );
  }) as T;
}
