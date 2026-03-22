"use client";

import Link from "next/link";

import { AnimatedHeroBg } from "@/components/marketing/animated-hero-bg";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function HeroSection() {
  return (
    <section className="relative min-h-screen overflow-hidden">
      {/* Animated canvas background */}
      <AnimatedHeroBg />

      {/* Content - positioned left for asymmetric layout */}
      <div className="relative z-10 flex min-h-screen items-center">
        <div className="mx-auto w-full max-w-7xl px-6 lg:px-8">
          <div className="max-w-2xl">
            {/* Eyebrow */}
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary backdrop-blur-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              Now tracking OpenAI, Anthropic & more
            </div>

            {/* Headline - Large and bold */}
            <h1 className="text-5xl font-bold leading-[1.1] tracking-tight text-balance sm:text-6xl md:text-7xl lg:text-8xl">
              <span className="text-foreground">Stop AI</span>
              <br />
              <span className="bg-gradient-to-r from-primary via-cyan-400 to-primary bg-clip-text text-transparent">
                cost chaos.
              </span>
            </h1>

            {/* Subheadline */}
            <p className="mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground text-pretty sm:text-xl">
              The FinOps layer for AI agents. Track spending, enforce budgets, and approve costs in real-time. 
              Two config changes. No SDK rewrite.
            </p>

            {/* CTA buttons */}
            <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
              <Link
                href="/signup"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "h-14 px-8 text-base font-semibold shadow-lg shadow-primary/25 transition-all hover:shadow-xl hover:shadow-primary/30"
                )}
              >
                Start Free
              </Link>
              <Link
                href="/docs"
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "h-14 border-border/50 px-8 text-base backdrop-blur-sm hover:bg-foreground/5"
                )}
              >
                Read the Docs
              </Link>
            </div>

            {/* Trust indicators */}
            <div className="mt-16 flex flex-col gap-4 border-t border-border/30 pt-8 sm:flex-row sm:items-center sm:gap-8">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-foreground">$2M+</span>
                <span className="text-sm text-muted-foreground">AI spend tracked</span>
              </div>
              <div className="hidden h-8 w-px bg-border/30 sm:block" />
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-foreground">50ms</span>
                <span className="text-sm text-muted-foreground">avg latency</span>
              </div>
              <div className="hidden h-8 w-px bg-border/30 sm:block" />
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-foreground">99.9%</span>
                <span className="text-sm text-muted-foreground">uptime</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 z-10 h-32 bg-gradient-to-t from-background to-transparent" />
    </section>
  );
}
