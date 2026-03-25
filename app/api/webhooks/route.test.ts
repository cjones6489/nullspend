import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionContext } from "@/lib/auth/session";
import { GET, POST } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
  assertOrgMember: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/stripe/subscription", () => ({
  getSubscriptionByOrgId: vi.fn().mockResolvedValue(null),
}));

const mockSelectList = vi.fn();
const mockSelectCount = vi.fn().mockResolvedValue([{ value: 0 }]);
const mockInsertReturning = vi.fn();

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: () => {
          const countPromise = mockSelectCount();
          return {
            then: countPromise.then.bind(countPromise),
            catch: countPromise.catch.bind(countPromise),
            orderBy: () => mockSelectList(),
          };
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: mockInsertReturning,
      }),
    }),
  })),
}));

describe("GET /api/webhooks", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns webhook endpoints for authenticated user", async () => {
    vi.mocked(resolveSessionContext).mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });
    mockSelectList.mockResolvedValue([
      {
        id: "00000000-0000-4000-a000-000000000001",
        url: "https://hooks.example.com/1",
        description: "Slack alerts",
        eventTypes: ["cost_event.created"],
        enabled: true,
        apiVersion: "2026-04-01",
        payloadMode: "full",
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ]);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].url).toBe("https://hooks.example.com/1");
    expect(body.data[0].apiVersion).toBe("2026-04-01");
    expect(body.data[0]).not.toHaveProperty("signingSecret");
  });

  it("returns 401 when session is invalid", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    vi.mocked(resolveSessionContext).mockRejectedValueOnce(new AuthenticationRequiredError());

    const res = await GET();

    expect(res.status).toBe(401);
  });
});

describe("POST /api/webhooks", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a webhook endpoint and returns signing secret once", async () => {
    vi.mocked(resolveSessionContext).mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });
    mockSelectCount.mockResolvedValue([{ value: 0 }]);
    mockInsertReturning.mockResolvedValue([
      {
        id: "00000000-0000-4000-a000-000000000002",
        url: "https://hooks.example.com/new",
        description: null,
        eventTypes: [],
        enabled: true,
        apiVersion: "2026-04-01",
        payloadMode: "full",
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ]);

    const req = new Request("http://localhost/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://hooks.example.com/new" }),
    });

    const res = await POST(req);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.signingSecret).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(body.data.url).toBe("https://hooks.example.com/new");
    expect(body.data.apiVersion).toBe("2026-04-01");
  });

  it("returns 409 when max endpoints reached", async () => {
    vi.mocked(resolveSessionContext).mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });
    mockSelectCount.mockResolvedValue([{ value: 2 }]); // free tier limit

    const req = new Request("http://localhost/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://hooks.example.com/3rd" }),
    });

    const res = await POST(req);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("limit_exceeded");
    expect(body.error.message).toContain("2");
    expect(body.error.message).toContain("Free");
  });

  it("returns 400 for non-HTTPS URL", async () => {
    vi.mocked(resolveSessionContext).mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });

    const req = new Request("http://localhost/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://hooks.example.com/insecure" }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("returns 400 for private IP URL", async () => {
    vi.mocked(resolveSessionContext).mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });

    const req = new Request("http://localhost/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://192.168.1.1/webhook" }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("returns 400 for localhost URL", async () => {
    vi.mocked(resolveSessionContext).mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });

    const req = new Request("http://localhost/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://localhost/webhook" }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("returns 400 for IPv6 literal URL (SSRF bypass)", async () => {
    vi.mocked(resolveSessionContext).mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });

    const req = new Request("http://localhost/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://[::ffff:127.0.0.1]/webhook" }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("returns 400 for 0.0.0.0 URL (SSRF bypass)", async () => {
    vi.mocked(resolveSessionContext).mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });

    const req = new Request("http://localhost/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://0.0.0.0/webhook" }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("returns 400 for 127.0.0.2 URL (loopback range)", async () => {
    vi.mocked(resolveSessionContext).mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });

    const req = new Request("http://localhost/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://127.0.0.2/webhook" }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("returns 400 for link-local IP (169.254.x)", async () => {
    vi.mocked(resolveSessionContext).mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });

    const req = new Request("http://localhost/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://169.254.1.1/webhook" }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("returns 400 for missing url", async () => {
    vi.mocked(resolveSessionContext).mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });

    const req = new Request("http://localhost/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("accepts event types filter", async () => {
    vi.mocked(resolveSessionContext).mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });
    mockSelectCount.mockResolvedValue([{ value: 0 }]);
    mockInsertReturning.mockResolvedValue([
      {
        id: "00000000-0000-4000-a000-000000000003",
        url: "https://hooks.example.com/filtered",
        description: "Budget alerts only",
        eventTypes: ["budget.exceeded", "budget.threshold.warning"],
        enabled: true,
        apiVersion: "2026-04-01",
        payloadMode: "full",
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ]);

    const req = new Request("http://localhost/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://hooks.example.com/filtered",
        description: "Budget alerts only",
        eventTypes: ["budget.exceeded", "budget.threshold.warning"],
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.eventTypes).toEqual(["budget.exceeded", "budget.threshold.warning"]);
  });
});
