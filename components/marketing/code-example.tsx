"use client";

import { useState } from "react";

import { CopyButton } from "@/components/ui/copy-button";

const PROXY_URL = "https://proxy.nullspend.com/v1";

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
  baseUrl: "https://app.nullspend.com",
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

export function CodeExample() {
  const [activeTab, setActiveTab] = useState<TabKey>("Proxy");

  return (
    <section className="py-20">
      <div className="mx-auto max-w-3xl px-6">
        <div className="text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Three ways to connect. Zero SDK rewrites.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Use the proxy, SDK, or Claude Agent adapter — all feed the same dashboard.
          </p>
        </div>

        <div className="relative mt-10">
          {/* Glow behind code block */}
          <div
            className="pointer-events-none absolute -inset-4 -z-10 rounded-2xl"
            style={{
              background:
                "radial-gradient(ellipse 80% 60% at 50% 50%, oklch(0.72 0.19 160 / 0.06), transparent)",
            }}
          />
        <div className="overflow-hidden rounded-xl border border-border/50">
          {/* Tabs */}
          <div className="flex gap-1 border-b border-border/50 bg-muted/30 p-1.5">
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  activeTab === tab
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Code */}
          <div className="relative bg-[oklch(0.10_0.004_265)]">
            <pre className="overflow-x-auto p-5 text-[13px] leading-relaxed">
              <code>{snippets[activeTab]}</code>
            </pre>
            <div className="absolute right-3 top-3">
              <CopyButton value={snippets[activeTab]} />
            </div>
          </div>
        </div>
        </div>
      </div>
    </section>
  );
}
