import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools.js";
import type { McpServerConfig } from "./config.js";

let mockCreateAction = vi.fn();
let mockGetAction = vi.fn();

vi.mock("@agentseam/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentseam/sdk")>();
  class MockAgentSeam {
    constructor() {}
    createAction(...args: unknown[]) { return mockCreateAction(...args); }
    getAction(...args: unknown[]) { return mockGetAction(...args); }
  }
  return {
    ...actual,
    AgentSeam: MockAgentSeam,
  };
});

const TEST_CONFIG: McpServerConfig = {
  agentseamUrl: "http://localhost:3000",
  agentseamApiKey: "ask_test123",
  agentId: "test-agent",
};

function mockAction(overrides: Record<string, unknown> = {}) {
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
    expiresAt: null,
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

interface ToolRegistration {
  name: string;
  description: string;
  cb: (params: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }>;
}

function captureTools(config: McpServerConfig, signal?: AbortSignal) {
  const tools: ToolRegistration[] = [];
  const fakeServer = {
    tool: vi.fn((...args: unknown[]) => {
      const name = args[0] as string;
      const description = args[1] as string;
      const cb = args[args.length - 1] as ToolRegistration["cb"];
      tools.push({ name, description, cb });
    }),
  } as unknown as McpServer;

  const abortController = new AbortController();
  registerTools(fakeServer, config, signal ?? abortController.signal);
  return { tools, abortController };
}

function getToolByName(tools: ToolRegistration[], name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

function parseResult(result: { content: Array<{ type: string; text: string }>; isError?: boolean }) {
  return {
    data: JSON.parse(result.content[0].text),
    isError: result.isError ?? false,
  };
}

describe("registerTools", () => {
  beforeEach(() => {
    mockCreateAction = vi.fn();
    mockGetAction = vi.fn();
  });

  it("registers propose_action and check_action", () => {
    const { tools } = captureTools(TEST_CONFIG);
    const names = tools.map((t) => t.name);
    expect(names).toContain("propose_action");
    expect(names).toContain("check_action");
  });

  describe("propose_action", () => {
    it("returns pending immediately when waitForDecision=false", async () => {
      mockCreateAction.mockResolvedValue({ id: "act-1", status: "pending" });

      const { tools } = captureTools(TEST_CONFIG);
      const tool = getToolByName(tools, "propose_action");

      const result = await tool.cb({
        actionType: "send_email",
        payload: { to: "test@example.com" },
        summary: "Send an email",
        waitForDecision: false,
      });

      const { data, isError } = parseResult(result);
      expect(isError).toBe(false);
      expect(data.actionId).toBe("act-1");
      expect(data.status).toBe("pending");
      expect(data.approved).toBe(false);
      expect(data.timedOut).toBe(false);
    });

    it("returns approved when action is approved during wait", async () => {
      mockCreateAction.mockResolvedValue({ id: "act-1", status: "pending" });
      mockGetAction.mockResolvedValue(
        mockAction({ status: "approved", approvedAt: "2026-01-01T00:01:00Z" }),
      );

      const { tools } = captureTools(TEST_CONFIG);
      const tool = getToolByName(tools, "propose_action");

      const result = await tool.cb({
        actionType: "send_email",
        payload: { to: "test@example.com" },
        summary: "Send an email",
        waitForDecision: true,
        timeoutSeconds: 5,
      });

      const { data, isError } = parseResult(result);
      expect(isError).toBe(false);
      expect(data.actionId).toBe("act-1");
      expect(data.status).toBe("approved");
      expect(data.approved).toBe(true);
    });

    it("returns rejected when action is rejected during wait", async () => {
      mockCreateAction.mockResolvedValue({ id: "act-1", status: "pending" });
      mockGetAction.mockResolvedValue(
        mockAction({ status: "rejected", rejectedAt: "2026-01-01T00:01:00Z" }),
      );

      const { tools } = captureTools(TEST_CONFIG);
      const tool = getToolByName(tools, "propose_action");

      const result = await tool.cb({
        actionType: "send_email",
        payload: { to: "test@example.com" },
        summary: "Send an email",
        waitForDecision: true,
        timeoutSeconds: 5,
      });

      const { data, isError } = parseResult(result);
      expect(isError).toBe(false);
      expect(data.status).toBe("rejected");
      expect(data.rejected).toBe(true);
      expect(data.approved).toBe(false);
    });

    it("stamps MCP metadata on created action", async () => {
      mockCreateAction.mockResolvedValue({ id: "act-1", status: "pending" });

      const { tools } = captureTools(TEST_CONFIG);
      const tool = getToolByName(tools, "propose_action");

      await tool.cb({
        actionType: "send_email",
        payload: { to: "test@example.com" },
        summary: "Send an email",
        waitForDecision: false,
      });

      expect(mockCreateAction).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            sourceFramework: "mcp",
            transport: "stdio",
            summary: "Send an email",
          }),
        }),
      );
    });

    it("MCP metadata cannot be overwritten by user metadata", async () => {
      mockCreateAction.mockResolvedValue({ id: "act-1", status: "pending" });

      const { tools } = captureTools(TEST_CONFIG);
      const tool = getToolByName(tools, "propose_action");

      await tool.cb({
        actionType: "send_email",
        payload: {},
        summary: "Test",
        metadata: { sourceFramework: "custom", transport: "http", extra: "kept" },
        waitForDecision: false,
      });

      const calledWith = mockCreateAction.mock.calls[0][0];
      expect(calledWith.metadata.sourceFramework).toBe("mcp");
      expect(calledWith.metadata.transport).toBe("stdio");
      expect(calledWith.metadata.extra).toBe("kept");
    });

    it("uses config.agentId when agentId is not provided", async () => {
      mockCreateAction.mockResolvedValue({ id: "act-1", status: "pending" });

      const { tools } = captureTools(TEST_CONFIG);
      const tool = getToolByName(tools, "propose_action");

      await tool.cb({
        actionType: "send_email",
        payload: {},
        summary: "Test",
        waitForDecision: false,
      });

      expect(mockCreateAction).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: "test-agent" }),
      );
    });

    it("uses provided agentId when specified", async () => {
      mockCreateAction.mockResolvedValue({ id: "act-1", status: "pending" });

      const { tools } = captureTools(TEST_CONFIG);
      const tool = getToolByName(tools, "propose_action");

      await tool.cb({
        actionType: "send_email",
        payload: {},
        summary: "Test",
        agentId: "custom-agent",
        waitForDecision: false,
      });

      expect(mockCreateAction).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: "custom-agent" }),
      );
    });

    it("returns error result when SDK throws", async () => {
      mockCreateAction.mockRejectedValue(new Error("Connection refused"));

      const { tools } = captureTools(TEST_CONFIG);
      const tool = getToolByName(tools, "propose_action");

      const result = await tool.cb({
        actionType: "send_email",
        payload: {},
        summary: "Test",
        waitForDecision: false,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Connection refused");
    });

    it("returns structured timeout response when deadline passes", async () => {
      mockCreateAction.mockResolvedValue({ id: "act-1", status: "pending" });
      mockGetAction.mockResolvedValue(mockAction({ status: "pending" }));

      const { tools } = captureTools(TEST_CONFIG);
      const tool = getToolByName(tools, "propose_action");

      const result = await tool.cb({
        actionType: "send_email",
        payload: {},
        summary: "Test",
        waitForDecision: true,
        timeoutSeconds: 0,
      });

      const { data, isError } = parseResult(result);
      expect(isError).toBe(false);
      expect(data.actionId).toBe("act-1");
      expect(data.status).toBe("pending");
      expect(data.timedOut).toBe(true);
      expect(data.approved).toBe(false);
      expect(data.message).toContain("Timed out");
    });

    it("aborts polling when shutdown signal fires", async () => {
      mockCreateAction.mockResolvedValue({ id: "act-1", status: "pending" });
      mockGetAction.mockResolvedValue(mockAction({ status: "pending" }));

      const abortController = new AbortController();
      const { tools } = captureTools(TEST_CONFIG, abortController.signal);
      const tool = getToolByName(tools, "propose_action");

      // Abort after a short delay so the polling loop starts then gets interrupted
      setTimeout(() => abortController.abort(), 50);

      const result = await tool.cb({
        actionType: "send_email",
        payload: {},
        summary: "Test",
        waitForDecision: true,
        timeoutSeconds: 60,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Aborted");
    });
  });

  describe("check_action", () => {
    it("returns current action status", async () => {
      mockGetAction.mockResolvedValue(
        mockAction({ id: "act-42", status: "approved", approvedAt: "2026-01-01T00:01:00Z" }),
      );

      const { tools } = captureTools(TEST_CONFIG);
      const tool = getToolByName(tools, "check_action");

      const result = await tool.cb({ actionId: "act-42" });

      const { data, isError } = parseResult(result);
      expect(isError).toBe(false);
      expect(data.actionId).toBe("act-42");
      expect(data.status).toBe("approved");
      expect(data.approved).toBe(true);
    });

    it("returns error result when SDK throws", async () => {
      mockGetAction.mockRejectedValue(new Error("Not found"));

      const { tools } = captureTools(TEST_CONFIG);
      const tool = getToolByName(tools, "check_action");

      const result = await tool.cb({ actionId: "act-missing" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Not found");
    });
  });
});
