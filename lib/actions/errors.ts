import type { ActionStatus } from "@/lib/utils/status";

export class ActionNotFoundError extends Error {
  constructor(actionId: string) {
    super(`Action ${actionId} was not found.`);
    this.name = "ActionNotFoundError";
  }
}

export class InvalidActionTransitionError extends Error {
  constructor(currentStatus: ActionStatus, nextStatus: ActionStatus) {
    super(`Cannot transition action from ${currentStatus} to ${nextStatus}.`);
    this.name = "InvalidActionTransitionError";
  }
}

export class StaleActionError extends Error {
  constructor(actionId: string) {
    super(
      `Action ${actionId} was modified concurrently. Retry the operation.`,
    );
    this.name = "StaleActionError";
  }
}

export class ActionExpiredError extends Error {
  constructor(actionId: string) {
    super(
      `Action ${actionId} has expired and can no longer be approved or rejected.`,
    );
    this.name = "ActionExpiredError";
  }
}
