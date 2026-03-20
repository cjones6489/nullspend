import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleMetrics } from "../routes/metrics.js";

const mockKvStore = new Map<string, string>();
const mockKv = {
  get: vi.fn(async (key: string) => {
    const val = mockKvStore.get(key);
    return val ? JSON.parse(val) : null;
  }),
  put: vi.fn(async (key: string, value: string) => {
    mockKvStore.set(key, value);
  }),
};

function makeEnv(overrides: Record<string, unknown> = {}): Env {
  return {
    CACHE_KV: mockKv,
    ...overrides,
  } as unknown as Env;
}

function makeRequest(accept?: string): Request {
  const headers: Record<string, string> = {};
  if (accept) headers["accept"] = accept;
  return new Request("http://localhost/health/metrics", { headers });
}

const MOCK_AE_RESPONSE = {
  data: [
    {
      p50_overhead: 5.2,
      p95_overhead: 12.8,
      p99_overhead: 23.1,
      p50_upstream: 800,
      p95_upstream: 1200,
      p99_upstream: 2500,
      p50_total: 805,
      p95_total: 1213,
      p99_total: 2523,
      request_count: 1847,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockKvStore.clear();
  vi.stubGlobal("fetch", vi.fn());
});

describe("handleMetrics", () => {
  describe("KV cache hit", () => {
    it("returns cached metrics without querying AE", async () => {
      const cached = {
        overhead_ms: { p50: 5, p95: 12, p99: 23 },
        upstream_ms: { p50: 800, p95: 1200, p99: 2500 },
        total_ms: { p50: 805, p95: 1213, p99: 2523 },
        request_count: 1847,
        window_seconds: 300,
        measured_at: "2026-03-20T14:00:00Z",
      };
      mockKvStore.set("metrics:proxy_latency", JSON.stringify(cached));

      const res = await handleMetrics(makeRequest(), makeEnv());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.overhead_ms.p50).toBe(5);
      expect(body.request_count).toBe(1847);
      expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    });
  });

  describe("KV cache miss — AE query", () => {
    it("queries AE and returns metrics on cache miss", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify(MOCK_AE_RESPONSE), { status: 200 }),
      );

      const env = makeEnv({
        CF_ACCOUNT_ID: "test-account",
        CF_API_TOKEN: "test-token",
      });

      const res = await handleMetrics(makeRequest(), env);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.overhead_ms.p50).toBe(5);
      expect(body.overhead_ms.p95).toBe(13);
      expect(body.overhead_ms.p99).toBe(23);
      expect(body.request_count).toBe(1847);
      expect(body.window_seconds).toBe(300);
      expect(body.measured_at).toBeTruthy();
    });

    it("caches the AE result in KV", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify(MOCK_AE_RESPONSE), { status: 200 }),
      );

      const env = makeEnv({
        CF_ACCOUNT_ID: "test-account",
        CF_API_TOKEN: "test-token",
      });

      await handleMetrics(makeRequest(), env);

      expect(mockKv.put).toHaveBeenCalledWith(
        "metrics:proxy_latency",
        expect.any(String),
        { expirationTtl: 90 },
      );
    });

    it("sends correct Authorization header to AE SQL API", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify(MOCK_AE_RESPONSE), { status: 200 }),
      );

      const env = makeEnv({
        CF_ACCOUNT_ID: "acct-123",
        CF_API_TOKEN: "my-secret-token",
      });

      await handleMetrics(makeRequest(), env);

      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        "https://api.cloudflare.com/client/v4/accounts/acct-123/analytics_engine/sql",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer my-secret-token",
          }),
        }),
      );
    });

    it("uses quantileExactWeighted in the SQL query", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify(MOCK_AE_RESPONSE), { status: 200 }),
      );

      const env = makeEnv({
        CF_ACCOUNT_ID: "acct-123",
        CF_API_TOKEN: "token",
      });

      await handleMetrics(makeRequest(), env);

      const call = vi.mocked(globalThis.fetch).mock.calls[0];
      const body = call[1]?.body as string;
      expect(body).toContain("quantileExactWeighted");
      expect(body).not.toContain("quantileWeighted(");
    });
  });

  describe("AE not configured", () => {
    it("returns empty metrics when CF_ACCOUNT_ID is missing", async () => {
      const res = await handleMetrics(makeRequest(), makeEnv());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.overhead_ms).toEqual({ p50: 0, p95: 0, p99: 0 });
      expect(body.request_count).toBe(0);
    });
  });

  describe("AE query failure", () => {
    it("returns 503 when AE SQL API returns error", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response("Internal error", { status: 500 }),
      );

      const env = makeEnv({
        CF_ACCOUNT_ID: "acct",
        CF_API_TOKEN: "token",
      });

      const res = await handleMetrics(makeRequest(), env);

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error.code).toBe("metrics_unavailable");
    });

    it("returns 503 when fetch throws", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error("network error"));

      const env = makeEnv({
        CF_ACCOUNT_ID: "acct",
        CF_API_TOKEN: "token",
      });

      const res = await handleMetrics(makeRequest(), env);

      expect(res.status).toBe(503);
    });
  });

  describe("KV failure resilience", () => {
    it("falls through to AE query when KV read fails", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      mockKv.get.mockRejectedValueOnce(new Error("KV unavailable"));
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify(MOCK_AE_RESPONSE), { status: 200 }),
      );

      const env = makeEnv({
        CF_ACCOUNT_ID: "acct",
        CF_API_TOKEN: "token",
      });

      const res = await handleMetrics(makeRequest(), env);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.request_count).toBe(1847);
    });

    it("still returns AE result when KV write fails", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      mockKv.put.mockRejectedValueOnce(new Error("KV write failed"));
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify(MOCK_AE_RESPONSE), { status: 200 }),
      );

      const env = makeEnv({
        CF_ACCOUNT_ID: "acct",
        CF_API_TOKEN: "token",
      });

      const res = await handleMetrics(makeRequest(), env);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.overhead_ms.p50).toBe(5);
    });
  });

  describe("NaN and empty result handling", () => {
    it("returns zeros when AE returns NaN values (zero-row query)", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({
          data: [{
            p50_overhead: NaN, p95_overhead: NaN, p99_overhead: NaN,
            p50_upstream: NaN, p95_upstream: NaN, p99_upstream: NaN,
            p50_total: NaN, p95_total: NaN, p99_total: NaN,
            request_count: 0,
          }],
        }), { status: 200 }),
      );

      const env = makeEnv({ CF_ACCOUNT_ID: "acct", CF_API_TOKEN: "token" });
      const res = await handleMetrics(makeRequest(), env);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.overhead_ms).toEqual({ p50: 0, p95: 0, p99: 0 });
      expect(body.upstream_ms).toEqual({ p50: 0, p95: 0, p99: 0 });
      expect(body.total_ms).toEqual({ p50: 0, p95: 0, p99: 0 });
      expect(body.request_count).toBe(0);
    });

    it("returns zeros when AE returns empty data array", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      );

      const env = makeEnv({ CF_ACCOUNT_ID: "acct", CF_API_TOKEN: "token" });
      const res = await handleMetrics(makeRequest(), env);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.overhead_ms).toEqual({ p50: 0, p95: 0, p99: 0 });
      expect(body.request_count).toBe(0);
    });
  });

  describe("content negotiation", () => {
    it("returns JSON by default", async () => {
      const cached = {
        overhead_ms: { p50: 5, p95: 12, p99: 23 },
        upstream_ms: { p50: 800, p95: 1200, p99: 2500 },
        total_ms: { p50: 805, p95: 1213, p99: 2523 },
        request_count: 100,
        window_seconds: 300,
        measured_at: "2026-03-20T14:00:00Z",
      };
      mockKvStore.set("metrics:proxy_latency", JSON.stringify(cached));

      const res = await handleMetrics(makeRequest(), makeEnv());

      expect(res.headers.get("content-type")).toContain("application/json");
    });

    it("returns Prometheus format when Accept: text/plain", async () => {
      const cached = {
        overhead_ms: { p50: 5, p95: 12, p99: 23 },
        upstream_ms: { p50: 800, p95: 1200, p99: 2500 },
        total_ms: { p50: 805, p95: 1213, p99: 2523 },
        request_count: 100,
        window_seconds: 300,
        measured_at: "2026-03-20T14:00:00Z",
      };
      mockKvStore.set("metrics:proxy_latency", JSON.stringify(cached));

      const res = await handleMetrics(makeRequest("text/plain"), makeEnv());

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
      const text = await res.text();
      expect(text).toContain("# HELP nullspend_proxy_overhead_ms");
      expect(text).toContain("# TYPE nullspend_proxy_overhead_ms summary");
      expect(text).toContain('nullspend_proxy_overhead_ms{quantile="0.5"} 5');
      expect(text).toContain('nullspend_proxy_overhead_ms{quantile="0.95"} 12');
      expect(text).toContain('nullspend_proxy_overhead_ms{quantile="0.99"} 23');
      expect(text).toContain("nullspend_proxy_overhead_ms_count 100");
    });
  });
});
