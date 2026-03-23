/**
 * GET /health/metrics — aggregate proxy latency percentiles.
 *
 * Reads from KV cache (sub-ms). On cache miss, queries Cloudflare
 * Analytics Engine SQL API for p50/p95/p99 overhead, caches for 90s.
 *
 * Supports content negotiation:
 *   Accept: application/json → JSON (default)
 *   Accept: text/plain       → Prometheus exposition format
 *
 * Note: `overhead_ms` = total - upstream (wall clock). This includes
 * I/O from auth and budget check — not just CPU time.
 */

import { emitMetric } from "../lib/metrics.js";

const CACHE_KEY = "metrics:proxy_latency";
const CACHE_TTL_SECONDS = 90;
const ERROR_CACHE_TTL_SECONDS = 30;
const QUERY_WINDOW_MINUTES = 5;

interface LatencyMetrics {
  overhead_ms: { p50: number; p95: number; p99: number };
  upstream_ms: { p50: number; p95: number; p99: number };
  total_ms: { p50: number; p95: number; p99: number };
  request_count: number;
  window_seconds: number;
  measured_at: string;
}

export async function handleMetrics(
  request: Request,
  env: Env,
): Promise<Response> {
  const kv = env.CACHE_KV;

  // 1. Check KV cache
  try {
    const cached = await kv.get(CACHE_KEY, "json") as LatencyMetrics | null;
    if (cached) {
      emitMetric("ae_cache", { hit: true });
      return formatResponse(request, cached);
    }
  } catch (err) {
    console.error("[metrics] KV read failed, falling through to AE:", err);
  }

  emitMetric("ae_cache", { hit: false });

  // 2. Cache miss — query Analytics Engine
  const accountId = (env as Record<string, unknown>).CF_ACCOUNT_ID as string | undefined;
  const apiToken = (env as Record<string, unknown>).CF_API_TOKEN as string | undefined;

  if (!accountId || !apiToken) {
    // AE not configured — return empty metrics
    const empty: LatencyMetrics = {
      overhead_ms: { p50: 0, p95: 0, p99: 0 },
      upstream_ms: { p50: 0, p95: 0, p99: 0 },
      total_ms: { p50: 0, p95: 0, p99: 0 },
      request_count: 0,
      window_seconds: QUERY_WINDOW_MINUTES * 60,
      measured_at: new Date().toISOString(),
    };
    return formatResponse(request, empty);
  }

  try {
    const sql = `
      SELECT
        quantileExactWeighted(0.5)(double1, _sample_interval) AS p50_overhead,
        quantileExactWeighted(0.95)(double1, _sample_interval) AS p95_overhead,
        quantileExactWeighted(0.99)(double1, _sample_interval) AS p99_overhead,
        quantileExactWeighted(0.5)(double2, _sample_interval) AS p50_upstream,
        quantileExactWeighted(0.95)(double2, _sample_interval) AS p95_upstream,
        quantileExactWeighted(0.99)(double2, _sample_interval) AS p99_upstream,
        quantileExactWeighted(0.5)(double3, _sample_interval) AS p50_total,
        quantileExactWeighted(0.95)(double3, _sample_interval) AS p95_total,
        quantileExactWeighted(0.99)(double3, _sample_interval) AS p99_total,
        SUM(_sample_interval) AS request_count
      FROM proxy_latency
      WHERE timestamp > NOW() - INTERVAL '${QUERY_WINDOW_MINUTES}' MINUTE
      FORMAT JSON
    `;

    const queryStart = Date.now();
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "text/plain",
        },
        body: sql,
        signal: AbortSignal.timeout(5000),
      },
    );
    const queryDurationMs = Date.now() - queryStart;

    if (!res.ok) {
      const errorBody = await res.text();
      console.error("[metrics] AE query failed:", res.status, errorBody);
      emitMetric("ae_query_error", { status: res.status, duration_ms: queryDurationMs });

      // Negative-cache to prevent hammering a failing AE API.
      // Skip for auth errors (401/403) — keep them loud so operators notice.
      if (res.status !== 401 && res.status !== 403) {
        try {
          await cacheError(kv, res.status);
        } catch (cacheErr) {
          console.warn("[metrics] Negative-cache write failed:", cacheErr);
        }
      }

      return new Response(
        JSON.stringify({ error: { code: "metrics_unavailable", message: "Metrics temporarily unavailable.", details: { upstream_status: res.status } } }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }

    emitMetric("ae_query_success", { duration_ms: queryDurationMs });

    // AE SQL API docs are inconsistent — some pages show `data`, others `result`.
    // Handle both keys defensively.
    const body = await res.json() as Record<string, unknown>;
    const rows = (body.data ?? body.result) as Record<string, number>[] | undefined;
    const row = rows?.[0];
    // AE returns Float64 as numbers but UInt64 as strings — coerce both.
    const safe = (v: unknown): number => {
      if (v === null || v === undefined || v === "") return 0;
      const n = typeof v === "string" ? Number(v) : v;
      return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 0;
    };

    const metrics: LatencyMetrics = {
      overhead_ms: {
        p50: safe(row?.p50_overhead),
        p95: safe(row?.p95_overhead),
        p99: safe(row?.p99_overhead),
      },
      upstream_ms: {
        p50: safe(row?.p50_upstream),
        p95: safe(row?.p95_upstream),
        p99: safe(row?.p99_upstream),
      },
      total_ms: {
        p50: safe(row?.p50_total),
        p95: safe(row?.p95_total),
        p99: safe(row?.p99_total),
      },
      request_count: safe(row?.request_count),
      window_seconds: QUERY_WINDOW_MINUTES * 60,
      measured_at: new Date().toISOString(),
    };

    // 3. Write to KV cache (best-effort — don't discard AE result on cache failure)
    try {
      await kv.put(CACHE_KEY, JSON.stringify(metrics), { expirationTtl: CACHE_TTL_SECONDS });
    } catch (err) {
      console.error("[metrics] KV cache write failed:", err);
      emitMetric("ae_cache_write_error", { error: String(err) });
    }

    return formatResponse(request, metrics);
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    console.error(`[metrics] ${isTimeout ? "AE query timed out" : "Failed to query AE"}:`, err);
    emitMetric("ae_query_error", { status: 0, timeout: isTimeout });

    // Negative-cache to prevent thundering herd on persistent failures
    try {
      await cacheError(kv, 0);
    } catch (cacheErr) {
      console.warn("[metrics] Negative-cache write failed:", cacheErr);
    }

    return new Response(
      JSON.stringify({ error: { code: "metrics_unavailable", message: isTimeout ? "Metrics query timed out." : "Metrics temporarily unavailable.", details: null } }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
 * Negative-cache: write a sentinel to KV so subsequent requests don't
 * hammer a failing AE API. Short TTL (30s) so recovery is quick.
 */
async function cacheError(kv: KVNamespace, upstreamStatus: number): Promise<void> {
  const sentinel: LatencyMetrics = {
    overhead_ms: { p50: 0, p95: 0, p99: 0 },
    upstream_ms: { p50: 0, p95: 0, p99: 0 },
    total_ms: { p50: 0, p95: 0, p99: 0 },
    request_count: 0,
    window_seconds: QUERY_WINDOW_MINUTES * 60,
    measured_at: new Date().toISOString(),
  };
  console.warn(`[metrics] Negative-caching empty metrics for ${ERROR_CACHE_TTL_SECONDS}s (upstream_status=${upstreamStatus})`);
  await kv.put(CACHE_KEY, JSON.stringify(sentinel), { expirationTtl: ERROR_CACHE_TTL_SECONDS });
}

function formatResponse(request: Request, metrics: LatencyMetrics): Response {
  const accept = request.headers.get("accept") ?? "";

  if (accept.includes("text/plain") || accept.includes("text/plain;")) {
    return new Response(toPrometheus(metrics), {
      status: 200,
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "Cache-Control": "public, max-age=60",
        "Vary": "Accept",
      },
    });
  }

  return Response.json(metrics, {
    headers: { "Cache-Control": "public, max-age=60", "Vary": "Accept" },
  });
}

function toPrometheus(m: LatencyMetrics): string {
  const lines: string[] = [];

  lines.push("# HELP nullspend_proxy_overhead_ms Proxy overhead latency in milliseconds");
  lines.push("# TYPE nullspend_proxy_overhead_ms summary");
  lines.push(`nullspend_proxy_overhead_ms{quantile="0.5"} ${m.overhead_ms.p50}`);
  lines.push(`nullspend_proxy_overhead_ms{quantile="0.95"} ${m.overhead_ms.p95}`);
  lines.push(`nullspend_proxy_overhead_ms{quantile="0.99"} ${m.overhead_ms.p99}`);
  lines.push(`nullspend_proxy_overhead_ms_count ${m.request_count}`);
  lines.push("");

  lines.push("# HELP nullspend_upstream_latency_ms Upstream provider latency in milliseconds");
  lines.push("# TYPE nullspend_upstream_latency_ms summary");
  lines.push(`nullspend_upstream_latency_ms{quantile="0.5"} ${m.upstream_ms.p50}`);
  lines.push(`nullspend_upstream_latency_ms{quantile="0.95"} ${m.upstream_ms.p95}`);
  lines.push(`nullspend_upstream_latency_ms{quantile="0.99"} ${m.upstream_ms.p99}`);
  lines.push(`nullspend_upstream_latency_ms_count ${m.request_count}`);
  lines.push("");

  lines.push("# HELP nullspend_total_latency_ms Total request latency in milliseconds");
  lines.push("# TYPE nullspend_total_latency_ms summary");
  lines.push(`nullspend_total_latency_ms{quantile="0.5"} ${m.total_ms.p50}`);
  lines.push(`nullspend_total_latency_ms{quantile="0.95"} ${m.total_ms.p95}`);
  lines.push(`nullspend_total_latency_ms{quantile="0.99"} ${m.total_ms.p99}`);
  lines.push(`nullspend_total_latency_ms_count ${m.request_count}`);
  lines.push("");

  return lines.join("\n") + "\n";
}
