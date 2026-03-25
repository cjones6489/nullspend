import { resolveAction } from "@/lib/actions/resolve-action";
import type { ApproveActionInput } from "@/lib/validations/actions";

export async function approveAction(
  actionId: string,
  input: ApproveActionInput,
  orgId: string,
) {
  const result = await resolveAction(actionId, orgId, "approved", {
    approvedBy: input.approvedBy,
  });

  return {
    id: result.id,
    status: result.status,
    approvedAt: result.approvedAt?.toISOString() ?? null,
  };
}
