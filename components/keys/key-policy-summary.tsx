"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface KeyPolicySummaryProps {
  allowedProviders: string[] | null;
  allowedModels: string[] | null;
}

const MAX_VISIBLE_MODELS = 3;

export function KeyPolicySummary({ allowedProviders, allowedModels }: KeyPolicySummaryProps) {
  const hasRestrictions =
    allowedProviders !== null || allowedModels !== null;

  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Policy
        </CardTitle>
      </CardHeader>
      <CardContent>
        {hasRestrictions ? (
          <div className="space-y-3">
            {allowedProviders !== null && (
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                  Providers
                </p>
                {allowedProviders.length === 0 ? (
                  <span className="text-[13px] text-red-400">None (all blocked)</span>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {allowedProviders.map((p) => (
                      <Badge key={p} variant="outline" className="text-[11px] capitalize">
                        {p}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}

            {allowedModels !== null && (
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                  Models
                </p>
                {allowedModels.length === 0 ? (
                  <span className="text-[13px] text-red-400">None (all blocked)</span>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {allowedModels.slice(0, MAX_VISIBLE_MODELS).map((m) => (
                      <Badge key={m} variant="secondary" className="font-mono text-[11px]">
                        {m}
                      </Badge>
                    ))}
                    {allowedModels.length > MAX_VISIBLE_MODELS && (
                      <Badge variant="secondary" className="text-[11px]">
                        +{allowedModels.length - MAX_VISIBLE_MODELS} more
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            )}

            <Link
              href="/docs"
              className="inline-block text-[11px] text-primary hover:underline"
            >
              Edit via API →
            </Link>
          </div>
        ) : (
          <div>
            <p className="text-[13px] text-muted-foreground">No restrictions</p>
            <Link
              href="/docs"
              className="mt-1 inline-block text-[11px] text-primary hover:underline"
            >
              Set via API →
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
