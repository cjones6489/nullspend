"use client";

import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-32 pb-20">
      {/* Subtle glow */}
      <div
        className="pointer-events-none absolute inset-x-0 -top-20 h-[500px]"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% -10%, oklch(0.62 0.22 250 / 0.12), transparent)",
        }}
      />

      <div className="relative mx-auto max-w-4xl px-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
          FinOps layer for AI agents
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
          Cost tracking, budget enforcement, and human&#8209;in&#8209;the&#8209;loop approval
          — with two config changes.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link
            href="/signup"
            className={cn(buttonVariants({ size: "lg" }))}
          >
            Get Started
          </Link>
          <Link
            href="/docs"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
          >
            View Docs
          </Link>
        </div>
      </div>
    </section>
  );
}
