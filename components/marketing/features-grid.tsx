import {
  Activity,
  Bell,
  DollarSign,
  Gauge,
  Inbox,
  Tag,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

const features: Feature[] = [
  {
    icon: DollarSign,
    title: "Cost Tracking",
    description:
      "Per-request cost for every model. Input, output, cached, and reasoning tokens — all calculated automatically.",
  },
  {
    icon: Gauge,
    title: "Budget Enforcement",
    description:
      "Hard spending ceilings. The proxy returns 429 before the request ever reaches the provider.",
  },
  {
    icon: Activity,
    title: "Velocity Limits",
    description:
      "Detect runaway loops. Auto-circuit-breaker when spend rate spikes past your threshold.",
  },
  {
    icon: Tag,
    title: "Tags & Attribution",
    description:
      "Attribute costs to teams, environments, or features with a single header. Default tags on API keys.",
  },
  {
    icon: Bell,
    title: "Webhooks",
    description:
      "15 event types with HMAC-SHA256 signing. Cost events, budget exceeded, velocity alerts, threshold crossings.",
  },
  {
    icon: Inbox,
    title: "Human-in-the-Loop",
    description:
      "Approval workflows for high-cost or sensitive operations. Agents wait, humans decide.",
  },
];

export function FeaturesGrid() {
  return (
    <section id="features" className="py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Everything you need to control AI spend
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Drop-in proxy for OpenAI and Anthropic. No SDK, no code changes.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-xl border border-border/50 bg-card/50 p-6 transition-all duration-300 hover:border-primary/20 hover:bg-card/80"
            >
              <feature.icon className="h-5 w-5 text-primary transition-transform duration-300 group-hover:scale-110" />
              <h3 className="mt-3 text-sm font-medium">{feature.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
