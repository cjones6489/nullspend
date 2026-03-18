"use client";

import { DollarSign, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApiKeys } from "@/lib/queries/api-keys";
import {
  useBudgets,
  useCreateBudget,
  useCurrentUserId,
  useDeleteBudget,
  useResetBudget,
} from "@/lib/queries/budgets";
import {
  budgetHealthColor,
  formatMicrodollars,
} from "@/lib/utils/format";
import { cn } from "@/lib/utils";

interface BudgetData {
  id: string;
  entityType: string;
  entityId: string;
  maxBudgetMicrodollars: number;
  spendMicrodollars: number;
  resetInterval: string | null;
  currentPeriodStart: string | null;
}

export default function BudgetsPage() {
  const { data, isLoading, error } = useBudgets();
  const { data: keysData } = useApiKeys();
  const [createOpen, setCreateOpen] = useState(false);
  const [editBudget, setEditBudget] = useState<EditBudgetData | undefined>();

  const budgets = data?.data ?? [];
  const keyMap = new Map(
    (keysData?.data ?? []).map((k) => [k.id, k.name]),
  );

  function handleEditClick(budget: BudgetData) {
    setEditBudget({
      entityType: budget.entityType as "user" | "api_key",
      entityId: budget.entityId,
      limitDollars: (budget.maxBudgetMicrodollars / 1_000_000).toString(),
      resetInterval: budget.resetInterval ?? "none",
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Budgets
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Manage spending limits for your account and API keys.
          </p>
        </div>
        <BudgetDialog open={createOpen} onOpenChange={setCreateOpen} />
      </div>

      <BudgetDialog
        key={editBudget?.entityId ?? "edit-closed"}
        open={!!editBudget}
        onOpenChange={(open) => { if (!open) setEditBudget(undefined); }}
        editBudget={editBudget}
      />

      {isLoading && <BudgetsSkeleton />}

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
          Failed to load budgets. Please try again.
        </div>
      )}

      {data && budgets.length === 0 && (
        <EmptyBudgets onCreateClick={() => setCreateOpen(true)} />
      )}

      {data && budgets.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <SummaryStats budgets={budgets} />
          </div>

          <div className="overflow-hidden rounded-lg border border-border/50 bg-card">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Entity
                  </TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Limit
                  </TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Spent
                  </TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Reset
                  </TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {budgets.map((budget) => (
                  <BudgetRow
                    key={budget.id}
                    budget={budget}
                    entityName={
                      budget.entityType === "user"
                        ? "Your Account"
                        : keyMap.get(budget.entityId) ?? budget.entityId.slice(0, 8)
                    }
                    onEditClick={() => handleEditClick(budget)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryStats({ budgets }: { budgets: BudgetData[] }) {
  const totalSpend = budgets.reduce((sum, b) => sum + b.spendMicrodollars, 0);
  const atRisk = budgets.filter((b) => {
    if (b.maxBudgetMicrodollars <= 0) return false;
    return (b.spendMicrodollars / b.maxBudgetMicrodollars) * 100 >= 80;
  }).length;

  return (
    <>
      <StatCard label="Active budgets" value={String(budgets.length)} />
      <StatCard label="Total spend" value={formatMicrodollars(totalSpend)} />
      <StatCard
        label="At risk"
        value={String(atRisk)}
        className={atRisk > 0 ? "text-amber-400" : undefined}
      />
    </>
  );
}

function StatCard({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg border border-border/30 bg-background p-3">
      <p className={cn("text-lg font-semibold tabular-nums text-foreground", className)}>
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function BudgetRow({
  budget,
  entityName,
  onEditClick,
}: {
  budget: BudgetData;
  entityName: string;
  onEditClick: () => void;
}) {
  const resetBudget = useResetBudget();
  const deleteBudget = useDeleteBudget();
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const pct =
    budget.maxBudgetMicrodollars > 0
      ? Math.min(
          (budget.spendMicrodollars / budget.maxBudgetMicrodollars) * 100,
          100,
        )
      : 0;

  function handleReset() {
    resetBudget.mutate(budget.id, {
      onSuccess: () => {
        setResetOpen(false);
        toast.success("Budget spend reset to $0.00");
      },
      onError: (err) => toast.error(err.message || "Failed to reset budget"),
    });
  }

  function handleDelete() {
    deleteBudget.mutate(budget.id, {
      onSuccess: () => {
        setDeleteOpen(false);
        toast.success("Budget deleted");
      },
      onError: (err) => toast.error(err.message || "Failed to delete budget"),
    });
  }

  const resetLabel = budget.resetInterval
    ? budget.resetInterval.charAt(0).toUpperCase() + budget.resetInterval.slice(1)
    : "--";

  const daysLeft = computeDaysLeft(budget.resetInterval, budget.currentPeriodStart);

  return (
    <TableRow className="border-border/30 transition-colors hover:bg-accent/40">
      <TableCell>
        <div>
          <p className="text-[13px] font-medium text-foreground">{entityName}</p>
          <p className="text-[11px] text-muted-foreground">{budget.entityType}</p>
        </div>
      </TableCell>
      <TableCell className="text-[13px] tabular-nums text-foreground">
        {formatMicrodollars(budget.maxBudgetMicrodollars)}
      </TableCell>
      <TableCell>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <p className="text-[13px] tabular-nums text-foreground">
              {formatMicrodollars(budget.spendMicrodollars)}{" "}
              <span className="text-muted-foreground">
                / {formatMicrodollars(budget.maxBudgetMicrodollars)}
              </span>
            </p>
            <span className={cn(
              "text-[11px] font-medium tabular-nums",
              pct >= 90 ? "text-red-400" : pct >= 70 ? "text-amber-400" : "text-muted-foreground",
            )}>
              {Math.round(pct)}%
            </span>
          </div>
          <Progress
            value={pct}
            indicatorClassName={budgetHealthColor(
              budget.spendMicrodollars,
              budget.maxBudgetMicrodollars,
            )}
            className="h-1.5 gap-0"
          />
        </div>
      </TableCell>
      <TableCell>
        <div>
          <p className="text-xs text-foreground">{resetLabel}</p>
          {daysLeft !== null && (
            <p className="text-[11px] text-muted-foreground">{daysLeft}d left</p>
          )}
        </div>
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={`Actions for budget "${entityName}"`}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEditClick}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Edit Budget
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setResetOpen(true)}>
              <RotateCcw className="mr-2 h-3.5 w-3.5" />
              Reset Spend
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Delete Budget
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Dialog open={resetOpen} onOpenChange={setResetOpen}>
          <DialogContent>
            <DialogTitle>Reset budget spend?</DialogTitle>
            <DialogDescription>
              This will reset the current spend for &ldquo;{entityName}&rdquo; to
              $0.00. This cannot be undone.
            </DialogDescription>
            <DialogFooter>
              <DialogClose
                className="inline-flex h-8 items-center justify-center rounded-md border border-border/50 bg-secondary px-3 text-xs font-medium text-foreground hover:bg-accent"
                disabled={resetBudget.isPending}
              >
                Cancel
              </DialogClose>
              <Button
                size="sm"
                onClick={handleReset}
                disabled={resetBudget.isPending}
              >
                {resetBudget.isPending ? "Resetting..." : "Reset Spend"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent>
            <DialogTitle>Delete budget?</DialogTitle>
            <DialogDescription>
              This will permanently remove the budget for &ldquo;{entityName}&rdquo;.
              Spending will no longer be tracked against a limit.
            </DialogDescription>
            <DialogFooter>
              <DialogClose
                className="inline-flex h-8 items-center justify-center rounded-md border border-border/50 bg-secondary px-3 text-xs font-medium text-foreground hover:bg-accent"
                disabled={deleteBudget.isPending}
              >
                Cancel
              </DialogClose>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={deleteBudget.isPending}
              >
                {deleteBudget.isPending ? "Deleting..." : "Delete Budget"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TableCell>
    </TableRow>
  );
}

interface EditBudgetData {
  entityType: "user" | "api_key";
  entityId: string;
  limitDollars: string;
  resetInterval: string;
}

function BudgetDialog({
  open,
  onOpenChange,
  editBudget,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editBudget?: EditBudgetData;
}) {
  const isEdit = !!editBudget;
  const createBudget = useCreateBudget();
  const { data: userId } = useCurrentUserId();
  const { data: keysData } = useApiKeys();
  const keys = keysData?.data ?? [];

  const [entityType, setEntityType] = useState<"user" | "api_key">(
    editBudget?.entityType ?? "user",
  );
  const [selectedKeyId, setSelectedKeyId] = useState(
    editBudget?.entityType === "api_key" ? editBudget.entityId : "",
  );
  const [limitDollars, setLimitDollars] = useState(editBudget?.limitDollars ?? "");
  const [resetInterval, setResetInterval] = useState<string>(
    editBudget?.resetInterval ?? "none",
  );

  function resetForm() {
    setEntityType("user");
    setSelectedKeyId("");
    setLimitDollars("");
    setResetInterval("none");
  }

  function handleSubmit() {
    const dollars = parseFloat(limitDollars);
    if (isNaN(dollars) || dollars <= 0) {
      toast.error("Enter a valid budget amount");
      return;
    }

    const entityId = isEdit
      ? editBudget.entityId
      : entityType === "user"
        ? userId
        : selectedKeyId;

    if (!entityId) {
      toast.error(
        entityType === "user"
          ? "Could not determine your user ID"
          : "Select an API key",
      );
      return;
    }

    createBudget.mutate(
      {
        entityType,
        entityId,
        maxBudgetMicrodollars: Math.round(dollars * 1_000_000),
        resetInterval:
          resetInterval === "none"
            ? undefined
            : (resetInterval as "daily" | "weekly" | "monthly"),
      },
      {
        onSuccess: () => {
          toast.success(isEdit ? "Budget updated" : "Budget created");
          if (!isEdit) resetForm();
          onOpenChange(false);
        },
        onError: (err) =>
          toast.error(err.message || `Failed to ${isEdit ? "update" : "create"} budget`),
      },
    );
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen && !isEdit) resetForm();
    onOpenChange(nextOpen);
  }

  const canSubmit =
    limitDollars.trim() !== "" &&
    parseFloat(limitDollars) > 0 &&
    (isEdit || (entityType === "user" ? !!userId : !!selectedKeyId));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      {!isEdit && (
        <DialogTrigger
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          Set Budget
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogTitle>{isEdit ? "Edit Budget" : "Set Budget"}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Update the spending limit or reset interval."
            : "Set a spending limit for your account or an individual API key."}
        </DialogDescription>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Budget for</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => !isEdit && setEntityType("user")}
                disabled={isEdit}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors",
                  entityType === "user"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/50 bg-secondary text-muted-foreground hover:text-foreground",
                  isEdit && "cursor-default opacity-60",
                )}
              >
                Your Account
              </button>
              <button
                type="button"
                onClick={() => !isEdit && setEntityType("api_key")}
                disabled={isEdit}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors",
                  entityType === "api_key"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/50 bg-secondary text-muted-foreground hover:text-foreground",
                  isEdit && "cursor-default opacity-60",
                )}
              >
                API Key
              </button>
            </div>
          </div>

          {entityType === "api_key" && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">API Key</Label>
              {isEdit ? (
                <p className="text-xs text-foreground/80">
                  {keys.find((k) => k.id === editBudget.entityId)?.name ??
                    editBudget.entityId.slice(0, 8)}
                </p>
              ) : keys.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No API keys available. Create a key first.
                </p>
              ) : (
                <Select value={selectedKeyId} onValueChange={(v) => setSelectedKeyId(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a key..." />
                  </SelectTrigger>
                  <SelectContent>
                    {keys.map((key) => (
                      <SelectItem key={key.id} value={key.id}>
                        {key.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="budget-limit" className="text-xs text-muted-foreground">
              {resetInterval === "daily"
                ? "Daily limit"
                : resetInterval === "weekly"
                  ? "Weekly limit"
                  : resetInterval === "monthly"
                    ? "Monthly limit"
                    : "Budget limit"}
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">
                $
              </span>
              <Input
                id="budget-limit"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="100.00"
                value={limitDollars}
                onChange={(e) => setLimitDollars(e.target.value)}
                className="h-9 border-border/50 bg-background pl-7 text-[13px] tabular-nums placeholder:text-muted-foreground/50"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Reset interval</Label>
            <Select value={resetInterval} onValueChange={(v) => setResetInterval(v ?? "none")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (manual reset)</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
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
            disabled={!canSubmit || createBudget.isPending}
          >
            {createBudget.isPending
              ? isEdit ? "Saving..." : "Creating..."
              : isEdit ? "Save Changes" : "Set Budget"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyBudgets({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border/50 py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/50">
        <DollarSign className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">No budgets configured</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Set spending limits for your account or individual API keys.
        </p>
      </div>
      <Button size="sm" onClick={onCreateClick}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Set Budget
      </Button>
    </div>
  );
}

function BudgetsSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg bg-secondary/50" />
      ))}
    </div>
  );
}

function computeDaysLeft(
  resetInterval: string | null,
  currentPeriodStart: string | null,
): number | null {
  if (!resetInterval || !currentPeriodStart) return null;

  const start = new Date(currentPeriodStart);
  const now = new Date();

  let nextReset: Date;
  switch (resetInterval) {
    case "daily":
      nextReset = new Date(start);
      nextReset.setDate(nextReset.getDate() + 1);
      while (nextReset <= now) nextReset.setDate(nextReset.getDate() + 1);
      break;
    case "weekly":
      nextReset = new Date(start);
      nextReset.setDate(nextReset.getDate() + 7);
      while (nextReset <= now) nextReset.setDate(nextReset.getDate() + 7);
      break;
    case "monthly":
      nextReset = new Date(start);
      nextReset.setMonth(nextReset.getMonth() + 1);
      while (nextReset <= now) nextReset.setMonth(nextReset.getMonth() + 1);
      break;
    default:
      return null;
  }

  const diffMs = nextReset.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}
