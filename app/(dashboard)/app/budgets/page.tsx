"use client";

import { ChevronDown, ChevronRight, Clock, DollarSign, Loader2, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
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
import { useSession } from "@/lib/queries/session";
import {
  useBudgets,
  useBudgetSources,
  useCreateBudget,
  useCurrentUserId,
  useDeleteBudget,
  useResetBudget,
  useVelocityStatus,
  type VelocityStateEntry,
} from "@/lib/queries/budgets";
import {
  budgetHealthColor,
  formatMicrodollars,
} from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { parseDeepLink } from "./deep-link";

interface BudgetData {
  id: string;
  entityType: string;
  entityId: string;
  maxBudgetMicrodollars: number;
  spendMicrodollars: number;
  policy: string;
  resetInterval: string | null;
  currentPeriodStart: string | null;
  velocityLimitMicrodollars: number | null;
  velocityWindowSeconds: number | null;
  velocityCooldownSeconds: number | null;
  thresholdPercentages: number[];
  sessionLimitMicrodollars: number | null;
}

export default function BudgetsPage() {
  const { data, isLoading, error } = useBudgets();
  const { data: keysData } = useApiKeys();
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const canCreate = session?.role === "owner" || session?.role === "admin" || session?.role === "member";
  const canManage = session?.role === "owner" || session?.role === "admin";
  const [createOpen, setCreateOpen] = useState(false);
  const [editBudget, setEditBudget] = useState<EditBudgetData | undefined>();
  const [defaultValues, setDefaultValues] = useState<DefaultValues | undefined>();
  const [highlightedBudgetId, setHighlightedBudgetId] = useState<string | null>(null);
  const deepLinkHandled = useRef(false);

  const budgets = data?.data ?? [];
  const keys = keysData?.data ?? [];
  const hasAnyVelocity = budgets.some((b) => b.velocityLimitMicrodollars != null);
  const { data: velocityData } = useVelocityStatus(hasAnyVelocity);
  const velocityEntries = velocityData?.velocityState ?? [];
  const keyMap = new Map(keys.map((k) => [k.id, k.name]));

  // Deep-link: ?create=api_key&entityId=xxx → auto-open create dialog pre-filled
  // Deep-link: ?selected=xxx → highlight that budget row
  useEffect(() => {
    if (deepLinkHandled.current) return;
    if (!data || !keysData) return; // wait for both to load

    const keyIds = (keysData.data ?? []).map((k) => k.id);
    const result = parseDeepLink(searchParams, keyIds);

    let timerId: ReturnType<typeof setTimeout> | undefined;

    if (result.action === "create") {
      deepLinkHandled.current = true;
      setDefaultValues({
        entityType: "api_key",
        entityId: result.entityId,
      });
      setCreateOpen(true);
    } else if (result.action === "highlight" && result.budgetId) {
      deepLinkHandled.current = true;
      setHighlightedBudgetId(result.budgetId);
      timerId = setTimeout(() => setHighlightedBudgetId(null), 3000);
    }

    return () => {
      if (timerId) clearTimeout(timerId);
    };
  }, [data, keysData, searchParams]);

  function handleEditClick(budget: BudgetData) {
    const isDefaultThresholds =
      budget.thresholdPercentages.length === 4 &&
      budget.thresholdPercentages[0] === 50 &&
      budget.thresholdPercentages[1] === 80 &&
      budget.thresholdPercentages[2] === 90 &&
      budget.thresholdPercentages[3] === 95;
    setEditBudget({
      entityType: budget.entityType as "user" | "api_key" | "tag",
      entityId: budget.entityId,
      policy: budget.policy,
      limitDollars: (budget.maxBudgetMicrodollars / 1_000_000).toString(),
      resetInterval: budget.resetInterval ?? "none",
      velocityLimitDollars: budget.velocityLimitMicrodollars != null
        ? (budget.velocityLimitMicrodollars / 1_000_000).toString()
        : "",
      velocityWindowSeconds: budget.velocityWindowSeconds != null
        ? String(budget.velocityWindowSeconds)
        : "60",
      velocityCooldownSeconds: budget.velocityCooldownSeconds != null
        ? String(budget.velocityCooldownSeconds)
        : "60",
      thresholdPercentages: isDefaultThresholds ? "" : budget.thresholdPercentages.join(", "),
      _thresholdsCustomized: !isDefaultThresholds,
      sessionLimitDollars: budget.sessionLimitMicrodollars != null
        ? (budget.sessionLimitMicrodollars / 1_000_000).toString()
        : "",
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
            Manage spending limits for your account, API keys, and tags.
          </p>
        </div>
        {canCreate && budgets.length > 0 && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            Set Budget
          </button>
        )}
      </div>

      {/* Create dialog (no trigger — opened by header button, empty state CTA, or deep-link) */}
      <BudgetDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setDefaultValues(undefined);
        }}
        defaultValues={defaultValues}
      />

      {/* Edit dialog (no trigger — opened by row menu) */}
      {canManage && editBudget && (
        <BudgetDialog
          key={editBudget.entityId}
          open={true}
          onOpenChange={(open) => { if (!open) setEditBudget(undefined); }}
          editBudget={editBudget}
        />
      )}

      {isLoading && <BudgetsSkeleton />}

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
          Failed to load budgets. Please try again.
        </div>
      )}

      {data && budgets.length === 0 && (
        <EmptyBudgets onCreateClick={() => setCreateOpen(true)} canCreate={!!canCreate} />
      )}

      {data && budgets.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                        : budget.entityType === "tag"
                          ? budget.entityId
                          : keyMap.get(budget.entityId) ?? budget.entityId.slice(0, 8)
                    }
                    onEditClick={() => handleEditClick(budget)}
                    velocityEntries={velocityEntries}
                    canManage={!!canManage}
                    highlighted={budget.id === highlightedBudgetId}
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

/** Strip ns_{prefix}_ from external ID to get raw UUID for matching against DO entity_key. */
function matchesEntityKey(
  budgetEntityType: string,
  budgetEntityId: string,
  velocityEntityKey: string,
): boolean {
  // velocityEntityKey is "entityType:entityId" (raw internal IDs)
  // budgetEntityId is "ns_{prefix}_{uuid}" (external prefixed IDs)
  const rawId = budgetEntityId.replace(/^ns_[a-z]+_/, "");
  return velocityEntityKey === `${budgetEntityType}:${rawId}`;
}

function BudgetRow({
  budget,
  entityName,
  onEditClick,
  velocityEntries,
  canManage,
  highlighted,
}: {
  budget: BudgetData;
  entityName: string;
  onEditClick: () => void;
  velocityEntries: VelocityStateEntry[];
  canManage: boolean;
  highlighted?: boolean;
}) {
  const resetBudget = useResetBudget();
  const deleteBudget = useDeleteBudget();
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { data: sourcesData, isLoading: sourcesLoading } = useBudgetSources(expanded ? budget.id : null);

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

  // Velocity status
  const hasVelocity = budget.velocityLimitMicrodollars != null;
  const velocityEntry = hasVelocity
    ? velocityEntries.find((v) => matchesEntityKey(budget.entityType, budget.entityId, v.entity_key))
    : undefined;
  const cooldownMs = (budget.velocityCooldownSeconds ?? 60) * 1000;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const hasActiveCooldown = velocityEntry?.tripped_at != null
      && (velocityEntry.tripped_at + cooldownMs > Date.now());
    if (!hasActiveCooldown) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [velocityEntry?.tripped_at, cooldownMs]);
  const isInCooldown = velocityEntry?.tripped_at != null
    && (velocityEntry.tripped_at + cooldownMs > now);
  const cooldownRemainingSec = isInCooldown
    ? Math.ceil((velocityEntry!.tripped_at! + cooldownMs - now) / 1000)
    : 0;

  const sources = sourcesData?.data ?? [];

  return (
    <>
    <TableRow
      className={cn(
        "border-border/30 cursor-pointer transition-colors hover:bg-accent/40",
        highlighted && "ring-1 ring-primary/50 bg-primary/5",
      )}
      onClick={() => setExpanded((e) => !e)}
    >
      <TableCell>
        <div className="flex items-center gap-1.5">
          {expanded
            ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
            : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
          <div>
            {budget.entityType === "api_key" ? (
              <Link
                href={`/app/keys?selected=${budget.entityId}`}
                className="text-[13px] font-medium text-foreground hover:text-primary transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                {entityName}
              </Link>
            ) : (
              <p className="text-[13px] font-medium text-foreground">{entityName}</p>
            )}
            <div className="flex items-center gap-1.5">
              <p className="text-[11px] text-muted-foreground/70">
                {budget.entityType === "user" && "All requests across your account"}
                {budget.entityType === "api_key" && "Requests from this key only"}
                {budget.entityType === "tag" && `All requests tagged ${budget.entityId} (any key)`}
              </p>
              <span className={cn(
                "inline-flex rounded-full border px-1.5 py-0 text-[10px] font-medium leading-4",
                budget.policy === "strict_block" && "border-red-500/20 bg-red-500/10 text-red-400",
                budget.policy === "soft_block" && "border-amber-500/20 bg-amber-500/10 text-amber-400",
                budget.policy === "warn" && "border-blue-500/20 bg-blue-500/10 text-blue-400",
              )}>
                {budget.policy === "strict_block" ? "Block" : budget.policy === "soft_block" ? "Warn" : "Track"}
              </span>
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] tabular-nums text-foreground">
            {formatMicrodollars(budget.maxBudgetMicrodollars)}
          </span>
          {hasVelocity && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title={`Velocity: ${formatMicrodollars(budget.velocityLimitMicrodollars!)}/${budget.velocityWindowSeconds}s`}>
              <Zap className="h-3 w-3" />
            </span>
          )}
          {budget.sessionLimitMicrodollars != null && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title={`Session limit: ${formatMicrodollars(budget.sessionLimitMicrodollars)}`}>
              <Clock className="h-3 w-3" />
            </span>
          )}
          {isInCooldown && (
            <span className="inline-flex items-center rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-red-400">
              Cooldown {cooldownRemainingSec}s
            </span>
          )}
        </div>
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
      {canManage && (
        <TableCell onClick={(e) => e.stopPropagation()}>
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
                  {resetBudget.isPending ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" />Resetting...</> : "Reset Spend"}
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
                  {deleteBudget.isPending ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" />Deleting...</> : "Delete Budget"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TableCell>
      )}
    </TableRow>
    {expanded && (
      <TableRow className="border-border/30 bg-muted/20">
        <TableCell colSpan={canManage ? 5 : 4} className="py-3">
          {sourcesLoading ? (
            <div className="flex items-center gap-2 pl-5">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              <span className="text-[12px] text-muted-foreground">Loading source breakdown...</span>
            </div>
          ) : sources.length > 0 ? (
            <div className="flex items-center gap-4 pl-5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                By Source
              </span>
              {sources.map((s) => (
                <div key={s.source} className="flex items-center gap-1.5">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${SOURCE_STYLES[s.source] ?? "bg-secondary text-muted-foreground border-border/50"}`}>
                    {SOURCE_LABELS[s.source] ?? s.source}
                  </span>
                  <span className="text-[12px] tabular-nums text-foreground">
                    {formatMicrodollars(s.totalCostMicrodollars)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    ({s.requestCount.toLocaleString()} req)
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="pl-5 text-[12px] text-muted-foreground">
              No cost events for this budget in the last 30 days.
            </p>
          )}
        </TableCell>
      </TableRow>
    )}
    </>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  proxy: "Proxy",
  api: "SDK",
  mcp: "MCP",
};

const SOURCE_STYLES: Record<string, string> = {
  proxy: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  api: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  mcp: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

interface EditBudgetData {
  entityType: "user" | "api_key" | "tag";
  entityId: string;
  policy: string;
  limitDollars: string;
  resetInterval: string;
  velocityLimitDollars: string;
  velocityWindowSeconds: string;
  velocityCooldownSeconds: string;
  thresholdPercentages: string;
  _thresholdsCustomized?: boolean;
  sessionLimitDollars: string;
}

interface DefaultValues {
  entityType: "api_key";
  entityId?: string;
}

function BudgetDialog({
  open,
  onOpenChange,
  editBudget,
  defaultValues,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editBudget?: EditBudgetData;
  defaultValues?: DefaultValues;
}) {
  const isEdit = !!editBudget;
  const createBudget = useCreateBudget();
  const { data: userId } = useCurrentUserId();
  const { data: keysData } = useApiKeys();
  const keys = keysData?.data ?? [];

  const [entityType, setEntityType] = useState<"user" | "api_key" | "tag">(
    editBudget?.entityType ?? defaultValues?.entityType ?? "user",
  );
  const [selectedKeyId, setSelectedKeyId] = useState(
    editBudget?.entityType === "api_key"
      ? editBudget.entityId
      : defaultValues?.entityId ?? "",
  );
  const [tagKey, setTagKey] = useState(
    editBudget?.entityType === "tag" ? editBudget.entityId.split("=")[0] : "",
  );
  const [tagValue, setTagValue] = useState(
    editBudget?.entityType === "tag" ? editBudget.entityId.slice(editBudget.entityId.indexOf("=") + 1) : "",
  );
  const [limitDollars, setLimitDollars] = useState(editBudget?.limitDollars ?? "");
  const [resetInterval, setResetInterval] = useState<string>(
    editBudget?.resetInterval ?? "none",
  );
  const [velocityEnabled, setVelocityEnabled] = useState(!!editBudget?.velocityLimitDollars);
  const [velocityLimitDollars, setVelocityLimitDollars] = useState(editBudget?.velocityLimitDollars ?? "");
  const [velocityWindowSeconds, setVelocityWindowSeconds] = useState(editBudget?.velocityWindowSeconds ?? "60");
  const [velocityCooldownSeconds, setVelocityCooldownSeconds] = useState(editBudget?.velocityCooldownSeconds ?? "60");
  const [thresholdsCustomized, setThresholdsCustomized] = useState(editBudget?._thresholdsCustomized ?? !!editBudget?.thresholdPercentages);
  const [thresholdPercentages, setThresholdPercentages] = useState(editBudget?.thresholdPercentages ?? "");
  const [policy, setPolicy] = useState(editBudget?.policy ?? "strict_block");
  const [sessionLimitEnabled, setSessionLimitEnabled] = useState(!!editBudget?.sessionLimitDollars);
  const [sessionLimitDollars, setSessionLimitDollars] = useState(editBudget?.sessionLimitDollars ?? "");

  function resetForm() {
    setEntityType("user");
    setSelectedKeyId("");
    setTagKey("");
    setTagValue("");
    setLimitDollars("");
    setPolicy("strict_block");
    setResetInterval("none");
    setVelocityEnabled(false);
    setVelocityLimitDollars("");
    setVelocityWindowSeconds("60");
    setVelocityCooldownSeconds("60");
    setThresholdsCustomized(false);
    setThresholdPercentages("");
    setSessionLimitEnabled(false);
    setSessionLimitDollars("");
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
        : entityType === "tag"
          ? `${tagKey.trim()}=${tagValue.trim()}`
          : selectedKeyId;

    if (!entityId) {
      toast.error(
        entityType === "user"
          ? "Could not determine your user ID"
          : entityType === "tag"
            ? "Enter a tag key and value"
            : "Select an API key",
      );
      return;
    }

    if (entityType === "tag" && (!tagKey.trim() || !tagValue.trim())) {
      toast.error("Both tag key and value are required");
      return;
    }

    if (velocityEnabled) {
      const velDollars = parseFloat(velocityLimitDollars);
      if (isNaN(velDollars) || velDollars <= 0) {
        toast.error("Enter a valid velocity limit amount");
        return;
      }
    }

    if (sessionLimitEnabled) {
      const sessDollars = parseFloat(sessionLimitDollars);
      if (isNaN(sessDollars) || sessDollars <= 0) {
        toast.error("Enter a valid session limit amount");
        return;
      }
    }

    const velocityLimit = velocityEnabled && velocityLimitDollars
      ? Math.round(parseFloat(velocityLimitDollars) * 1_000_000)
      : null;

    // Parse custom thresholds: split on comma/space, strip %, filter empties, sort, dedupe
    let parsedThresholds: number[] | undefined;
    if (thresholdsCustomized && thresholdPercentages.trim()) {
      const raw = thresholdPercentages
        .replace(/%/g, "")
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => parseInt(s, 10))
        .filter((n) => !isNaN(n));
      parsedThresholds = [...new Set(raw)].sort((a, b) => a - b);
      if (parsedThresholds.some((n) => n < 1 || n > 100)) {
        toast.error("Threshold values must be between 1 and 100");
        return;
      }
      if (parsedThresholds.length > 10) {
        toast.error("Maximum 10 threshold values allowed");
        return;
      }
    } else if (thresholdsCustomized) {
      // Explicitly customized but empty = no thresholds
      parsedThresholds = [];
    }

    createBudget.mutate(
      {
        entityType,
        entityId,
        maxBudgetMicrodollars: Math.round(dollars * 1_000_000),
        policy: policy as "strict_block" | "soft_block" | "warn",
        resetInterval:
          resetInterval === "none"
            ? undefined
            : (resetInterval as "daily" | "weekly" | "monthly"),
        velocityLimitMicrodollars: velocityLimit,
        ...(velocityEnabled && {
          velocityWindowSeconds: parseInt(velocityWindowSeconds, 10) || 60,
          velocityCooldownSeconds: parseInt(velocityCooldownSeconds, 10) || 60,
        }),
        ...(parsedThresholds !== undefined && { thresholdPercentages: parsedThresholds }),
        sessionLimitMicrodollars: sessionLimitEnabled && sessionLimitDollars
          ? Math.round(parseFloat(sessionLimitDollars) * 1_000_000)
          : null,
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
    (isEdit || (
      entityType === "user" ? !!userId :
      entityType === "tag" ? !!(tagKey.trim() && tagValue.trim()) :
      !!selectedKeyId
    ));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogTitle>{isEdit ? "Edit Budget" : "Set Budget"}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Update the spending limit or reset interval."
            : "Set a spending limit for your account, an API key, or a tag."}
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
              <button
                type="button"
                onClick={() => !isEdit && setEntityType("tag")}
                disabled={isEdit}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors",
                  entityType === "tag"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/50 bg-secondary text-muted-foreground hover:text-foreground",
                  isEdit && "cursor-default opacity-60",
                )}
              >
                Tag
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground/70">
              {entityType === "user" && "Caps total spend across all keys and requests."}
              {entityType === "api_key" && "Caps spend for one specific API key."}
              {entityType === "tag" && "Caps spend for all requests with a matching tag, regardless of which key sends them."}
            </p>
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
                <Select
                  value={selectedKeyId}
                  onValueChange={(v) => setSelectedKeyId(v ?? "")}
                  items={keys.map((key) => ({ value: key.id, label: key.name }))}
                >
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

          {entityType === "tag" && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Tag</Label>
              {isEdit ? (
                <p className="text-xs font-mono text-foreground/80">{editBudget.entityId}</p>
              ) : (
                <div className="flex gap-2">
                  <Input
                    placeholder="key (e.g. customer)"
                    value={tagKey}
                    onChange={(e) => setTagKey(e.target.value)}
                    className="h-9 flex-1 font-mono text-[13px]"
                  />
                  <span className="flex items-center text-xs text-muted-foreground">=</span>
                  <Input
                    placeholder="value (e.g. acme)"
                    value={tagValue}
                    onChange={(e) => setTagValue(e.target.value)}
                    className="h-9 flex-1 font-mono text-[13px]"
                  />
                </div>
              )}
              {(() => {
                const tagId = tagKey.trim() && tagValue.trim() ? `${tagKey.trim()}=${tagValue.trim()}` : null;
                const matchingKeys = tagId
                  ? keys.filter((k) => k.defaultTags?.[tagKey.trim()] === tagValue.trim())
                  : [];

                return (
                  <div className="space-y-1">
                    {tagId && matchingKeys.length > 0 ? (
                      <p className="text-[10px] text-emerald-400">
                        Applies to {matchingKeys.length} key{matchingKeys.length > 1 ? "s" : ""}: {matchingKeys.map((k) => k.name).join(", ")}
                      </p>
                    ) : tagId ? (
                      <p className="text-[10px] text-amber-400">
                        No keys have this tag as a default. Requests must send it via the X-NullSpend-Tags header.
                      </p>
                    ) : (
                      <p className="text-[10px] text-muted-foreground">
                        Enter a tag to see which keys it applies to.
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground/70">
                      Tag budgets apply to all requests with this tag, from any key.
                    </p>
                  </div>
                );
              })()}
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
                className={cn(
                  "h-9 border-border/50 bg-background pl-7 text-[13px] tabular-nums placeholder:text-muted-foreground/50",
                  limitDollars && (isNaN(parseFloat(limitDollars)) || parseFloat(limitDollars) <= 0) && "border-red-500/50",
                )}
              />
            </div>
            {limitDollars && (isNaN(parseFloat(limitDollars)) || parseFloat(limitDollars) <= 0) && (
              <p className="text-[11px] text-red-400">Enter a positive dollar amount</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Enforcement mode</Label>
            <div className="flex gap-2">
              {([
                { value: "strict_block", label: "Block Requests" },
                { value: "soft_block", label: "Allow + Warn" },
                { value: "warn", label: "Track Only" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPolicy(opt.value)}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors",
                    policy === opt.value
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border/50 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/70">
              Block = deny requests over budget. Other modes allow requests but still fire webhook alerts.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Reset interval</Label>
            <Select
              value={resetInterval}
              onValueChange={(v) => setResetInterval(v ?? "none")}
              items={[
                { value: "none", label: "None (manual reset)" },
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
                { value: "monthly", label: "Monthly" },
              ]}
            >
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

          {/* Velocity limit section */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setVelocityEnabled(!velocityEnabled)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronRight className={cn(
                "h-3 w-3 transition-transform",
                velocityEnabled && "rotate-90",
              )} />
              <Zap className="h-3 w-3" />
              {velocityEnabled ? "Velocity limit (enabled)" : "Velocity limit (optional)"}
            </button>

            {velocityEnabled && (
              <div className="space-y-3 rounded-md border border-border/30 bg-secondary/20 p-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Velocity limit</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">
                      $
                    </span>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="10.00"
                      value={velocityLimitDollars}
                      onChange={(e) => setVelocityLimitDollars(e.target.value)}
                      className={cn(
                        "h-9 border-border/50 bg-background pl-7 text-[13px] tabular-nums placeholder:text-muted-foreground/50",
                        velocityLimitDollars && (isNaN(parseFloat(velocityLimitDollars)) || parseFloat(velocityLimitDollars) <= 0) && "border-red-500/50",
                      )}
                    />
                  </div>
                  {velocityLimitDollars && (isNaN(parseFloat(velocityLimitDollars)) || parseFloat(velocityLimitDollars) <= 0) ? (
                    <p className="text-[10px] text-red-400">Enter a positive dollar amount</p>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">
                      Max spend per sliding window. Triggers a cooldown if exceeded.
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Window (seconds)</Label>
                    <Input
                      type="number"
                      min="10"
                      max="3600"
                      value={velocityWindowSeconds}
                      onChange={(e) => setVelocityWindowSeconds(e.target.value)}
                      className="h-9 border-border/50 bg-background text-[13px] tabular-nums"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Cooldown (seconds)</Label>
                    <Input
                      type="number"
                      min="10"
                      max="3600"
                      value={velocityCooldownSeconds}
                      onChange={(e) => setVelocityCooldownSeconds(e.target.value)}
                      className="h-9 border-border/50 bg-background text-[13px] tabular-nums"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Threshold alerts section */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setThresholdsCustomized(!thresholdsCustomized)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronRight className={cn(
                "h-3 w-3 transition-transform",
                thresholdsCustomized && "rotate-90",
              )} />
              {thresholdsCustomized ? "Alert thresholds (custom)" : "Alert thresholds (optional)"}
            </button>

            {thresholdsCustomized && (
              <div className="space-y-1.5 rounded-md border border-border/30 bg-secondary/20 p-3">
                <Label className="text-xs text-muted-foreground">Threshold percentages</Label>
                <Input
                  type="text"
                  placeholder="50, 80, 90, 95"
                  value={thresholdPercentages}
                  onChange={(e) => setThresholdPercentages(e.target.value)}
                  className="h-9 border-border/50 bg-background text-[13px] tabular-nums placeholder:text-muted-foreground/50"
                />
                <p className="text-[10px] text-muted-foreground">
                  Comma-separated percentages (1-100). Webhook alerts fire when spend crosses each threshold. Leave empty to disable alerts.
                </p>
              </div>
            )}
          </div>

          {/* Session limit section */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setSessionLimitEnabled(!sessionLimitEnabled)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronRight className={cn(
                "h-3 w-3 transition-transform",
                sessionLimitEnabled && "rotate-90",
              )} />
              <Clock className="h-3 w-3" />
              {sessionLimitEnabled ? "Session limit (enabled)" : "Session limit (optional)"}
            </button>

            {sessionLimitEnabled && (
              <div className="space-y-1.5 rounded-md border border-border/30 bg-secondary/20 p-3">
                <Label className="text-xs text-muted-foreground">Session limit</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">
                    $
                  </span>
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="5.00"
                    value={sessionLimitDollars}
                    onChange={(e) => setSessionLimitDollars(e.target.value)}
                    className={cn(
                      "h-9 border-border/50 bg-background pl-7 text-[13px] tabular-nums placeholder:text-muted-foreground/50",
                      sessionLimitDollars && (isNaN(parseFloat(sessionLimitDollars)) || parseFloat(sessionLimitDollars) <= 0) && "border-red-500/50",
                    )}
                  />
                </div>
                {sessionLimitDollars && (isNaN(parseFloat(sessionLimitDollars)) || parseFloat(sessionLimitDollars) <= 0) ? (
                  <p className="text-[10px] text-red-400">Enter a positive dollar amount</p>
                ) : (
                  <p className="text-[10px] text-muted-foreground">
                    Max spend per session. Agents set sessions via X-NullSpend-Session-Id header. Hard cap regardless of budget policy.
                  </p>
                )}
              </div>
            )}
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
              ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" />{isEdit ? "Saving..." : "Creating..."}</>
              : isEdit ? "Save Changes" : "Set Budget"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyBudgets({ onCreateClick, canCreate }: { onCreateClick: () => void; canCreate: boolean }) {
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
      {canCreate && (
        <Button size="sm" onClick={onCreateClick}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Set Budget
        </Button>
      )}
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
