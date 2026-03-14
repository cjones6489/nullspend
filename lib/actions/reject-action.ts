import { resolveAction } from "@/lib/actions/resolve-action";
import type { RejectActionInput } from "@/lib/validations/actions";

export async function rejectAction(
  actionId: string,
  input: RejectActionInput,
  ownerUserId: string,
) {
  const result = await resolveAction(actionId, ownerUserId, "rejected", {
    rejectedBy: input.rejectedBy,
  });

  return {
    id: result.id,
    status: result.status,
    rejectedAt: result.rejectedAt?.toISOString() ?? null,
  };
}
