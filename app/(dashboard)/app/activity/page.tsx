"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useApiKeys } from "@/lib/queries/api-keys";
import { RecentActivity } from "@/components/usage/recent-activity";
import { Skeleton } from "@/components/ui/skeleton";

function ActivityContent() {
  const { data: keysData } = useApiKeys();
  const searchParams = useSearchParams();
  const provider = searchParams.get("provider") ?? undefined;

  return (
    <RecentActivity
      keys={(keysData?.data ?? []).map((k) => ({ id: k.id, name: k.name }))}
      initialProvider={provider}
    />
  );
}

function ActivitySkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg bg-secondary/50" />
      ))}
    </div>
  );
}

export default function ActivityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Activity
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Every API call that flows through the proxy.
        </p>
      </div>
      <Suspense fallback={<ActivitySkeleton />}>
        <ActivityContent />
      </Suspense>
    </div>
  );
}
