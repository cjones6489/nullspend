export {
  ACTION_TYPES,
  ACTION_STATUSES,
  type ActionType,
  type ActionStatus,
} from "@nullspend/db";
import type { ActionStatus } from "@nullspend/db";

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
