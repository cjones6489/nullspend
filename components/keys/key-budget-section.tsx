"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useBudgets, useCreateBudget, useDeleteBudget } from "@/lib/queries/budgets";
import { formatMicrodollars } from "@/lib/utils/format";

interface KeyBudgetSectionProps {
  keyId: string;
  canManage: boolean;
}

interface BudgetRecord {
  id: string;
  entityType: string;
  entityId: string;
  maxBudgetMicrodollars: number;
  spendMicrodollars: number;
  policy: string;
  resetInterval: string | null;
  thresholdPercentages: number[];
  velocityLimitMicrodollars: number | null;
  velocityWindowSeconds: number | null;
  velocityCooldownSeconds: number | null;
  sessionLimitMicrodollars: number | null;
}

export function KeyBudgetSection({ keyId, canManage }: KeyBudgetSectionProps) {
  const { data: budgetsData } = useBudgets();
  const deleteBudget = useDeleteBudget();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Find the budget for this specific key
  const keyBudget = budgetsData?.data.find(
    (b: BudgetRecord) => b.entityType === "api_key" && b.entityId === keyId,
  ) as BudgetRecord | undefined;

  if (!keyBudget) {
    return (
      <Card className="border-border/50 bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Budget
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-[13px] text-muted-foreground">
            No budget set for this key. Requests are tracked but not capped.
          </p>
          {canManage && (
            <CreateBudgetDialog
              keyId={keyId}
              open={createOpen}
              onOpenChange={setCreateOpen}
            />
          )}
        </CardContent>
      </Card>
    );
  }

  const spendPercent = keyBudget.maxBudgetMicrodollars > 0
    ? Math.min(100, (keyBudget.spendMicrodollars / keyBudget.maxBudgetMicrodollars) * 100)
    : 0;

  const isOverThreshold = spendPercent >= 80;

  return (
    <>
      {/* Budget */}
      <Card className="border-border/50 bg-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Budget
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] capitalize">
              {keyBudget.policy.replace("_", " ")}
            </Badge>
            {keyBudget.resetInterval && (
              <Badge variant="secondary" className="text-[10px] capitalize">
                {keyBudget.resetInterval}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-semibold tabular-nums text-foreground">
              {formatMicrodollars(keyBudget.spendMicrodollars)}
            </span>
            <span className="text-[13px] text-muted-foreground">
              of {formatMicrodollars(keyBudget.maxBudgetMicrodollars)}
            </span>
          </div>
          <Progress
            value={spendPercent}
            className={isOverThreshold ? "[&>div]:bg-amber-500" : ""}
          />
          {canManage && (
            <div className="flex gap-2 pt-1">
              <CreateBudgetDialog
                keyId={keyId}
                open={createOpen}
                onOpenChange={setCreateOpen}
                existingBudget={keyBudget}
              />
              <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <DialogTrigger
                  className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-red-400 transition-colors hover:bg-red-500/10"
                >
                  <Trash2 className="h-3 w-3" />
                  Remove
                </DialogTrigger>
                <DialogContent>
                  <DialogTitle>Remove Budget</DialogTitle>
                  <DialogDescription>
                    This will remove the spending cap from this key. Requests will still be tracked but not limited.
                  </DialogDescription>
                  <DialogFooter>
                    <DialogClose
                      className="inline-flex h-8 items-center justify-center rounded-md border border-border/50 bg-secondary px-3 text-xs font-medium text-foreground hover:bg-accent"
                    >
                      Cancel
                    </DialogClose>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={deleteBudget.isPending}
                      onClick={async () => {
                        try {
                          await deleteBudget.mutateAsync(keyBudget.id);
                          toast.success("Budget removed");
                          setDeleteOpen(false);
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Failed to remove budget");
                        }
                      }}
                    >
                      {deleteBudget.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                      Remove
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Velocity Limit */}
      {keyBudget.velocityLimitMicrodollars != null && (
        <Card className="border-border/50 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Velocity Limit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[13px] text-foreground">
              {formatMicrodollars(keyBudget.velocityLimitMicrodollars)} per{" "}
              {keyBudget.velocityWindowSeconds}s window
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {keyBudget.velocityCooldownSeconds}s cooldown after breach
            </p>
          </CardContent>
        </Card>
      )}

      {/* Session Limit */}
      {keyBudget.sessionLimitMicrodollars != null && (
        <Card className="border-border/50 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Session Limit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[13px] text-foreground">
              {formatMicrodollars(keyBudget.sessionLimitMicrodollars)} per session
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Each unique x-nullspend-session value gets its own cap
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Create/Update Budget Dialog
// ---------------------------------------------------------------------------

function CreateBudgetDialog({
  keyId,
  open,
  onOpenChange,
  existingBudget,
}: {
  keyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingBudget?: BudgetRecord;
}) {
  const createBudget = useCreateBudget();
  const isUpdate = !!existingBudget;

  const [maxDollars, setMaxDollars] = useState(
    existingBudget ? String(existingBudget.maxBudgetMicrodollars / 1_000_000) : "",
  );
  const [resetInterval, setResetInterval] = useState<string>(
    existingBudget?.resetInterval ?? "",
  );
  const [velocityDollars, setVelocityDollars] = useState(
    existingBudget?.velocityLimitMicrodollars != null
      ? String(existingBudget.velocityLimitMicrodollars / 1_000_000)
      : "",
  );
  const [velocityWindow, setVelocityWindow] = useState(
    existingBudget?.velocityWindowSeconds != null
      ? String(existingBudget.velocityWindowSeconds)
      : "60",
  );
  const [sessionDollars, setSessionDollars] = useState(
    existingBudget?.sessionLimitMicrodollars != null
      ? String(existingBudget.sessionLimitMicrodollars / 1_000_000)
      : "",
  );

  const handleSubmit = async () => {
    const maxMicro = Math.round(parseFloat(maxDollars) * 1_000_000);
    if (!maxMicro || maxMicro <= 0) {
      toast.error("Budget must be a positive dollar amount");
      return;
    }

    const velocityMicro = velocityDollars
      ? Math.round(parseFloat(velocityDollars) * 1_000_000)
      : null;
    const sessionMicro = sessionDollars
      ? Math.round(parseFloat(sessionDollars) * 1_000_000)
      : null;

    try {
      await createBudget.mutateAsync({
        entityType: "api_key",
        entityId: keyId,
        maxBudgetMicrodollars: maxMicro,
        resetInterval: (resetInterval || undefined) as "daily" | "weekly" | "monthly" | undefined,
        velocityLimitMicrodollars: velocityMicro,
        velocityWindowSeconds: velocityMicro ? parseInt(velocityWindow) || 60 : undefined,
        sessionLimitMicrodollars: sessionMicro,
      });
      toast.success(isUpdate ? "Budget updated" : "Budget created");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save budget");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        className="inline-flex h-7 items-center gap-1 rounded-md border border-border/50 px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
      >
        {isUpdate ? "Edit" : <><Plus className="h-3 w-3" /> Add Budget</>}
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{isUpdate ? "Edit Budget" : "Set Budget"}</DialogTitle>
        <DialogDescription>
          {isUpdate
            ? "Update the spending limits for this key."
            : "Set a spending cap for this API key. The proxy will block requests when the budget is exceeded."}
        </DialogDescription>

        <div className="space-y-4 py-2">
          {/* Max Budget */}
          <div>
            <Label className="text-[13px]">Budget Cap ($)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={maxDollars}
              onChange={(e) => setMaxDollars(e.target.value)}
              placeholder="e.g. 50.00"
              className="mt-1"
            />
          </div>

          {/* Reset Interval */}
          <div>
            <Label className="text-[13px]">Reset Period</Label>
            <div className="mt-1 flex gap-2">
              {["", "daily", "weekly", "monthly"].map((interval) => (
                <button
                  key={interval}
                  type="button"
                  onClick={() => setResetInterval(interval)}
                  className={`rounded-md border px-3 py-1.5 text-[12px] font-medium capitalize transition-colors ${
                    resetInterval === interval
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {interval || "None"}
                </button>
              ))}
            </div>
          </div>

          {/* Velocity Limit */}
          <div>
            <Label className="text-[13px]">Velocity Limit ($ per window)</Label>
            <p className="text-[11px] text-muted-foreground">
              Rate limit: max spend within a sliding time window. Leave empty to disable.
            </p>
            <div className="mt-1 flex gap-2">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={velocityDollars}
                onChange={(e) => setVelocityDollars(e.target.value)}
                placeholder="e.g. 5.00"
                className="flex-1"
              />
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-muted-foreground">per</span>
                <Input
                  type="number"
                  min="10"
                  max="3600"
                  value={velocityWindow}
                  onChange={(e) => setVelocityWindow(e.target.value)}
                  className="w-20"
                />
                <span className="text-[11px] text-muted-foreground">sec</span>
              </div>
            </div>
          </div>

          {/* Session Limit */}
          <div>
            <Label className="text-[13px]">Session Limit ($)</Label>
            <p className="text-[11px] text-muted-foreground">
              Max spend per agent session (x-nullspend-session header). Leave empty to disable.
            </p>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={sessionDollars}
              onChange={(e) => setSessionDollars(e.target.value)}
              placeholder="e.g. 2.00"
              className="mt-1"
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose
            className="inline-flex h-8 items-center justify-center rounded-md border border-border/50 bg-secondary px-3 text-xs font-medium text-foreground hover:bg-accent"
          >
            Cancel
          </DialogClose>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!maxDollars || createBudget.isPending}
            className="gap-1.5"
          >
            {createBudget.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            {isUpdate ? "Update" : "Set Budget"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
