import type { AuthResult } from "./auth.js";
import type { WebhookDispatcher } from "./webhook-dispatch.js";

export interface RequestContext {
  body: Record<string, unknown>;
  auth: AuthResult;
  connectionString: string;
  sessionId: string | null;     // from x-nullspend-session
  traceId: string;              // from traceparent / x-nullspend-trace-id / auto-generated
  tags: Record<string, string>; // from x-nullspend-tags
  webhookDispatcher: WebhookDispatcher | null;
  resolvedApiVersion: string;
  requestStartMs: number;       // performance.now() at request entry
}

export type RouteHandler = (
  request: Request,
  env: Env,
  ctx: RequestContext,
) => Promise<Response>;
