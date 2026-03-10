import { getModelPricing, costComponent } from "@agentseam/cost-engine";
import type { CostEvent } from "@agentseam/cost-engine";
import type { OpenAIUsage } from "./sse-parser.js";

/**
 * Map an OpenAI usage object to a CostEvent ready for persistence.
 *
 * Looks up pricing by requestModel first (matches our "openai/gpt-4o" keys).
 * Falls back to responseModel (OpenAI may resolve aliases like gpt-4o → gpt-4o-2024-11-20).
 */
export function calculateOpenAICost(
  requestModel: string,
  responseModel: string | null,
  usage: OpenAIUsage,
  requestId: string,
  durationMs: number,
): CostEvent & { userId: string | null; apiKeyId: string | null } {
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0;

  const normalInputTokens = promptTokens - cachedTokens;

  let pricing = getModelPricing("openai", requestModel);
  let resolvedModel = requestModel;

  if (!pricing && responseModel) {
    pricing = getModelPricing("openai", responseModel);
    if (pricing) resolvedModel = responseModel;
  }

  let costMicrodollars = 0;
  if (pricing) {
    costMicrodollars = Math.round(
      costComponent(normalInputTokens, pricing.inputPerMTok) +
      costComponent(cachedTokens, pricing.cachedInputPerMTok) +
      costComponent(completionTokens, pricing.outputPerMTok),
    );
  }

  return {
    requestId,
    provider: "openai",
    model: resolvedModel,
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    cachedInputTokens: cachedTokens,
    reasoningTokens,
    costMicrodollars,
    durationMs,
    userId: null,
    apiKeyId: null,
  };
}
