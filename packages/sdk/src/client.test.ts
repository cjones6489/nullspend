import { describe, it, expect, vi } from "vitest";
import { AgentSeam } from "./client.js";
import { AgentSeamError, RejectedError, TimeoutError } from "./errors.js";
import type { ActionRecord, CreateActionResponse } from "./types.js";

function mockAction(overrides: Partial<ActionRecord> = {}): ActionRecord {
  return {
    id: "act-1",
    agentId: "test-agent",
    actionType: "send_email",
    status: "pending",
    payload: { to: "a@b.com" },
    metadata: null,
    createdAt: "2026-01-01T00:00:00Z",
    approvedAt: null,
    rejectedAt: null,
    executedAt: null,
    expiredAt: null,
    approvedBy: null,
    rejectedBy: null,
    result: null,
    errorMessage: null,
    environment: null,
    sourceFramework: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createClient(fetchFn: typeof globalThis.fetch): AgentSeam {
  return new AgentSeam({
    baseUrl: "http://localhost:3000",
    apiKey: "ask_test123",
    fetch: fetchFn,
  });
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe("AgentSeam constructor", () => {
  it("throws if baseUrl is missing", () => {
    expect(
      () => new AgentSeam({ baseUrl: "", apiKey: "ask_x" }),
    ).toThrow("baseUrl is required");
  });

  it("throws if apiKey is missing", () => {
    expect(
      () => new AgentSeam({ baseUrl: "http://localhost", apiKey: "" }),
    ).toThrow("apiKey is required");
  });

  it("strips trailing slashes from baseUrl", () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ id: "1", status: "pending" }));
    const client = new AgentSeam({
      baseUrl: "http://localhost:3000///",
      apiKey: "ask_x",
      fetch: fetchFn,
    });
    client.createAction({ agentId: "a", actionType: "send_email", payload: {} });
    expect(fetchFn).toHaveBeenCalledWith(
      "http://localhost:3000/api/actions",
      expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// createAction
// ---------------------------------------------------------------------------

describe("createAction", () => {
  it("sends correct request and returns id + status", async () => {
    const expected: CreateActionResponse = { id: "act-1", status: "pending" };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(expected, 201));
    const client = createClient(fetchFn);

    const result = await client.createAction({
      agentId: "my-agent",
      actionType: "send_email",
      payload: { to: "a@b.com" },
      metadata: { env: "test" },
    });

    expect(result).toEqual(expected);
    expect(fetchFn).toHaveBeenCalledOnce();

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/actions");
    expect(init.method).toBe("POST");
    expect(init.headers["x-agentseam-key"]).toBe("ask_test123");
    expect(JSON.parse(init.body)).toEqual({
      agentId: "my-agent",
      actionType: "send_email",
      payload: { to: "a@b.com" },
      metadata: { env: "test" },
    });
  });

  it("throws AgentSeamError on non-OK response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ error: "Bad input" }, 400),
    );
    const client = createClient(fetchFn);

    await expect(
      client.createAction({ agentId: "a", actionType: "send_email", payload: {} }),
    ).rejects.toThrow(AgentSeamError);
  });
});

// ---------------------------------------------------------------------------
// getAction
// ---------------------------------------------------------------------------

describe("getAction", () => {
  it("fetches action by id", async () => {
    const action = mockAction({ id: "act-42", status: "approved" });
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(action));
    const client = createClient(fetchFn);

    const result = await client.getAction("act-42");
    expect(result.id).toBe("act-42");
    expect(result.status).toBe("approved");

    const [url] = fetchFn.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/actions/act-42");
  });
});

// ---------------------------------------------------------------------------
// markResult
// ---------------------------------------------------------------------------

describe("markResult", () => {
  it("posts result for executed action", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ id: "act-1", status: "executed" }),
    );
    const client = createClient(fetchFn);

    const result = await client.markResult("act-1", {
      status: "executed",
      result: { message: "sent" },
    });

    expect(result.status).toBe("executed");
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/actions/act-1/result");
    expect(init.method).toBe("POST");
  });

  it("posts error for failed action", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ id: "act-1", status: "failed" }),
    );
    const client = createClient(fetchFn);

    await client.markResult("act-1", {
      status: "failed",
      errorMessage: "SMTP timeout",
    });

    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.status).toBe("failed");
    expect(body.errorMessage).toBe("SMTP timeout");
  });
});

// ---------------------------------------------------------------------------
// waitForDecision
// ---------------------------------------------------------------------------

describe("waitForDecision", () => {
  it("returns immediately when action is already approved", async () => {
    const approved = mockAction({ status: "approved" });
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(approved));
    const client = createClient(fetchFn);

    const result = await client.waitForDecision("act-1", {
      pollIntervalMs: 50,
      timeoutMs: 500,
    });

    expect(result.status).toBe("approved");
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("polls until status changes from pending", async () => {
    const pending = mockAction({ status: "pending" });
    const approved = mockAction({ status: "approved" });

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(pending))
      .mockResolvedValueOnce(jsonResponse(pending))
      .mockResolvedValueOnce(jsonResponse(approved));

    const client = createClient(fetchFn);
    const onPoll = vi.fn();

    const result = await client.waitForDecision("act-1", {
      pollIntervalMs: 10,
      timeoutMs: 5000,
      onPoll,
    });

    expect(result.status).toBe("approved");
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(onPoll).toHaveBeenCalledTimes(3);
  });

  it("throws TimeoutError when deadline passes", async () => {
    const fetchFn = vi.fn().mockImplementation(() =>
      Promise.resolve(jsonResponse(mockAction({ status: "pending" }))),
    );
    const client = createClient(fetchFn);

    await expect(
      client.waitForDecision("act-1", {
        pollIntervalMs: 10,
        timeoutMs: 50,
      }),
    ).rejects.toThrow(TimeoutError);
  });

  it("returns on terminal statuses like rejected", async () => {
    const rejected = mockAction({ status: "rejected" });
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(rejected));
    const client = createClient(fetchFn);

    const result = await client.waitForDecision("act-1", {
      pollIntervalMs: 10,
      timeoutMs: 500,
    });

    expect(result.status).toBe("rejected");
  });
});

// ---------------------------------------------------------------------------
// proposeAndWait
// ---------------------------------------------------------------------------

describe("proposeAndWait", () => {
  it("creates, waits, executes, and reports result on approval", async () => {
    const createResp: CreateActionResponse = { id: "act-1", status: "pending" };
    const approved = mockAction({ id: "act-1", status: "approved" });
    const markResp = { id: "act-1", status: "executed" };

    const fetchFn = vi
      .fn()
      // createAction
      .mockResolvedValueOnce(jsonResponse(createResp, 201))
      // waitForDecision poll 1
      .mockResolvedValueOnce(jsonResponse(approved))
      // markResult (executing)
      .mockResolvedValueOnce(jsonResponse({ id: "act-1", status: "executing" }))
      // markResult (executed)
      .mockResolvedValueOnce(jsonResponse(markResp));

    const client = createClient(fetchFn);
    const execute = vi.fn().mockResolvedValue({ sent: true });

    const result = await client.proposeAndWait({
      agentId: "agent-1",
      actionType: "send_email",
      payload: { to: "a@b.com" },
      execute,
      pollIntervalMs: 10,
      timeoutMs: 5000,
    });

    expect(result).toEqual({ sent: true });
    expect(execute).toHaveBeenCalledOnce();
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("throws RejectedError when action is rejected", async () => {
    const createResp: CreateActionResponse = { id: "act-1", status: "pending" };
    const rejected = mockAction({ id: "act-1", status: "rejected" });

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(createResp, 201))
      .mockResolvedValueOnce(jsonResponse(rejected));

    const client = createClient(fetchFn);
    const execute = vi.fn();

    await expect(
      client.proposeAndWait({
        agentId: "agent-1",
        actionType: "send_email",
        payload: {},
        execute,
        pollIntervalMs: 10,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(RejectedError);

    expect(execute).not.toHaveBeenCalled();
  });

  it("reports failure when execute throws", async () => {
    const createResp: CreateActionResponse = { id: "act-1", status: "pending" };
    const approved = mockAction({ id: "act-1", status: "approved" });

    const fetchFn = vi
      .fn()
      // createAction
      .mockResolvedValueOnce(jsonResponse(createResp, 201))
      // waitForDecision
      .mockResolvedValueOnce(jsonResponse(approved))
      // markResult (executing)
      .mockResolvedValueOnce(jsonResponse({ id: "act-1", status: "executing" }))
      // markResult (failed)
      .mockResolvedValueOnce(jsonResponse({ id: "act-1", status: "failed" }));

    const client = createClient(fetchFn);
    const execute = vi.fn().mockRejectedValue(new Error("SMTP timeout"));

    await expect(
      client.proposeAndWait({
        agentId: "agent-1",
        actionType: "send_email",
        payload: {},
        execute,
        pollIntervalMs: 10,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow("SMTP timeout");

    // Should have called markResult with failed status
    const lastCall = fetchFn.mock.calls[3];
    const body = JSON.parse(lastCall[1].body);
    expect(body.status).toBe("failed");
    expect(body.errorMessage).toBe("SMTP timeout");
  });

  it("handles primitive return values from execute", async () => {
    const createResp: CreateActionResponse = { id: "act-1", status: "pending" };
    const approved = mockAction({ id: "act-1", status: "approved" });

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(createResp, 201))
      .mockResolvedValueOnce(jsonResponse(approved))
      .mockResolvedValueOnce(jsonResponse({ id: "act-1", status: "executing" }))
      .mockResolvedValueOnce(jsonResponse({ id: "act-1", status: "executed" }));

    const client = createClient(fetchFn);
    const result = await client.proposeAndWait({
      agentId: "agent-1",
      actionType: "shell_command",
      payload: { cmd: "echo hi" },
      execute: async () => 42,
      pollIntervalMs: 10,
      timeoutMs: 5000,
    });

    expect(result).toBe(42);

    // Primitive gets wrapped as { value: 42 } for the API
    const resultBody = JSON.parse(fetchFn.mock.calls[3][1].body);
    expect(resultBody.result).toEqual({ value: 42 });
  });
});
