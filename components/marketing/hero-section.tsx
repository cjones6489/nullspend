"use client";

import Link from "next/link";

import { AnimatedHeroBg } from "@/components/marketing/animated-hero-bg";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-32 pb-24 md:pt-40 md:pb-32">
      {/* Animated canvas background */}
      <AnimatedHeroBg />

      {/* Radial glow overlay */}
      <div
        className="pointer-events-none absolute inset-x-0 -top-20 h-[600px]"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% -10%, oklch(0.72 0.19 160 / 0.15), transparent)",
        }}
      />

      {/* Content */}
      <div className="relative mx-auto max-w-4xl px-6 text-center">
        {/* Badge */}
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-medium text-primary">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          Now tracking OpenAI &amp; Anthropic
        </div>

        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
          FinOps layer for
          <br />
          <span className="text-primary">AI agents</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg md:text-xl">
          Cost tracking, budget enforcement, and human&#8209;in&#8209;the&#8209;loop approval.
          Two config changes. No SDK rewrite.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link
            href="/signup"
            className={cn(buttonVariants({ size: "lg" }), "px-6")}
          >
            Get Started Free
          </Link>
          <Link
            href="/docs"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "px-6")}
          >
            View Docs
          </Link>
        </div>

        {/* Subtle stat line */}
        <p className="mt-12 text-xs text-muted-foreground/60">
          Tracks every model from GPT-4.1 to Claude Opus &middot; Sub-millisecond overhead &middot; Free tier available
        </p>
      </div>
    </section>
  );
}
