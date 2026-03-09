"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
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
import {
  actionKeys,
  useApproveAction,
  useRejectAction,
} from "@/lib/queries/actions";

interface DecisionControlsProps {
  actionId: string;
}

export function DecisionControls({ actionId }: DecisionControlsProps) {
  const queryClient = useQueryClient();
  const approveAction = useApproveAction();
  const rejectAction = useRejectAction();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const isPending = approveAction.isPending || rejectAction.isPending;

  function handleApprove() {
    approveAction.mutate(actionId, {
      onSuccess: () => {
        setApproveOpen(false);
        toast.success("Action approved");
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

  return (
    <div className="flex items-center gap-2">
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogTrigger
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:pointer-events-none disabled:opacity-50"
          disabled={isPending}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Approve
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Approve this action?</DialogTitle>
          <DialogDescription>
            This will allow the agent to execute the proposed action. This
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
              size="sm"
              onClick={handleApprove}
              disabled={isPending}
              className="bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {approveAction.isPending ? "Approving..." : "Confirm Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogTrigger
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border/50 bg-secondary px-3 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:pointer-events-none disabled:opacity-50"
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
              {rejectAction.isPending ? "Rejecting..." : "Confirm Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
