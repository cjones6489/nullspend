import type { AuthResult } from "./auth.js";
import type { Redis } from "@upstash/redis/cloudflare";
import type { WebhookDispatcher } from "./webhook-dispatch.js";

export interface RequestContext {
  body: Record<string, unknown>;
  auth: AuthResult;
  redis: Redis | null;          // null when neither hasBudgets nor hasWebhooks
  connectionString: string;
  sessionId: string | null;     // from x-nullspend-session
  webhookDispatcher: WebhookDispatcher | null;
}

export type RouteHandler = (
  request: Request,
  env: Env,
  ctx: RequestContext,
) => Promise<Response>;
