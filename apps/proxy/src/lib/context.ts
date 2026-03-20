import type { AuthResult } from "./auth.js";
import type { Redis } from "@upstash/redis/cloudflare";
import type { WebhookDispatcher } from "./webhook-dispatch.js";

export interface RequestContext {
  body: Record<string, unknown>;
  auth: AuthResult;
  redis: Redis | null;          // null when no webhooks configured
  connectionString: string;
  sessionId: string | null;     // from x-nullspend-session
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
