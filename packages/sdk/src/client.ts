import { AgentSeamError, RejectedError, TimeoutError } from "./errors.js";
import type {
  ActionRecord,
  AgentSeamConfig,
  CreateActionInput,
  CreateActionResponse,
  MarkResultInput,
  MutateActionResponse,
  ProposeAndWaitOptions,
  WaitForDecisionOptions,
} from "./types.js";

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const API_KEY_HEADER = "x-agentseam-key";

export class AgentSeam {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly _fetch: typeof globalThis.fetch;
  private readonly requestTimeoutMs: number;

  constructor(config: AgentSeamConfig) {
    if (!config.baseUrl) throw new AgentSeamError("baseUrl is required");
    if (!config.apiKey) throw new AgentSeamError("apiKey is required");

    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  // -------------------------------------------------------------------------
  // Low-level API methods
  // -------------------------------------------------------------------------

  async createAction(input: CreateActionInput): Promise<CreateActionResponse> {
    return this.request<CreateActionResponse>("POST", "/api/actions", input);
  }

  async getAction(id: string): Promise<ActionRecord> {
    return this.request<ActionRecord>("GET", `/api/actions/${id}`);
  }

  async markResult(
    id: string,
    input: MarkResultInput,
  ): Promise<MutateActionResponse> {
    return this.request<MutateActionResponse>(
      "POST",
      `/api/actions/${id}/result`,
      input,
    );
  }

  // -------------------------------------------------------------------------
  // Polling
  // -------------------------------------------------------------------------

  async waitForDecision(
    actionId: string,
    options?: WaitForDecisionOptions,
  ): Promise<ActionRecord> {
    const pollInterval = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const action = await this.getAction(actionId);
      options?.onPoll?.(action);

      if (action.status !== "pending") {
        return action;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(pollInterval, remaining));
    }

    throw new TimeoutError(actionId, timeout);
  }

  // -------------------------------------------------------------------------
  // High-level orchestrator
  // -------------------------------------------------------------------------

  async proposeAndWait<T>(options: ProposeAndWaitOptions<T>): Promise<T> {
    const { id } = await this.createAction({
      agentId: options.agentId,
      actionType: options.actionType,
      payload: options.payload,
      metadata: options.metadata,
      expiresInSeconds: options.expiresInSeconds,
    });

    const decision = await this.waitForDecision(id, {
      pollIntervalMs: options.pollIntervalMs,
      timeoutMs: options.timeoutMs,
      onPoll: options.onPoll,
    });

    if (decision.status !== "approved") {
      throw new RejectedError(id, decision.status);
    }

    await this.markResult(id, { status: "executing" });

    try {
      const result = await options.execute();

      const serializable =
        result !== null && typeof result === "object"
          ? (result as Record<string, unknown>)
          : { value: result };

      await this.markResult(id, { status: "executed", result: serializable });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        await this.markResult(id, { status: "failed", errorMessage: message });
      } catch {
        // Best-effort: don't shadow the original execute error
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // HTTP helper
  // -------------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      [API_KEY_HEADER]: this.apiKey,
      Accept: "application/json",
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    try {
      const fetchOptions: RequestInit = {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      };

      if (this.requestTimeoutMs > 0) {
        fetchOptions.signal = AbortSignal.timeout(this.requestTimeoutMs);
      }

      response = await this._fetch(url, fetchOptions);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new AgentSeamError(`${method} ${path} network error: ${msg}`);
    }

    if (!response.ok) {
      let detail: string;
      try {
        const json = (await response.json()) as Record<string, unknown>;
        detail =
          String(json.error ?? json.message ?? response.statusText);
      } catch {
        detail = response.statusText;
      }
      throw new AgentSeamError(
        `${method} ${path} failed: ${detail}`,
        response.status,
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new AgentSeamError(
        `${method} ${path} returned invalid JSON`,
        response.status,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

