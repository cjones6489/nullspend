export class NullSpendError extends Error {
  public readonly statusCode: number | undefined;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "NullSpendError";
    this.statusCode = statusCode;
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
