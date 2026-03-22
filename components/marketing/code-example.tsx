"use client";

import { useState } from "react";

import { CopyButton } from "@/components/ui/copy-button";

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

export function CodeExample() {
  const [activeTab, setActiveTab] = useState<TabKey>("OpenAI");

  return (
    <section className="py-20">
      <div className="mx-auto max-w-3xl px-6">
        <div className="text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Two config changes. No SDK rewrite.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Point your existing SDK at NullSpend and add one header.
          </p>
        </div>

        <div className="mt-10 overflow-hidden rounded-xl border border-border/50">
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
    </section>
  );
}
