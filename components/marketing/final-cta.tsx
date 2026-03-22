"use client";

import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function FinalCta() {
  return (
    <section className="relative overflow-hidden py-24">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 50% 60% at 50% 110%, oklch(0.62 0.22 250 / 0.08), transparent)",
        }}
      />

      <div className="relative mx-auto max-w-2xl px-6 text-center">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Stop paying for runaway agents
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
          Get cost visibility and budget enforcement in under two minutes.
          Free to start, no credit card required.
        </p>
        <div className="mt-8">
          <Link
            href="/signup"
            className={cn(buttonVariants({ size: "lg" }))}
          >
            Get Started Free
          </Link>
        </div>
      </div>
    </section>
  );
}
