"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";
import { ArrowDown, ArrowUp, TrendingUp } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  type ChartConfig,
} from "@/components/ui/chart";
import { CopyButton } from "@/components/ui/copy-button";
import { MarginPreviewTable } from "@/components/margins/preview-table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiKeys } from "@/lib/queries/api-keys";
import { useBudgets } from "@/lib/queries/budgets";
import { useCostSummary } from "@/lib/queries/cost-event-summary";
import { useRecentCostEvents } from "@/lib/queries/cost-events";
import { useMarginTable, useStripeConnection } from "@/lib/queries/margins";
import {
  formatMicrodollars,
  formatChartDollars,
  formatModelName,
} from "@/lib/utils/format";
import {
  calculateTrendDelta,
  getAlertCount,
  getBudgetColor,
  formatRelativeTime,
  sortBudgetsByUtilization,
} from "@/lib/utils/dashboard";
import { cn } from "@/lib/utils";

const PROXY_URL = process.env.NEXT_PUBLIC_NULLSPEND_PROXY_URL ?? "https://proxy.nullspend.com/v1";
const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.nullspend.com";

const snippets = {
  Proxy: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${PROXY_URL}",
  defaultHeaders: {
    "X-NullSpend-Key": process.env.NULLSPEND_API_KEY,
  },
});`,
  SDK: `import { NullSpend } from "@nullspend/sdk";

const ns = new NullSpend({
  baseUrl: "${DASHBOARD_URL}",
  apiKey: process.env.NULLSPEND_API_KEY,
  costReporting: {},
});

// Wraps fetch to auto-track cost for every LLM call
const fetch = ns.createTrackedFetch("openai");`,
  "Claude Agent": `import { withNullSpend } from "@nullspend/claude-agent";

const config = withNullSpend({
  apiKey: process.env.NULLSPEND_API_KEY,
  tags: { agent: "my-agent" },
});`,
  cURL: `curl ${PROXY_URL}/chat/completions \\
  -H "Authorization: Bearer $OPENAI_API_KEY" \\
  -H "X-NullSpend-Key: $NULLSPEND_API_KEY" \\
  -d '{
    "model": "gpt-4.1",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`,
} as const;

type TabKey = keyof typeof snippets;
const tabs: TabKey[] = ["Proxy", "SDK", "Claude Agent", "cURL"];

const chartConfig = {
  totalCostMicrodollars: {
    label: "Spend",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<TabKey>("Proxy");
  const { data: keysData, isLoading: keysLoading } = useApiKeys();
  const {
    data: summaryData,
    isLoading: summaryLoading,
    isError: summaryError,
  } = useCostSummary("7d");
  const {
    data: budgetsData,
    isLoading: budgetsLoading,
    isError: budgetsError,
  } = useBudgets();
  const {
    data: recentEventsData,
    isLoading: eventsLoading,
    isError: eventsError,
  } = useRecentCostEvents(4);

  // Margin badge — only fetch if Stripe is connected
  const { data: stripeConnection } = useStripeConnection();
  const isStripeConnected =
    stripeConnection !== null && stripeConnection !== undefined;
  const marginPeriod = (() => {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  })();
  const { data: marginData } = useMarginTable(marginPeriod, {
    enabled: isStripeConnected,
  });

  const keys = keysData?.data ?? [];
  const totals = summaryData?.totals;
  const daily = summaryData?.daily;
  const budgets = useMemo(() => budgetsData?.data ?? [], [budgetsData?.data]);
  const models = summaryData?.models ?? [];
  const events = recentEventsData?.data ?? [];
  const hasData = keys.length > 0;

  const totalSpend = totals?.totalCostMicrodollars ?? 0;
  const totalRequests = totals?.totalRequests ?? 0;
  const trend = daily ? calculateTrendDelta(daily) : null;
  const alertCount = getAlertCount(budgets);

  const sortedBudgets = useMemo(() => sortBudgetsByUtilization(budgets), [budgets]);

  return (
    <div className="space-y-6">
      {/* Page title */}
      <h1 className="text-xl font-semibold tracking-tight text-foreground">
        Home
      </h1>

      {/* Section 1: Hero Spend */}
      {summaryLoading && !summaryData ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
      ) : (
        <div>
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                "font-mono text-xl font-bold tabular-nums md:text-2xl",
                hasData ? "text-foreground" : "text-muted-foreground/50",
              )}
              aria-label={`7-day spend: ${formatMicrodollars(totalSpend)}${
                trend
                  ? `, ${trend.direction === "down" ? "down" : "up"} ${trend.percent} percent`
                  : ""
              }`}
            >
              {formatMicrodollars(totalSpend)}
            </span>
            {trend && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 font-mono text-sm",
                  trend.direction === "down"
                    ? "text-green-400"
                    : "text-red-400",
                )}
              >
                {trend.direction === "down" ? (
                  <ArrowDown className="h-3 w-3" />
                ) : (
                  <ArrowUp className="h-3 w-3" />
                )}
                {trend.percent}%
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {hasData ? "7-day spend" : "No spend yet"}
          </p>
          {!keysLoading && (
            <p className="mt-1 font-mono text-[13px] tabular-nums text-muted-foreground">
              {totalRequests.toLocaleString()} requests ·{" "}
              {keys.length} keys ·{" "}
              {budgetsLoading ? "—" : `${budgets.length} budgets`} ·{" "}
              {budgetsLoading ? (
                "—"
              ) : (
                <span
                  className={alertCount > 0 ? "text-red-400" : "text-green-400"}
                >
                  {alertCount} alerts
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {/* Sections below only show when user has keys (data exists) */}
      {hasData && (
        <>
          {/* Section 2: Spend Chart */}
          <div className="border-t border-border/30 pt-4">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Daily Spend
            </p>
            {summaryLoading && !daily ? (
              <Skeleton className="h-[200px] w-full md:h-[280px]" />
            ) : summaryError && !daily ? (
              <div className="flex h-[200px] items-center justify-center text-[13px] text-muted-foreground md:h-[280px]">
                Unable to load chart data.
              </div>
            ) : daily && daily.length > 0 ? (
              <ChartContainer
                config={chartConfig}
                className="h-[200px] w-full md:h-[280px]"
              >
                <AreaChart data={daily}>
                  <defs>
                    <linearGradient
                      id="fillSpendHome"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor="var(--color-totalCostMicrodollars)"
                        stopOpacity={0.8}
                      />
                      <stop
                        offset="95%"
                        stopColor="var(--color-totalCostMicrodollars)"
                        stopOpacity={0.05}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--border)"
                    opacity={0.3}
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d: string) => {
                      const [y, m, day] = d.split("-").map(Number);
                      return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", {
                        weekday: "short",
                        timeZone: "UTC",
                      });
                    }}
                    tick={{
                      fontSize: 11,
                      fill: "var(--muted-foreground)",
                    }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v: number) => formatChartDollars(v)}
                    tick={{
                      fontSize: 11,
                      fill: "var(--muted-foreground)",
                      fontFamily: "var(--font-mono)",
                    }}
                    axisLine={false}
                    tickLine={false}
                    width={50}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null;
                      const d = payload[0].payload as {
                        date: string;
                        totalCostMicrodollars: number;
                      };
                      return (
                        <div className="rounded-md border border-border/50 bg-popover px-3 py-2 shadow-md">
                          <p className="text-[11px] text-muted-foreground">
                            {(() => {
                              const [y, mo, dy] = d.date.split("-").map(Number);
                              return new Date(Date.UTC(y, mo - 1, dy)).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                timeZone: "UTC",
                              });
                            })()}
                          </p>
                          <p className="font-mono text-sm font-medium text-foreground">
                            {formatMicrodollars(d.totalCostMicrodollars)}
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Area
                    dataKey="totalCostMicrodollars"
                    type="monotone"
                    fill="url(#fillSpendHome)"
                    stroke="var(--color-totalCostMicrodollars)"
                    strokeWidth={1.5}
                    animationDuration={600}
                  />
                </AreaChart>
              </ChartContainer>
            ) : (
              <div className="flex h-[200px] items-center justify-center text-[13px] text-muted-foreground md:h-[280px]">
                No spend data for this period.
              </div>
            )}
          </div>

          {/* Section 3: Three-Column Widgets */}
          <div className="border-t border-border/30 pt-4">
            <div className="grid grid-cols-1 divide-y divide-border/30 md:grid-cols-3 md:divide-x md:divide-y-0">
              {/* Budget Health */}
              <div className="pb-4 md:pb-0 md:pr-6">
                <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Budget Health
                </p>
                {budgetsLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-6 w-full" />
                    ))}
                  </div>
                ) : budgetsError ? (
                  <p className="text-[13px] text-muted-foreground">
                    Unable to load
                  </p>
                ) : budgets.length === 0 ? (
                  <div>
                    <p className="text-[13px] text-muted-foreground">
                      No budgets configured
                    </p>
                    <Link
                      href="/app/budgets"
                      className="mt-1 inline-block text-[13px] text-primary"
                    >
                      Create Budget
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {sortedBudgets.slice(0, 4).map((budget) => {
                      const rawPct =
                        budget.maxBudgetMicrodollars > 0
                          ? (budget.spendMicrodollars /
                              budget.maxBudgetMicrodollars) *
                            100
                          : 0;
                      const displayPct = Math.max(0, rawPct);
                      const barWidth = Math.min(displayPct, 100);
                      const color = getBudgetColor(displayPct);
                      return (
                        <div key={budget.id} className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="max-w-[140px] truncate text-[13px] text-foreground">
                              {budget.entityId}
                            </span>
                            <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
                              {displayPct.toFixed(0)}%
                            </span>
                          </div>
                          <div
                            className="h-1.5 w-full rounded-full bg-secondary/50"
                            role="progressbar"
                            aria-valuenow={Math.round(displayPct)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          >
                            <div
                              className={cn("h-full rounded-full", {
                                "bg-green-400": color === "green",
                                "bg-amber-400": color === "amber",
                                "bg-red-400": color === "red",
                              })}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                    {sortedBudgets.length > 4 && (
                      <Link
                        href="/app/budgets"
                        className="text-[13px] text-muted-foreground hover:text-foreground"
                      >
                        and {sortedBudgets.length - 4} more
                      </Link>
                    )}
                    <Link
                      href="/app/budgets"
                      className="inline-block text-[13px] text-primary"
                    >
                      View Budgets →
                    </Link>
                  </div>
                )}
              </div>

              {/* Top Models */}
              <div className="py-4 md:px-6 md:py-0">
                <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Top Models (7d)
                </p>
                {summaryLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-4 w-full" />
                    ))}
                  </div>
                ) : summaryError ? (
                  <p className="text-[13px] text-muted-foreground">
                    Unable to load
                  </p>
                ) : models.length === 0 ? (
                  <div>
                    <p className="text-[13px] text-muted-foreground">
                      No API calls yet
                    </p>
                    <Link
                      href="/app/analytics"
                      className="mt-1 inline-block text-[13px] text-primary"
                    >
                      View Analytics →
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {models.slice(0, 3).map((m) => (
                      <div
                        key={`${m.provider}:${m.model}`}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="max-w-[120px] truncate text-[13px] text-foreground">
                          {formatModelName(m.model)}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-[13px] tabular-nums text-foreground">
                            {formatMicrodollars(m.totalCostMicrodollars)}
                          </span>
                          <span className="w-10 text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                            {m.requestCount.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ))}
                    <Link
                      href="/app/analytics"
                      className="mt-1 inline-block text-[13px] text-primary"
                    >
                      View Analytics →
                    </Link>
                  </div>
                )}
              </div>

              {/* Recent Activity */}
              <div className="pt-4 md:pl-6 md:pt-0">
                <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Recent Activity
                </p>
                {eventsLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-4 w-full" />
                    ))}
                  </div>
                ) : eventsError ? (
                  <p className="text-[13px] text-muted-foreground">
                    Unable to load
                  </p>
                ) : events.length === 0 ? (
                  <div>
                    <p className="text-[13px] text-muted-foreground">
                      No activity yet
                    </p>
                    <Link
                      href="/app/keys"
                      className="mt-1 inline-block text-[13px] text-primary"
                    >
                      Create API Key
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {events.map((evt) => (
                      <div
                        key={evt.id}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="max-w-[100px] truncate text-[13px] text-foreground">
                          {formatModelName(evt.model)}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-[13px] tabular-nums text-foreground">
                            {formatMicrodollars(evt.costMicrodollars)}
                          </span>
                          <span className="w-14 text-right text-[11px] text-muted-foreground">
                            {formatRelativeTime(evt.createdAt)}
                          </span>
                        </div>
                      </div>
                    ))}
                    <Link
                      href="/app/activity"
                      className="mt-1 inline-block text-[13px] text-primary"
                    >
                      View Activity →
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Section 4: Margin Health Badge (when Stripe connected) */}
          {marginData &&
            marginData.summary.syncStatus !== "disconnected" && (
              <Link href="/app/margins">
                <div className="flex items-center justify-between rounded-lg border-t border-border/30 pt-4 transition-colors hover:bg-accent/40">
                  <div className="flex items-center gap-3">
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="font-mono text-lg font-semibold tabular-nums text-foreground">
                        {marginData.summary.blendedMarginPercent.toFixed(0)}%
                        margin
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {marginData.summary.criticalCount} critical,{" "}
                        {marginData.summary.atRiskCount} at risk
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    View margins →
                  </span>
                </div>
              </Link>
            )}

          {/* Section 5: Margins CTA (when Stripe not connected) */}
          {!isStripeConnected && (
            <div className="space-y-3 border-t border-border/30 pt-4">
              <p className="text-sm font-medium text-foreground">
                Connect Stripe to see margins
              </p>
              <div className="hidden md:block">
                <MarginPreviewTable />
              </div>
              <Link
                href="/app/margins"
                className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Connect Stripe →
              </Link>
            </div>
          )}
        </>
      )}

      {/* Section 6: Setup Instructions */}
      {!hasData ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-sm font-medium">
              Get Started
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-[13px] text-muted-foreground">
              Connect via proxy, SDK, or Claude Agent to start tracking costs:
            </p>
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as TabKey)}
            >
              <TabsList className="h-8 bg-secondary/50 p-0.5">
                {tabs.map((tab) => (
                  <TabsTrigger key={tab} value={tab}>
                    {tab}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="relative">
              <pre className="overflow-x-auto rounded-md border bg-muted/50 p-4 text-[13px] leading-relaxed">
                <code>{snippets[activeTab]}</code>
              </pre>
              <div className="absolute right-2 top-2">
                <CopyButton value={snippets[activeTab]} />
              </div>
            </div>
            <div className="flex gap-3">
              <Link
                href="/app/keys"
                className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Create API Key
              </Link>
              <a
                href="/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Read the docs
              </a>
            </div>
          </CardContent>
        </Card>
      ) : (
        <details className="group">
          <summary className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground">
            Setup instructions
          </summary>
          <div className="mt-3">
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as TabKey)}
            >
              <TabsList className="h-8 bg-secondary/50 p-0.5">
                {tabs.map((tab) => (
                  <TabsTrigger key={tab} value={tab}>
                    {tab}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="relative mt-3">
              <pre className="overflow-x-auto rounded-md border bg-muted/50 p-4 text-[13px] leading-relaxed">
                <code>{snippets[activeTab]}</code>
              </pre>
              <div className="absolute right-2 top-2">
                <CopyButton value={snippets[activeTab]} />
              </div>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
