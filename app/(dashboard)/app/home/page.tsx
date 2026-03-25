"use client";

import { useState } from "react";
import Link from "next/link";
import { Area, AreaChart } from "recharts";
import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  DollarSign,
  ExternalLink,
  Inbox,
  Key,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiKeys } from "@/lib/queries/api-keys";
import { useCostSummary } from "@/lib/queries/cost-event-summary";
import { formatMicrodollars } from "@/lib/utils/format";
import type { LucideIcon } from "lucide-react";

const PROXY_URL = "https://proxy.nullspend.com/v1";

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

const sparklineConfig = {
  totalCostMicrodollars: {
    label: "Spend",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

interface FeatureCard {
  label: string;
  description: string;
  icon: LucideIcon;
  href: string;
  external?: boolean;
}

const featureCards: FeatureCard[] = [
  { label: "Analytics", description: "Spend trends & model breakdown", icon: BarChart3, href: "/app/analytics" },
  { label: "Activity", description: "Live API call log", icon: Activity, href: "/app/activity" },
  { label: "Budgets", description: "Set spending limits", icon: DollarSign, href: "/app/budgets" },
  { label: "Webhooks", description: "Event notifications", icon: Bell, href: "/app/settings" },
  { label: "Documentation", description: "API reference & guides", icon: BookOpen, href: "/docs", external: true },
  { label: "Approvals", description: "Human-in-the-loop", icon: Inbox, href: "/app/inbox" },
];

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<TabKey>("OpenAI");
  const { data: keysData } = useApiKeys();
  const { data: summaryData } = useCostSummary("7d");

  const firstKey = keysData?.data?.[0];
  const totals = summaryData?.totals;
  const daily = summaryData?.daily;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Home</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Get started and monitor usage.</p>
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left — Get Started */}
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-sm font-medium">Get Started</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-[13px] text-muted-foreground">
              Point your SDK at NullSpend to start tracking costs:
            </p>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
              <TabsList className="h-8 bg-secondary/50 p-0.5">
                {tabs.map((tab) => (
                  <TabsTrigger key={tab} value={tab}>
                    {tab}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {/* Code snippet */}
            <div className="relative">
              <pre className="overflow-x-auto rounded-md border bg-muted/50 p-4 text-[13px] leading-relaxed">
                <code>{snippets[activeTab]}</code>
              </pre>
              <div className="absolute right-2 top-2">
                <CopyButton value={snippets[activeTab]} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right column — API Key + Usage */}
        <div className="flex flex-col gap-6">
          {/* API Key card */}
          <Card>
            <CardHeader>
              <CardTitle className="font-mono text-sm font-medium">
                <div className="flex items-center gap-2">
                  <Key className="h-3.5 w-3.5" />
                  API Key
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {firstKey ? (
                <div className="flex items-center gap-2">
                  <code className="rounded bg-muted px-2 py-1 text-xs">
                    {firstKey.keyPrefix}••••••••
                  </code>
                  <Link
                    href="/app/settings/api-keys"
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Manage →
                  </Link>
                </div>
              ) : (
                <Link
                  href="/app/settings/api-keys"
                  className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Create API Key
                </Link>
              )}
              <Link
                href="/app/settings/api-keys"
                className="block text-xs text-muted-foreground hover:text-foreground"
              >
                View all &rarr;
              </Link>
            </CardContent>
          </Card>

          {/* Usage card */}
          <Card>
            <CardHeader>
              <CardTitle className="font-mono text-sm font-medium">
                Usage &middot; 7 days
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {daily && daily.length > 0 && (
                <ChartContainer config={sparklineConfig} className="h-[60px] w-full">
                  <AreaChart data={daily}>
                    <defs>
                      <linearGradient id="fillSpendHome" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-totalCostMicrodollars)" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="var(--color-totalCostMicrodollars)" stopOpacity={0.1} />
                      </linearGradient>
                    </defs>
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
              )}
              {totals && (
                <div className="flex items-center gap-3 font-mono text-sm">
                  <span className="font-medium">
                    {formatMicrodollars(totals.totalCostMicrodollars)}
                  </span>
                  <span className="text-muted-foreground">
                    &middot; {totals.totalRequests.toLocaleString()} reqs
                  </span>
                </div>
              )}
              <Link
                href="/app/analytics"
                className="block text-xs text-muted-foreground hover:text-foreground"
              >
                View all &rarr;
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Feature cards grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {featureCards.map((card) => {
          const content = (
            <div className="rounded-lg border border-border/50 bg-card p-4 transition-colors hover:bg-accent/40">
              <div className="flex items-center gap-2">
                <card.icon className="h-4 w-4 text-muted-foreground" />
                <span className="font-mono text-sm font-medium">{card.label}</span>
                {card.external && (
                  <ExternalLink className="h-3 w-3 text-muted-foreground/50" />
                )}
              </div>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {card.description}
              </p>
            </div>
          );

          if (card.external) {
            return (
              <a
                key={card.label}
                href={card.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {content}
              </a>
            );
          }

          return (
            <Link key={card.label} href={card.href}>
              {content}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
