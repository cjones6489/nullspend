import { resolveAction } from "@/lib/actions/resolve-action";
import type { ApproveActionInput } from "@/lib/validations/actions";

export async function approveAction(
  actionId: string,
  input: ApproveActionInput,
  ownerUserId: string,
) {
  const result = await resolveAction(actionId, ownerUserId, "approved", {
    approvedAt: new Date(),
    approvedBy: input.approvedBy,
  });

  return {
    id: result.id,
    status: result.status,
    approvedAt: result.approvedAt?.toISOString() ?? null,
  };
}
