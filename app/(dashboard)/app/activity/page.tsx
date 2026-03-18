"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useApiKeys } from "@/lib/queries/api-keys";
import { RecentActivity } from "@/components/usage/recent-activity";

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
      <Suspense fallback={null}>
        <ActivityContent />
      </Suspense>
    </div>
  );
}
