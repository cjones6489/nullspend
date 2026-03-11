export {
  ACTION_TYPES,
  ACTION_STATUSES,
  type ActionType,
  type ActionStatus,
} from "@agentseam/db";
import type { ActionStatus } from "@agentseam/db";

export const TERMINAL_ACTION_STATUSES: ReadonlySet<ActionStatus> = new Set([
  "rejected",
  "expired",
  "executed",
  "failed",
]);

const ALLOWED_TRANSITIONS: Record<ActionStatus, readonly ActionStatus[]> = {
  pending: ["approved", "rejected", "expired"],
  approved: ["executing"],
  rejected: [],
  expired: [],
  executing: ["executed", "failed"],
  executed: [],
  failed: [],
};

export function canTransitionStatus(
  currentStatus: ActionStatus,
  nextStatus: ActionStatus,
): boolean {
  return ALLOWED_TRANSITIONS[currentStatus].includes(nextStatus);
}

export function isTerminalActionStatus(status: ActionStatus): boolean {
  return TERMINAL_ACTION_STATUSES.has(status);
}
