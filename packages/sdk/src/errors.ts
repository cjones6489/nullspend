export class NullSpendError extends Error {
  public readonly statusCode: number | undefined;
  public readonly code: string | undefined;

  constructor(message: string, statusCode?: number, code?: string) {
    super(message);
    this.name = "NullSpendError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class TimeoutError extends NullSpendError {
  constructor(actionId: string, timeoutMs: number) {
    super(
      `Timed out waiting for decision on action ${actionId} after ${timeoutMs}ms`,
    );
    this.name = "TimeoutError";
  }
}

export class RejectedError extends NullSpendError {
  public readonly actionId: string;
  public readonly actionStatus: string;

  constructor(actionId: string, status: string) {
    super(`Action ${actionId} was ${status}`);
    this.name = "RejectedError";
    this.actionId = actionId;
    this.actionStatus = status;
  }
}

export class BudgetExceededError extends NullSpendError {
  public readonly remainingMicrodollars: number;
  public readonly entityType: string | undefined;
  public readonly entityId: string | undefined;
  public readonly limitMicrodollars: number | undefined;
  public readonly spendMicrodollars: number | undefined;

  constructor(details: number | {
    remaining: number;
    entityType?: string;
    entityId?: string;
    limit?: number;
    spend?: number;
  }) {
    const d = typeof details === "number" ? { remaining: details } : details;
    super(
      `Budget exceeded: ${d.remaining} microdollars remaining`,
    );
    this.name = "BudgetExceededError";
    this.remainingMicrodollars = d.remaining;
    this.entityType = d.entityType;
    this.entityId = d.entityId;
    this.limitMicrodollars = d.limit;
    this.spendMicrodollars = d.spend;
  }
}

export class MandateViolationError extends NullSpendError {
  public readonly mandate: string;
  public readonly requested: string;
  public readonly allowed: string[];

  constructor(mandate: string, requested: string, allowed: string[]) {
    super(
      `Mandate violation: ${mandate} does not allow "${requested}". Allowed: ${allowed.join(", ")}`,
    );
    this.name = "MandateViolationError";
    this.mandate = mandate;
    this.requested = requested;
    this.allowed = allowed;
  }
}

export class SessionLimitExceededError extends NullSpendError {
  public readonly sessionSpendMicrodollars: number;
  public readonly sessionLimitMicrodollars: number;

  constructor(sessionSpend: number, sessionLimit: number) {
    super(
      `Session limit exceeded: ${sessionSpend} of ${sessionLimit} microdollars spent`,
    );
    this.name = "SessionLimitExceededError";
    this.sessionSpendMicrodollars = sessionSpend;
    this.sessionLimitMicrodollars = sessionLimit;
  }
}

export class VelocityExceededError extends NullSpendError {
  public readonly retryAfterSeconds: number | undefined;

  constructor(retryAfterSeconds?: number) {
    super(
      `Velocity limit exceeded${retryAfterSeconds ? ` — retry after ${retryAfterSeconds}s` : ""}`,
    );
    this.name = "VelocityExceededError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class TagBudgetExceededError extends NullSpendError {
  public readonly tagKey: string | undefined;
  public readonly tagValue: string | undefined;
  public readonly remainingMicrodollars: number | undefined;
  public readonly limitMicrodollars: number | undefined;

  constructor(details?: {
    tagKey?: string;
    tagValue?: string;
    remaining?: number;
    limit?: number;
  }) {
    const tag = details?.tagKey ? `${details.tagKey}=${details.tagValue}` : "unknown";
    super(`Tag budget exceeded for ${tag}`);
    this.name = "TagBudgetExceededError";
    this.tagKey = details?.tagKey;
    this.tagValue = details?.tagValue;
    this.remainingMicrodollars = details?.remaining;
    this.limitMicrodollars = details?.limit;
  }
}
