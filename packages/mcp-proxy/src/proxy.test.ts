import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProxyConfig } from "./config.js";
import type { GateResult } from "./gate.js";

let mockCreateAction = vi.fn();
let mockGetAction = vi.fn();
let mockMarkResult = vi.fn();

vi.mock("@agentseam/sdk", () => {
  class MockAgentSeam {
    constructor() {}
    createAction(...args: unknown[]) {
      return mockCreateAction(...args);
    }
    getAction(...args: unknown[]) {
      return mockGetAction(...args);
    }
    markResult(...args: unknown[]) {
      return mockMarkResult(...args);
    }
  }
  class MockTimeoutError extends Error {
    constructor(actionId: string, timeoutMs: number) {
      super(`Timed out on ${actionId} after ${timeoutMs}ms`);
      this.name = "TimeoutError";
    }
  }
  return {
    AgentSeam: MockAgentSeam,
    TimeoutError: MockTimeoutError,
  };
});

const mockCallTool = vi.fn();
const mockListTools = vi.fn();

vi.mock("./gate.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./gate.js")>();
  return {
    ...original,
    isToolGated: vi.fn(),
    gateToolCall: vi.fn(),
  };
});

import { discoverUpstreamTools, registerProxyHandlers } from "./proxy.js";
import { isToolGated, gateToolCall } from "./gate.js";
import { AgentSeam } from "@agentseam/sdk";

const mockedIsToolGated = vi.mocked(isToolGated);
const mockedGateToolCall = vi.mocked(gateToolCall);

function makeConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    agentseamUrl: "http://127.0.0.1:3000",
    agentseamApiKey: "ask_test",
    agentId: "test-proxy",
    upstreamCommand: "node",
    upstreamArgs: [],
    upstreamEnv: {},
    gatedTools: "*",
    passthroughTools: new Set<string>(),
    approvalTimeoutSeconds: 300,
    ...overrides,
  };
}

function makeFakeUpstreamClient() {
  return {
    listTools: mockListTools,
    callTool: mockCallTool,
  } as unknown as import("@modelcontextprotocol/sdk/client/index.js").Client;
}

interface RequestHandler {
  (request: { params: Record<string, unknown> }): Promise<unknown>;
}

function makeFakeServer() {
  const registeredHandlers: RequestHandler[] = [];
  return {
    setRequestHandler: vi.fn((_schema: unknown, handler: RequestHandler) => {
      registeredHandlers.push(handler);
    }),
    get listToolsHandler(): RequestHandler | undefined {
      return registeredHandlers[0];
    },
    get callToolHandler(): RequestHandler | undefined {
      return registeredHandlers[1];
    },
  };
}

describe("discoverUpstreamTools", () => {
  beforeEach(() => {
    mockListTools.mockReset();
  });

  it("returns upstream tools from listTools()", async () => {
    const tools = [
      { name: "read_file", description: "Read a file", inputSchema: { type: "object" } },
      { name: "write_file", description: "Write a file", inputSchema: { type: "object" } },
    ];
    mockListTools.mockResolvedValue({ tools });

    const result = await discoverUpstreamTools(makeFakeUpstreamClient());
    expect(result).toEqual(tools);
  });

  it("fetches all pages when upstream returns nextCursor", async () => {
    const page1Tools = [
      { name: "tool_a", inputSchema: { type: "object" } },
      { name: "tool_b", inputSchema: { type: "object" } },
    ];
    const page2Tools = [
      { name: "tool_c", inputSchema: { type: "object" } },
    ];

    mockListTools
      .mockResolvedValueOnce({ tools: page1Tools, nextCursor: "cursor-1" })
      .mockResolvedValueOnce({ tools: page2Tools });

    const result = await discoverUpstreamTools(makeFakeUpstreamClient());

    expect(result).toEqual([...page1Tools, ...page2Tools]);
    expect(mockListTools).toHaveBeenCalledTimes(2);
    expect(mockListTools).toHaveBeenNthCalledWith(1, undefined);
    expect(mockListTools).toHaveBeenNthCalledWith(2, { cursor: "cursor-1" });
  });

  it("handles multiple pages of pagination", async () => {
    mockListTools
      .mockResolvedValueOnce({ tools: [{ name: "t1", inputSchema: { type: "object" } }], nextCursor: "c1" })
      .mockResolvedValueOnce({ tools: [{ name: "t2", inputSchema: { type: "object" } }], nextCursor: "c2" })
      .mockResolvedValueOnce({ tools: [{ name: "t3", inputSchema: { type: "object" } }] });

    const result = await discoverUpstreamTools(makeFakeUpstreamClient());

    expect(result).toHaveLength(3);
    expect(result.map((t) => t.name)).toEqual(["t1", "t2", "t3"]);
    expect(mockListTools).toHaveBeenCalledTimes(3);
  });
});

describe("registerProxyHandlers", () => {
  beforeEach(() => {
    mockCallTool.mockReset();
    mockMarkResult.mockReset();
    mockedIsToolGated.mockReset();
    mockedGateToolCall.mockReset();
  });

  it("registers tools/list and tools/call handlers", () => {
    const fakeServer = makeFakeServer();
    const sdk = new AgentSeam({ baseUrl: "http://test", apiKey: "key" });

    registerProxyHandlers(
      fakeServer as unknown as import("@modelcontextprotocol/sdk/server/index.js").Server,
      makeFakeUpstreamClient(),
      sdk,
      makeConfig(),
      [],
      new AbortController().signal,
    );

    expect(fakeServer.setRequestHandler).toHaveBeenCalledTimes(2);
  });

  it("tools/list returns cached tools verbatim", async () => {
    const cachedTools = [
      { name: "read_file", description: "Read", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
    ];
    const fakeServer = makeFakeServer();
    const sdk = new AgentSeam({ baseUrl: "http://test", apiKey: "key" });

    registerProxyHandlers(
      fakeServer as unknown as import("@modelcontextprotocol/sdk/server/index.js").Server,
      makeFakeUpstreamClient(),
      sdk,
      makeConfig(),
      cachedTools,
      new AbortController().signal,
    );

    const handler = fakeServer.listToolsHandler!;
    const result = await handler({ params: {} });
    expect(result).toEqual({ tools: cachedTools });
  });

  describe("tools/call - forward path", () => {
    it("forwards non-gated tool directly to upstream", async () => {
      mockedIsToolGated.mockReturnValue(false);
      mockCallTool.mockResolvedValue({
        content: [{ type: "text", text: "file contents" }],
      });

      const fakeServer = makeFakeServer();
      const sdk = new AgentSeam({ baseUrl: "http://test", apiKey: "key" });

      registerProxyHandlers(
        fakeServer as unknown as import("@modelcontextprotocol/sdk/server/index.js").Server,
        makeFakeUpstreamClient(),
        sdk,
        makeConfig(),
        [],
        new AbortController().signal,
      );

      const handler = fakeServer.callToolHandler!;
      const result = await handler({
        params: { name: "read_file", arguments: { path: "/test.txt" } },
      });

      expect(mockCallTool).toHaveBeenCalledWith({
        name: "read_file",
        arguments: { path: "/test.txt" },
      });
      expect(result).toEqual({
        content: [{ type: "text", text: "file contents" }],
      });
    });

    it("returns error when upstream throws on forward", async () => {
      mockedIsToolGated.mockReturnValue(false);
      mockCallTool.mockRejectedValue(new Error("upstream crash"));

      const fakeServer = makeFakeServer();
      const sdk = new AgentSeam({ baseUrl: "http://test", apiKey: "key" });

      registerProxyHandlers(
        fakeServer as unknown as import("@modelcontextprotocol/sdk/server/index.js").Server,
        makeFakeUpstreamClient(),
        sdk,
        makeConfig(),
        [],
        new AbortController().signal,
      );

      const handler = fakeServer.callToolHandler!;
      const result = (await handler({
        params: { name: "read_file", arguments: {} },
      })) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("upstream crash");
    });
  });

  describe("tools/call - gate path", () => {
    it("gates tool, marks executing, forwards on approval, marks executed", async () => {
      mockedIsToolGated.mockReturnValue(true);
      mockedGateToolCall.mockResolvedValue({
        actionId: "act-1",
        decision: "approved",
      } satisfies GateResult);
      mockCallTool.mockResolvedValue({
        content: [{ type: "text", text: "query result" }],
      });
      mockMarkResult.mockResolvedValue({ id: "act-1", status: "executed" });

      const fakeServer = makeFakeServer();
      const sdk = new AgentSeam({ baseUrl: "http://test", apiKey: "key" });

      registerProxyHandlers(
        fakeServer as unknown as import("@modelcontextprotocol/sdk/server/index.js").Server,
        makeFakeUpstreamClient(),
        sdk,
        makeConfig(),
        [],
        new AbortController().signal,
      );

      const handler = fakeServer.callToolHandler!;
      const result = await handler({
        params: { name: "run_query", arguments: { sql: "SELECT 1" } },
      });

      expect(mockMarkResult).toHaveBeenCalledWith("act-1", { status: "executing" });
      expect(mockCallTool).toHaveBeenCalledWith({
        name: "run_query",
        arguments: { sql: "SELECT 1" },
      });
      expect(mockMarkResult).toHaveBeenCalledWith("act-1", {
        status: "executed",
        result: expect.objectContaining({
          content: [{ type: "text", text: "query result" }],
        }),
      });
      expect(result).toEqual({
        content: [{ type: "text", text: "query result" }],
      });
    });

    it("marks failed when upstream throws after approval", async () => {
      mockedIsToolGated.mockReturnValue(true);
      mockedGateToolCall.mockResolvedValue({
        actionId: "act-2",
        decision: "approved",
      } satisfies GateResult);
      mockCallTool.mockRejectedValue(new Error("upstream exploded"));
      mockMarkResult.mockResolvedValue({ id: "act-2", status: "failed" });

      const fakeServer = makeFakeServer();
      const sdk = new AgentSeam({ baseUrl: "http://test", apiKey: "key" });

      registerProxyHandlers(
        fakeServer as unknown as import("@modelcontextprotocol/sdk/server/index.js").Server,
        makeFakeUpstreamClient(),
        sdk,
        makeConfig(),
        [],
        new AbortController().signal,
      );

      const handler = fakeServer.callToolHandler!;
      const result = (await handler({
        params: { name: "run_query", arguments: { sql: "DROP TABLE" } },
      })) as { content: Array<{ text: string }>; isError: boolean };

      expect(mockMarkResult).toHaveBeenCalledWith("act-2", { status: "executing" });
      expect(mockMarkResult).toHaveBeenCalledWith("act-2", {
        status: "failed",
        errorMessage: "upstream exploded",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("upstream exploded");
    });

    it("marks failed when upstream returns isError: true", async () => {
      mockedIsToolGated.mockReturnValue(true);
      mockedGateToolCall.mockResolvedValue({
        actionId: "act-3",
        decision: "approved",
      } satisfies GateResult);
      mockCallTool.mockResolvedValue({
        content: [{ type: "text", text: "permission denied" }],
        isError: true,
      });
      mockMarkResult.mockResolvedValue({ id: "act-3", status: "failed" });

      const fakeServer = makeFakeServer();
      const sdk = new AgentSeam({ baseUrl: "http://test", apiKey: "key" });

      registerProxyHandlers(
        fakeServer as unknown as import("@modelcontextprotocol/sdk/server/index.js").Server,
        makeFakeUpstreamClient(),
        sdk,
        makeConfig(),
        [],
        new AbortController().signal,
      );

      const handler = fakeServer.callToolHandler!;
      const result = (await handler({
        params: { name: "run_query", arguments: {} },
      })) as { content: Array<{ text: string }>; isError: boolean };

      expect(mockMarkResult).toHaveBeenCalledWith("act-3", {
        status: "failed",
        errorMessage: "permission denied",
      });
      expect(result.isError).toBe(true);
    });

    it("returns rejection text when action is rejected", async () => {
      mockedIsToolGated.mockReturnValue(true);
      mockedGateToolCall.mockResolvedValue({
        actionId: "act-4",
        decision: "rejected",
      } satisfies GateResult);

      const fakeServer = makeFakeServer();
      const sdk = new AgentSeam({ baseUrl: "http://test", apiKey: "key" });

      registerProxyHandlers(
        fakeServer as unknown as import("@modelcontextprotocol/sdk/server/index.js").Server,
        makeFakeUpstreamClient(),
        sdk,
        makeConfig(),
        [],
        new AbortController().signal,
      );

      const handler = fakeServer.callToolHandler!;
      const result = (await handler({
        params: { name: "delete_file", arguments: { path: "/important" } },
      })) as { content: Array<{ text: string }>; isError?: boolean };

      expect(result.content[0].text).toContain("rejected");
      expect(result.isError).toBe(true);
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("returns timeout text when approval times out", async () => {
      mockedIsToolGated.mockReturnValue(true);
      mockedGateToolCall.mockResolvedValue({
        actionId: "act-5",
        decision: "timedOut",
      } satisfies GateResult);

      const fakeServer = makeFakeServer();
      const sdk = new AgentSeam({ baseUrl: "http://test", apiKey: "key" });

      registerProxyHandlers(
        fakeServer as unknown as import("@modelcontextprotocol/sdk/server/index.js").Server,
        makeFakeUpstreamClient(),
        sdk,
        makeConfig(),
        [],
        new AbortController().signal,
      );

      const handler = fakeServer.callToolHandler!;
      const result = (await handler({
        params: { name: "run_query", arguments: {} },
      })) as { content: Array<{ text: string }>; isError?: boolean };

      expect(result.content[0].text).toContain("timed out");
      expect(result.isError).toBe(true);
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("returns isError when AgentSeam API is unreachable", async () => {
      mockedIsToolGated.mockReturnValue(true);
      mockedGateToolCall.mockRejectedValue(new Error("Connection refused"));

      const fakeServer = makeFakeServer();
      const sdk = new AgentSeam({ baseUrl: "http://test", apiKey: "key" });

      registerProxyHandlers(
        fakeServer as unknown as import("@modelcontextprotocol/sdk/server/index.js").Server,
        makeFakeUpstreamClient(),
        sdk,
        makeConfig(),
        [],
        new AbortController().signal,
      );

      const handler = fakeServer.callToolHandler!;
      const result = (await handler({
        params: { name: "run_query", arguments: {} },
      })) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("approval service");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("still forwards upstream call when markResult(executing) fails", async () => {
      mockedIsToolGated.mockReturnValue(true);
      mockedGateToolCall.mockResolvedValue({
        actionId: "act-mr1",
        decision: "approved",
      } satisfies GateResult);
      mockCallTool.mockResolvedValue({
        content: [{ type: "text", text: "success" }],
      });

      let callCount = 0;
      mockMarkResult.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("API down"));
        }
        return Promise.resolve({ id: "act-mr1", status: "executed" });
      });

      const fakeServer = makeFakeServer();
      const sdk = new AgentSeam({ baseUrl: "http://test", apiKey: "key" });

      registerProxyHandlers(
        fakeServer as unknown as import("@modelcontextprotocol/sdk/server/index.js").Server,
        makeFakeUpstreamClient(),
        sdk,
        makeConfig(),
        [],
        new AbortController().signal,
      );

      const handler = fakeServer.callToolHandler!;
      const result = (await handler({
        params: { name: "run_query", arguments: { sql: "SELECT 1" } },
      })) as { content: Array<{ text: string }>; isError?: boolean };

      expect(mockCallTool).toHaveBeenCalled();
      expect(result.content[0].text).toBe("success");
      expect(result.isError).toBeUndefined();
    });

    it("still returns result when markResult(executed) fails", async () => {
      mockedIsToolGated.mockReturnValue(true);
      mockedGateToolCall.mockResolvedValue({
        actionId: "act-mr2",
        decision: "approved",
      } satisfies GateResult);
      mockCallTool.mockResolvedValue({
        content: [{ type: "text", text: "data here" }],
      });
      mockMarkResult.mockImplementation((_id: string, input: { status: string }) => {
        if (input.status === "executed") {
          return Promise.reject(new Error("Audit trail failed"));
        }
        return Promise.resolve({ id: "act-mr2", status: input.status });
      });

      const fakeServer = makeFakeServer();
      const sdk = new AgentSeam({ baseUrl: "http://test", apiKey: "key" });

      registerProxyHandlers(
        fakeServer as unknown as import("@modelcontextprotocol/sdk/server/index.js").Server,
        makeFakeUpstreamClient(),
        sdk,
        makeConfig(),
        [],
        new AbortController().signal,
      );

      const handler = fakeServer.callToolHandler!;
      const result = (await handler({
        params: { name: "run_query", arguments: {} },
      })) as { content: Array<{ text: string }>; isError?: boolean };

      expect(result.content[0].text).toBe("data here");
      expect(result.isError).toBeUndefined();
    });

    it("still returns error when markResult(failed) fails after upstream throw", async () => {
      mockedIsToolGated.mockReturnValue(true);
      mockedGateToolCall.mockResolvedValue({
        actionId: "act-mr3",
        decision: "approved",
      } satisfies GateResult);
      mockCallTool.mockRejectedValue(new Error("upstream boom"));
      mockMarkResult.mockRejectedValue(new Error("Audit trail also down"));

      const fakeServer = makeFakeServer();
      const sdk = new AgentSeam({ baseUrl: "http://test", apiKey: "key" });

      registerProxyHandlers(
        fakeServer as unknown as import("@modelcontextprotocol/sdk/server/index.js").Server,
        makeFakeUpstreamClient(),
        sdk,
        makeConfig(),
        [],
        new AbortController().signal,
      );

      const handler = fakeServer.callToolHandler!;
      const result = (await handler({
        params: { name: "run_query", arguments: {} },
      })) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("upstream boom");
    });
  });
});
