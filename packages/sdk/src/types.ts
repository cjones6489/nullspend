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

export interface CostReportingConfig {
  /** Flush when queue reaches this size. Default: 10. Clamped [1, 100]. */
  batchSize?: number;
  /** Flush on a timer interval in ms. Default: 5000. Min 100. */
  flushIntervalMs?: number;
  /** Max queued events before dropping oldest. Default: 1000. Min 1. */
  maxQueueSize?: number;
  /** Called when events are dropped due to queue overflow. */
  onDropped?: (count: number) => void;
  /** Called when a batch flush fails after retries. */
  onFlushError?: (error: Error, events: CostEventInput[]) => void;
}

export interface NullSpendConfig {
  baseUrl: string;
  apiKey: string;
  /** Override the API version sent via NullSpend-Version header. Defaults to the SDK's built-in version. */
  apiVersion?: string;
  /** Custom fetch implementation (defaults to globalThis.fetch). */
  fetch?: typeof globalThis.fetch;
  /** Per-request timeout in milliseconds. Default: 30000 (30s). Set to 0 to disable. */
  requestTimeoutMs?: number;
  /** Max retries on transient failures (429, 5xx, network). Default: 2. Set 0 to disable. */
  maxRetries?: number;
  /** Base delay between retries in ms. Default: 500. */
  retryBaseDelayMs?: number;
  /** Total wall-time cap for all retry attempts in ms. Default: 0 (no cap). */
  maxRetryTimeMs?: number;
  /** Called before each retry. Return false to abort retrying. */
  onRetry?: (info: RetryInfo) => void | boolean;
  /** Enable client-side cost event batching. Presence enables batching. */
  costReporting?: CostReportingConfig;
}

export interface RetryInfo {
  /** Zero-based retry attempt (0 = first retry, i.e. second overall request). */
  attempt: number;
  /** Delay in ms before this retry fires. */
  delayMs: number;
  /** The error that triggered the retry. */
  error: Error;
  /** HTTP method of the request. */
  method: string;
  /** URL path of the request. */
  path: string;
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

// ---------------------------------------------------------------------------
// Cost reporting (Phase 2C)
// ---------------------------------------------------------------------------

export interface CostEventInput {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  costMicrodollars: number;
  durationMs?: number;
  sessionId?: string;
  traceId?: string;
  eventType?: "llm" | "tool" | "custom";
  toolName?: string;
  toolServer?: string;
  tags?: Record<string, string>;
}

export interface ReportCostResponse {
  id: string;
  createdAt: string;
}

export interface ReportCostBatchResponse {
  inserted: number;
  ids: string[];
}

// ---------------------------------------------------------------------------
// Budget status (Phase 2E)
// ---------------------------------------------------------------------------

export interface BudgetEntity {
  entityType: string;
  entityId: string;
  limitMicrodollars: number;
  spendMicrodollars: number;
  remainingMicrodollars: number;
  policy: string;
  resetInterval: string | null;
  currentPeriodStart: string | null;
}

export interface BudgetStatus {
  entities: BudgetEntity[];
}
