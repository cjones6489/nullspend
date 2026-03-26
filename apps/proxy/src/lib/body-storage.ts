import { emitMetric } from "./metrics.js";

/**
 * R2 key layout: `{ownerId}/{requestId}/request.json` and `.../response.json`
 *
 * Scoping under ownerId means a future lifecycle policy (e.g. 30-day expiry)
 * can be applied per-prefix, and the internal retrieval endpoint only
 * needs to verify ownerId ownership — no extra DB lookup.
 */
function requestKey(ownerId: string, requestId: string): string {
  return `${ownerId}/${requestId}/request.json`;
}

function responseKey(ownerId: string, requestId: string): string {
  return `${ownerId}/${requestId}/response.json`;
}

const MAX_BODY_BYTES = 1_048_576; // 1MB cap per object — matches proxy body limit

/**
 * Store request body in R2. Fire-and-forget — never throws.
 */
export async function storeRequestBody(
  bucket: R2Bucket,
  ownerId: string,
  requestId: string,
  body: string,
): Promise<void> {
  if (body.length > MAX_BODY_BYTES) {
    emitMetric("body_storage_skipped", { type: "request", reason: "too_large" });
    return;
  }
  try {
    await bucket.put(requestKey(ownerId, requestId), body, {
      httpMetadata: { contentType: "application/json" },
    });
    emitMetric("body_storage_write", { type: "request" });
  } catch (err) {
    console.error("[body-storage] Failed to store request body:", err);
    emitMetric("body_storage_error", { type: "request" });
  }
}

/**
 * Store response body in R2. Fire-and-forget — never throws.
 */
export async function storeResponseBody(
  bucket: R2Bucket,
  ownerId: string,
  requestId: string,
  body: string,
): Promise<void> {
  if (body.length > MAX_BODY_BYTES) {
    emitMetric("body_storage_skipped", { type: "response", reason: "too_large" });
    return;
  }
  try {
    await bucket.put(responseKey(ownerId, requestId), body, {
      httpMetadata: { contentType: "application/json" },
    });
    emitMetric("body_storage_write", { type: "response" });
  } catch (err) {
    console.error("[body-storage] Failed to store response body:", err);
    emitMetric("body_storage_error", { type: "response" });
  }
}

export interface StoredBodies {
  requestBody: string | null;
  responseBody: string | null;
}

/**
 * Retrieve stored bodies for a request. Returns null for missing objects.
 */
export async function retrieveBodies(
  bucket: R2Bucket,
  ownerId: string,
  requestId: string,
): Promise<StoredBodies> {
  const [reqObj, resObj] = await Promise.all([
    bucket.get(requestKey(ownerId, requestId)),
    bucket.get(responseKey(ownerId, requestId)),
  ]);

  return {
    requestBody: reqObj ? await reqObj.text() : null,
    responseBody: resObj ? await resObj.text() : null,
  };
}
