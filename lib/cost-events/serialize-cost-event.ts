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
  source: string;
  tags: Record<string, string>;
  keyName: string;
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
    source: row.source,
    tags: row.tags,
    keyName: row.keyName,
  };
}
