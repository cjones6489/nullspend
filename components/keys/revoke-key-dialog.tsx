"use client";

import { Loader2 } from "lucide-react";

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

interface RevokeKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  keyName: string;
  isPending: boolean;
}

export function RevokeKeyDialog({
  open,
  onOpenChange,
  onConfirm,
  keyName,
  isPending,
}: RevokeKeyDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        className="inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
      >
        Revoke Key
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Revoke API Key</DialogTitle>
        <DialogDescription>
          Are you sure you want to revoke <strong>{keyName}</strong>? This action cannot
          be undone. Any agents using this key will immediately lose access.
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
            onClick={onConfirm}
            disabled={isPending}
            className="gap-1.5"
          >
            {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            Revoke
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
