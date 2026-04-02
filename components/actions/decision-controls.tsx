"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  actionKeys,
  useApproveAction,
  useRejectAction,
} from "@/lib/queries/actions";
import { budgetIncreasePayloadSchema } from "@/lib/validations/actions";
import { formatMicrodollars } from "@/lib/utils/format";

interface DecisionControlsProps {
  actionId: string;
  actionType?: string;
  payload?: Record<string, unknown>;
}

export function DecisionControls({ actionId, actionType, payload }: DecisionControlsProps) {
  const queryClient = useQueryClient();
  const approveAction = useApproveAction();
  const rejectAction = useRejectAction();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approvedAmount, setApprovedAmount] = useState("");

  const isPending = approveAction.isPending || rejectAction.isPending;

  const budgetPayload =
    actionType === "budget_increase" && payload
      ? budgetIncreasePayloadSchema.safeParse(payload)
      : null;
  const isBudgetIncrease = budgetPayload?.success === true;
  const budgetData = isBudgetIncrease ? budgetPayload.data : null;

  function handleApprove() {
    let approvedAmountMicrodollars: number | undefined;

    if (isBudgetIncrease && approvedAmount.trim() !== "") {
      const dollars = parseFloat(approvedAmount);
      if (!Number.isFinite(dollars) || dollars <= 0) {
        toast.error("Enter a valid positive amount");
        return;
      }
      const microdollars = Math.round(dollars * 1_000_000);
      if (microdollars > 1_000_000_000_000) {
        toast.error("Amount cannot exceed $1,000,000");
        return;
      }
      approvedAmountMicrodollars = microdollars;
    }

    approveAction.mutate({ id: actionId, approvedAmountMicrodollars }, {
      onSuccess: (result) => {
        setApproveOpen(false);
        setApprovedAmount("");
        if (result.budgetIncrease) {
          toast.success(
            `Budget increased from ${formatMicrodollars(result.budgetIncrease.previousLimit)} to ${formatMicrodollars(result.budgetIncrease.newLimit)}`,
          );
        } else {
          toast.success("Action approved");
        }
      },
      onError: (err) => {
        toast.error(err.message || "Failed to approve action");
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: actionKeys.detail(actionId) });
        queryClient.invalidateQueries({ queryKey: actionKeys.all });
      },
    });
  }

  function handleReject() {
    rejectAction.mutate(actionId, {
      onSuccess: () => {
        setRejectOpen(false);
        toast.success("Action rejected");
      },
      onError: (err) => {
        toast.error(err.message || "Failed to reject action");
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: actionKeys.detail(actionId) });
        queryClient.invalidateQueries({ queryKey: actionKeys.all });
      },
    });
  }

  // Check if entered amount exceeds requested
  const enteredDollars = parseFloat(approvedAmount);
  const exceedsRequested =
    isBudgetIncrease &&
    budgetData &&
    Number.isFinite(enteredDollars) &&
    enteredDollars > 0 &&
    Math.round(enteredDollars * 1_000_000) > budgetData.requestedAmountMicrodollars;

  return (
    <div className="flex items-center gap-2">
      <Dialog open={approveOpen} onOpenChange={(open) => { setApproveOpen(open); if (!open) setApprovedAmount(""); }}>
        <DialogTrigger
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          disabled={isPending}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Approve
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>
            {isBudgetIncrease ? "Approve this budget increase?" : "Approve this action?"}
          </DialogTitle>
          <DialogDescription>
            {isBudgetIncrease && budgetData ? (
              <>
                Agent requested{" "}
                <span className="font-medium text-foreground">
                  +{formatMicrodollars(budgetData.requestedAmountMicrodollars)}
                </span>{" "}
                to increase the budget from{" "}
                <span className="font-medium text-foreground">
                  {formatMicrodollars(budgetData.currentLimitMicrodollars)}
                </span>{" "}
                to{" "}
                <span className="font-medium text-foreground">
                  {formatMicrodollars(budgetData.currentLimitMicrodollars + budgetData.requestedAmountMicrodollars)}
                </span>
                .
              </>
            ) : (
              "This will allow the agent to execute the proposed action. This cannot be undone."
            )}
          </DialogDescription>

          {isBudgetIncrease && budgetData && (
            <div className="space-y-1.5">
              <label
                htmlFor="approved-amount"
                className="text-[11px] font-medium text-muted-foreground"
              >
                Approved amount
              </label>
              <Input
                id="approved-amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder={`${(budgetData.requestedAmountMicrodollars / 1_000_000).toFixed(2)}`}
                value={approvedAmount}
                onChange={(e) => setApprovedAmount(e.target.value)}
                className="h-8 text-sm"
              />
              {exceedsRequested ? (
                <p className="text-[11px] text-amber-400">
                  Exceeds the requested +{formatMicrodollars(budgetData.requestedAmountMicrodollars)}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Leave blank to approve the full requested amount.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <DialogClose
              className="inline-flex h-8 items-center justify-center rounded-md border border-border/50 bg-secondary px-3 text-xs font-medium text-foreground hover:bg-accent"
              disabled={isPending}
            >
              Cancel
            </DialogClose>
            <Button
              size="sm"
              onClick={handleApprove}
              disabled={isPending}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {approveAction.isPending ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" />Approving...</> : "Confirm Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogTrigger
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border/50 bg-secondary px-3 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
          disabled={isPending}
        >
          <XCircle className="h-3.5 w-3.5" />
          Reject
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Reject this action?</DialogTitle>
          <DialogDescription>
            This will block the agent from executing the proposed action. This
            cannot be undone.
          </DialogDescription>
          <DialogFooter>
            <DialogClose
              className="inline-flex h-8 items-center justify-center rounded-md border border-border/50 bg-secondary px-3 text-xs font-medium text-foreground hover:bg-accent"
              disabled={isPending}
            >
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleReject}
              disabled={isPending}
            >
              {rejectAction.isPending ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" />Rejecting...</> : "Confirm Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
