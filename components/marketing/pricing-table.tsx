"use client";

import { Check } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Tier {
  name: string;
  price: string;
  description: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
}

const tiers: Tier[] = [
  {
    name: "Free",
    price: "$0",
    description: "Get started with cost visibility.",
    features: [
      "Up to $1K/mo proxied spend",
      "1 budget",
      "7 day data retention",
      "Cost tracking",
      "Community support",
    ],
    cta: "Get Started",
  },
  {
    name: "Pro",
    price: "$49",
    description: "For teams shipping AI in production.",
    features: [
      "Up to $50K/mo proxied spend",
      "Unlimited budgets",
      "30 day data retention",
      "Webhooks & API access",
      "Velocity limits",
      "Priority support",
    ],
    cta: "Get Started",
    highlighted: true,
  },
  {
    name: "Team",
    price: "$199",
    description: "Advanced controls for larger teams.",
    features: [
      "Up to $250K/mo proxied spend",
      "Unlimited budgets",
      "90 day data retention",
      "Multi-user access",
      "Team budgets",
      "Advanced analytics",
    ],
    cta: "Get Started",
  },
];

export function PricingTable() {
  return (
    <section id="pricing" className="py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Simple, transparent pricing
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Pay for what you use. Upgrade as your AI spend grows.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`relative flex flex-col rounded-xl border p-8 ${
                tier.highlighted
                  ? "border-primary/50 ring-1 ring-primary/20"
                  : "border-border/50"
              } bg-card`}
            >
              {tier.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-medium text-primary-foreground">
                  Popular
                </div>
              )}

              <h3 className="text-lg font-medium">{tier.name}</h3>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-3xl font-bold">{tier.price}</span>
                <span className="text-sm text-muted-foreground">/mo</span>
              </div>
              <p className="mt-2 text-[13px] text-muted-foreground">
                {tier.description}
              </p>

              <ul className="mt-6 flex flex-1 flex-col gap-2.5">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-[13px]">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                href="/signup"
                className={cn(
                  buttonVariants({
                    variant: tier.highlighted ? "default" : "outline",
                    size: "lg",
                  }),
                  "mt-8 w-full justify-center",
                )}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
