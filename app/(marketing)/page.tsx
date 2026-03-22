import type { Metadata } from "next";

import { CodeExample } from "@/components/marketing/code-example";
import { FeatureSections } from "@/components/marketing/feature-sections";
import { FinalCta } from "@/components/marketing/final-cta";
import { HeroSection } from "@/components/marketing/hero-section";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { PricingTable } from "@/components/marketing/pricing-table";

export const metadata: Metadata = {
  title: "NullSpend — FinOps Layer for AI Agents",
  description:
    "Cost tracking, budget enforcement, and human-in-the-loop approval for OpenAI and Anthropic. Two config changes, no SDK rewrite.",
};

export default function LandingPage() {
  return (
    <>
      <HeroSection />
      <FeatureSections />
      <HowItWorks />
      <CodeExample />
      <PricingTable />
      <FinalCta />
    </>
  );
}
