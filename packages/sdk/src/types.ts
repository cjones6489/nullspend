export const ACTION_TYPES = [
  "send_email",
  "http_post",
  "http_delete",
  "shell_command",
  "db_write",
  "file_write",
  "file_delete",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTION_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "executing",
  "executed",
  "failed",
] as const;

export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const TERMINAL_STATUSES: ReadonlySet<ActionStatus> = new Set([
  "rejected",
  "expired",
  "executed",
  "failed",
]);

// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

export interface NullSpendConfig {
  baseUrl: string;
  apiKey: string;
  /** Custom fetch implementation (defaults to globalThis.fetch). */
  fetch?: typeof globalThis.fetch;
  /** Per-request timeout in milliseconds. Default: 30000 (30s). Set to 0 to disable. */
  requestTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// API request / response shapes
// ---------------------------------------------------------------------------

export interface CreateActionInput {
  agentId: string;
  actionType: ActionType | (string & {});
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  /** Server-side TTL in seconds. Omit for server default (1 hour). Set to 0 or null to never expire. */
  expiresInSeconds?: number | null;
}

export interface CreateActionResponse {
  id: string;
  status: "pending";
  expiresAt: string | null;
}

export interface ActionRecord {
  id: string;
  agentId: string;
  actionType: string;
  status: ActionStatus;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  executedAt: string | null;
  expiresAt: string | null;
  expiredAt: string | null;
  approvedBy: string | null;
  rejectedBy: string | null;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  environment: string | null;
  sourceFramework: string | null;
}

export interface MarkResultInput {
  status: "executing" | "executed" | "failed";
  result?: Record<string, unknown>;
  errorMessage?: string;
}

export interface MutateActionResponse {
  id: string;
  status: ActionStatus;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  executedAt?: string | null;
}

// ---------------------------------------------------------------------------
// proposeAndWait options
// ---------------------------------------------------------------------------

/** Context passed to the execute callback with the action ID for cost correlation. */
export interface ExecuteContext {
  actionId: string;
}

export interface ProposeAndWaitOptions<T> {
  agentId: string;
  actionType: ActionType | (string & {});
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  /** Server-side TTL in seconds. Omit for server default (1 hour). Set to 0 or null to never expire. */
  expiresInSeconds?: number | null;
  /**
   * Called after the action is approved. Receives context with `actionId` which
   * can be sent as the `x-nullspend-action-id` header when calling the proxy
   * to correlate cost events with this action.
   */
  execute: (context?: ExecuteContext) => T | Promise<T>;
  /** Milliseconds between polls. Default: 2000 */
  pollIntervalMs?: number;
  /** Total timeout in milliseconds. Default: 300000 (5 min) */
  timeoutMs?: number;
  /** Called each time the SDK polls. Useful for logging. */
  onPoll?: (action: ActionRecord) => void;
}

export interface WaitForDecisionOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  onPoll?: (action: ActionRecord) => void;
}
