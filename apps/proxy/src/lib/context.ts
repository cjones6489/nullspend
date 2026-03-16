import type { AuthResult } from "./auth.js";
import type { Redis } from "@upstash/redis/cloudflare";

export interface RequestContext {
  body: Record<string, unknown>;
  auth: AuthResult;
  redis: Redis | null;          // null when auth.hasBudgets is false
  connectionString: string;
  sessionId: string | null;     // from x-nullspend-session (used in Phase 4)
}

export type RouteHandler = (
  request: Request,
  env: Env,
  ctx: RequestContext,
) => Promise<Response>;
