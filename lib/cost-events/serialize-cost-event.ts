import type { RawCostEventRecord } from "@/lib/validations/cost-events";

interface CostEventJoinRow {
  id: string;
  requestId: string;
  apiKeyId: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  costMicrodollars: number;
  durationMs: number | null;
  createdAt: Date;
  traceId: string | null;
  sessionId: string | null;
  source: "proxy" | "api" | "mcp";
  tags: Record<string, string>;
  keyName: string | null;
  budgetStatus?: string | null;
  stopReason?: string | null;
  estimatedCostMicrodollars?: number | null;
}

export function serializeCostEvent(row: CostEventJoinRow): RawCostEventRecord {
  return {
    id: row.id,
    requestId: row.requestId,
    apiKeyId: row.apiKeyId,
    provider: row.provider,
    model: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cachedInputTokens: row.cachedInputTokens,
    reasoningTokens: row.reasoningTokens,
    costMicrodollars: row.costMicrodollars,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    traceId: row.traceId,
    sessionId: row.sessionId,
    source: row.source,
    tags: row.tags,
    keyName: row.keyName,
    budgetStatus: (row.budgetStatus as "skipped" | "approved" | "denied" | null) ?? null,
    stopReason: row.stopReason ?? null,
    estimatedCostMicrodollars: row.estimatedCostMicrodollars ?? null,
  };
}
