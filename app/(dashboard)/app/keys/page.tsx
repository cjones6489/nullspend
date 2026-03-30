"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { KeyList } from "@/components/keys/key-list";
import { KeyDetail } from "@/components/keys/key-detail";
import { CreateKeyDialog } from "@/components/keys/create-key-dialog";
import { useApiKeys } from "@/lib/queries/api-keys";
import { useSession } from "@/lib/queries/session";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function KeysPage() {
  const { data, isLoading, error } = useApiKeys();
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(
    searchParams.get("selected"),
  );
  const [createOpen, setCreateOpen] = useState(false);

  const canCreate = session?.role === "owner" || session?.role === "admin" || session?.role === "member";
  const canManage = session?.role === "owner" || session?.role === "admin";

  const keys = useMemo(() => data?.data ?? [], [data]);
  const selectedKey = keys.find((k) => k.id === selectedKeyId) ?? null;

  // Auto-select first key when data loads (unless deep-linked via ?selected=)
  useEffect(() => {
    if (keys.length > 0 && !selectedKeyId) {
      setSelectedKeyId(keys[0].id);
    }
  }, [keys, selectedKeyId]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Keys</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Manage API keys and enforcement policies.
          </p>
        </div>
        {canCreate && (
          <CreateKeyDialog open={createOpen} onOpenChange={setCreateOpen} />
        )}
      </div>

      {isLoading && (
        <div className="flex flex-1 gap-4">
          <div className="w-72 shrink-0 space-y-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-md" />
            ))}
          </div>
          <div className="flex-1">
            <Skeleton className="h-96 w-full rounded-md" />
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
          Failed to load API keys.
        </div>
      )}

      {data && keys.length === 0 && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">No API keys yet.</p>
            {canCreate && (
              <Button
                size="sm"
                className="mt-3 gap-1.5"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                Create your first key
              </Button>
            )}
          </div>
        </div>
      )}

      {data && keys.length > 0 && (
        <div className="flex flex-1 gap-4 overflow-hidden">
          <KeyList
            keys={keys}
            selectedKeyId={selectedKeyId}
            onSelect={setSelectedKeyId}
          />
          {selectedKey ? (
            <KeyDetail apiKey={selectedKey} canManage={canManage} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Select a key to view details
            </div>
          )}
        </div>
      )}
    </div>
  );
}
