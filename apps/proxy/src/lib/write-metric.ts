/**
 * Write a latency data point to Cloudflare Analytics Engine.
 * Fire-and-forget — zero hot-path overhead, never throws.
 *
 * Data point layout:
 *   blobs:   [provider, model, streamOrJson, statusCode]
 *   doubles: [overheadMs, upstreamMs, totalMs]
 *   indexes: [provider]  (sampling key)
 */
export function writeLatencyDataPoint(
  env: Env,
  provider: string,
  model: string,
  streaming: boolean,
  statusCode: number,
  overheadMs: number,
  upstreamMs: number,
  totalMs: number,
): void {
  try {
    const metrics = (env as Record<string, unknown>).METRICS as
      | { writeDataPoint(event: Record<string, unknown>): void }
      | undefined;
    if (!metrics) return;

    metrics.writeDataPoint({
      blobs: [provider, model, streaming ? "stream" : "json", String(statusCode)],
      doubles: [overheadMs, upstreamMs, totalMs],
      indexes: [provider],
    });
  } catch {
    // Never throw from metrics — proxy must not be affected
  }
}
