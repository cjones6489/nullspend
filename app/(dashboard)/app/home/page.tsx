"use client";

import { useState } from "react";
import Link from "next/link";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";
import {
  Activity,
  BarChart3,
  DollarSign,
  Key,
  Shield,
  TrendingUp,
} from "lucide-react";

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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiKeys } from "@/lib/queries/api-keys";
import { useBudgets } from "@/lib/queries/budgets";
import { useCostSummary } from "@/lib/queries/cost-event-summary";
import { formatMicrodollars, formatChartDollars } from "@/lib/utils/format";

const PROXY_URL = process.env.NEXT_PUBLIC_NULLSPEND_PROXY_URL ?? "https://proxy.nullspend.com/v1";

const snippets = {
  OpenAI: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${PROXY_URL}",
  defaultHeaders: {
    "X-NullSpend-Key": process.env.NULLSPEND_API_KEY,
  },
});`,
  Anthropic: `import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "${PROXY_URL}",
  defaultHeaders: {
    "X-NullSpend-Key": process.env.NULLSPEND_API_KEY,
  },
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
const tabs: TabKey[] = ["OpenAI", "Anthropic", "cURL"];

const chartConfig = {
  totalCostMicrodollars: {
    label: "Spend",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<TabKey>("OpenAI");
  const { data: keysData, isLoading: keysLoading } = useApiKeys();
  const { data: summaryData, isLoading: summaryLoading } = useCostSummary("7d");
  const { data: budgetsData } = useBudgets();

  const keys = keysData?.data ?? [];
  const totals = summaryData?.totals;
  const daily = summaryData?.daily;
  const budgets = budgetsData?.data ?? [];
  const hasData = keys.length > 0;

  const activeKeys = keys.length;
  const activeBudgets = budgets.length;
  const totalSpend = totals?.totalCostMicrodollars ?? 0;
  const totalRequests = totals?.totalRequests ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Home</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {hasData ? "Overview of your agent spending." : "Get started and monitor usage."}
        </p>
      </div>

      {/* Metric cards — only show when user has keys (data exists) */}
      {hasData && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            label="7d Spend"
            value={formatMicrodollars(totalSpend)}
            icon={DollarSign}
            href="/app/analytics"
          />
          <MetricCard
            label="Requests"
            value={totalRequests.toLocaleString()}
            icon={Activity}
            href="/app/activity"
          />
          <MetricCard
            label="Active Keys"
            value={String(activeKeys)}
            icon={Key}
            href="/app/keys"
          />
          <MetricCard
            label="Budgets"
            value={String(activeBudgets)}
            icon={Shield}
            href="/app/budgets"
          />
        </div>
      )}

      {/* Spend chart */}
      {daily && daily.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" />
              Spend (7 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[180px] w-full">
              <AreaChart data={daily}>
                <defs>
                  <linearGradient id="fillSpendHome" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-totalCostMicrodollars)" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="var(--color-totalCostMicrodollars)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d: string) => new Date(d).toLocaleDateString("en-US", { weekday: "short" })}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) => formatChartDollars(v)}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  width={50}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const d = payload[0].payload as { date: string; totalCostMicrodollars: number };
                    return (
                      <div className="rounded-md border border-border/50 bg-popover px-3 py-2 shadow-md">
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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
          </CardContent>
        </Card>
      )}

      {/* Get Started — shown prominently when no keys, collapsed when keys exist */}
      {!hasData ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-sm font-medium">Get Started</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-[13px] text-muted-foreground">
              Point your SDK at NullSpend to start tracking costs:
            </p>
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
              <TabsList className="h-8 bg-secondary/50 p-0.5">
                {tabs.map((tab) => (
                  <TabsTrigger key={tab} value={tab}>{tab}</TabsTrigger>
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
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors">
            Setup instructions
          </summary>
          <div className="mt-3">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
              <TabsList className="h-8 bg-secondary/50 p-0.5">
                {tabs.map((tab) => (
                  <TabsTrigger key={tab} value={tab}>{tab}</TabsTrigger>
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

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <QuickLink label="Analytics" description="Spend trends" icon={BarChart3} href="/app/analytics" />
        <QuickLink label="Keys" description="Manage & enforce" icon={Key} href="/app/keys" />
        <QuickLink label="Budgets" description="Spending limits" icon={DollarSign} href="/app/budgets" />
        <QuickLink label="Activity" description="Live API log" icon={Activity} href="/app/activity" />
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  href,
}: {
  label: string;
  value: string | undefined;
  icon: typeof DollarSign;
  href: string;
}) {
  return (
    <Link href={href}>
      <Card className="border-border/50 transition-colors hover:bg-accent/40">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="rounded-md bg-muted p-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            {value !== undefined ? (
              <p className="font-mono text-lg font-semibold tabular-nums text-foreground">{value}</p>
            ) : (
              <Skeleton className="h-6 w-16" />
            )}
            <p className="text-[11px] text-muted-foreground">{label}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function QuickLink({
  label,
  description,
  icon: Icon,
  href,
}: {
  label: string;
  description: string;
  icon: typeof DollarSign;
  href: string;
}) {
  return (
    <Link href={href}>
      <div className="rounded-lg border border-border/50 bg-card p-3 transition-colors hover:bg-accent/40">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-[13px] font-medium">{label}</span>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
      </div>
    </Link>
  );
}
