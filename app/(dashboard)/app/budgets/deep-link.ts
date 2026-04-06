export interface DeepLinkResult {
  action: "create" | "highlight" | "none";
  entityType?: "api_key";
  entityId?: string;
  budgetId?: string;
}

/**
 * Parse budget page deep-link query params.
 *
 * - ?create=api_key&entityId=xxx → pre-fill create dialog for that key
 * - ?selected=xxx → highlight that budget row
 * - Invalid/missing params → no action
 *
 * If entityId references a revoked/missing key, entityId is omitted (silent degradation).
 */
export function parseDeepLink(
  params: { get(key: string): string | null },
  keyIds: string[],
): DeepLinkResult {
  const createType = params.get("create");
  const entityId = params.get("entityId");
  const selectedId = params.get("selected");

  if (createType === "api_key" && entityId) {
    const keyExists = keyIds.includes(entityId);
    return {
      action: "create",
      entityType: "api_key",
      entityId: keyExists ? entityId : undefined,
    };
  }

  if (selectedId) {
    return {
      action: "highlight",
      budgetId: selectedId,
    };
  }

  return { action: "none" };
}
