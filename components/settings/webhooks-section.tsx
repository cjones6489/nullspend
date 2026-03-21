"use client";

import { Copy, Plus, RotateCw, Send, Trash2, Webhook } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useCreateWebhook,
  useDeleteWebhook,
  useRotateWebhookSecret,
  useTestWebhook,
  useUpdateWebhook,
  useWebhooks,
} from "@/lib/queries/webhooks";
import {
  MAX_WEBHOOK_ENDPOINTS_PER_USER,
  WEBHOOK_EVENT_TYPES,
  type WebhookRecord,
} from "@/lib/validations/webhooks";

export function WebhooksSection() {
  const { data, isLoading, error } = useWebhooks();
  const [createOpen, setCreateOpen] = useState(false);
  const endpoints = data?.data ?? [];

  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <div>
          <CardTitle className="text-sm font-medium text-foreground">
            Webhooks
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Send signed HTTP callbacks when cost events and budget alerts occur.
          </p>
        </div>
        {endpoints.length < MAX_WEBHOOK_ENDPOINTS_PER_USER && (
          <CreateEndpointDialog open={createOpen} onOpenChange={setCreateOpen} />
        )}
      </CardHeader>
      <CardContent className="p-0">
        {isLoading && <WebhooksSkeleton />}

        {error && (
          <div className="p-6 text-sm text-red-400">
            Failed to load webhook endpoints.
          </div>
        )}

        {data && endpoints.length === 0 && <EmptyWebhooks />}

        {data && endpoints.length > 0 && (
          <div className="border-t border-border/30">
            <Table>
              <TableHeader>
                <TableRow className="border-border/30 hover:bg-transparent">
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    URL
                  </TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Events
                  </TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Status
                  </TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoints.map((ep) => (
                  <EndpointRow key={ep.id} endpoint={ep} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Endpoint table row
// ---------------------------------------------------------------------------

function truncateUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    return (
      parsed.host +
      (pathParts[0] ? `/${pathParts[0]}` : "") +
      (pathParts.length > 1 ? "/..." : "")
    );
  } catch {
    return url;
  }
}

function EndpointRow({ endpoint }: { endpoint: WebhookRecord }) {
  const updateWebhook = useUpdateWebhook();
  const testWebhook = useTestWebhook();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotateSecretShown, setRotateSecretShown] = useState(false);

  function handleToggle(checked: boolean) {
    updateWebhook.mutate(
      { id: endpoint.id, enabled: checked },
      {
        onError: (err) => {
          toast.error(err.message || "Failed to update endpoint");
        },
      },
    );
  }

  function handleTest() {
    testWebhook.mutate(endpoint.id, {
      onSuccess: (result) => {
        if (result.success) {
          toast.success(`Test webhook sent (${result.statusCode})`);
        } else {
          toast.error(
            `Test failed${result.statusCode ? ` (${result.statusCode})` : ""}: ${result.responsePreview || "No response"}`,
          );
        }
      },
      onError: (err) => {
        toast.error(err.message || "Failed to send test webhook");
      },
    });
  }

  return (
    <TableRow className="border-border/30 transition-colors hover:bg-accent/40">
      <TableCell>
        <div>
          <p
            className="text-[13px] font-medium text-foreground"
            title={endpoint.url}
          >
            {truncateUrl(endpoint.url)}
          </p>
          {endpoint.description && (
            <p className="text-[11px] text-muted-foreground">
              {endpoint.description}
            </p>
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {endpoint.eventTypes.length === 0 ? (
            <Badge variant="outline" className="text-[10px]">
              All events
            </Badge>
          ) : (
            endpoint.eventTypes.map((type) => (
              <Badge
                key={type}
                variant="secondary"
                className="text-[10px]"
              >
                {type}
              </Badge>
            ))
          )}
        </div>
      </TableCell>
      <TableCell>
        <Switch
          checked={endpoint.enabled}
          onCheckedChange={handleToggle}
          aria-label="Toggle endpoint"
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={handleTest}
            disabled={testWebhook.isPending}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            aria-label="Send test webhook"
            title="Send test"
          >
            <Send className="h-3.5 w-3.5" />
          </button>

          <Dialog
            open={rotateOpen}
            onOpenChange={(next) => {
              if (rotateSecretShown && !next) return;
              setRotateOpen(next);
            }}
          >
            <DialogTrigger
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Rotate signing secret"
              title="Rotate secret"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </DialogTrigger>
            <RotateSecretDialogContent
              endpointId={endpoint.id}
              onSecretShown={setRotateSecretShown}
              onClose={() => {
                setRotateSecretShown(false);
                setRotateOpen(false);
              }}
            />
          </Dialog>

          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogTrigger
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
              aria-label="Delete endpoint"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </DialogTrigger>
            <DeleteEndpointDialogContent
              endpointId={endpoint.id}
              endpointUrl={endpoint.url}
              onClose={() => setDeleteOpen(false)}
            />
          </Dialog>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Create endpoint dialog
// ---------------------------------------------------------------------------

function CreateEndpointDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createWebhook = useCreateWebhook();
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [selectedEventTypes, setSelectedEventTypes] = useState<string[]>([]);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  function handleCreate() {
    createWebhook.mutate(
      {
        url,
        description: description || undefined,
        eventTypes: selectedEventTypes as typeof WEBHOOK_EVENT_TYPES[number][],
        payloadMode: "full" as const,
      },
      {
        onSuccess: (data) => {
          setCreatedSecret(data.data.signingSecret);
          setUrl("");
          setDescription("");
          setSelectedEventTypes([]);
          toast.success("Webhook endpoint created");
        },
        onError: (err) => {
          toast.error(err.message || "Failed to create endpoint");
        },
      },
    );
  }

  function handleClose(nextOpen: boolean) {
    if (createdSecret && !nextOpen) return;
    if (!nextOpen) {
      setCreatedSecret(null);
      setUrl("");
      setDescription("");
      setSelectedEventTypes([]);
    }
    onOpenChange(nextOpen);
  }

  function handleDone() {
    setCreatedSecret(null);
    onOpenChange(false);
  }

  function toggleEventType(type: string) {
    setSelectedEventTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90">
        <Plus className="h-3.5 w-3.5" />
        Add Endpoint
      </DialogTrigger>
      <DialogContent showCloseButton={!createdSecret}>
        {createdSecret ? (
          <>
            <DialogTitle>Your signing secret</DialogTitle>
            <DialogDescription>
              Copy this secret now. You won&apos;t be able to see it again.
            </DialogDescription>
            <SecretDisplay secret={createdSecret} />
            <DialogFooter>
              <button
                type="button"
                onClick={handleDone}
                className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Done
              </button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogTitle>Add webhook endpoint</DialogTitle>
            <DialogDescription>
              We&apos;ll send signed POST requests to this URL when events occur.
            </DialogDescription>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="wh-url" className="text-xs text-muted-foreground">
                  URL
                </Label>
                <Input
                  id="wh-url"
                  placeholder="https://example.com/webhook"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="h-9 border-border/50 bg-background text-[13px] font-mono placeholder:text-muted-foreground/50"
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="wh-desc"
                  className="text-xs text-muted-foreground"
                >
                  Description (optional)
                </Label>
                <Input
                  id="wh-desc"
                  placeholder="Slack cost alerts"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="h-9 border-border/50 bg-background text-[13px] placeholder:text-muted-foreground/50"
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Event types (leave empty for all)
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {WEBHOOK_EVENT_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => toggleEventType(type)}
                      className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                        selectedEventTypes.includes(type)
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <DialogClose className="inline-flex h-8 items-center justify-center rounded-md border border-border/50 bg-secondary px-3 text-xs font-medium text-foreground hover:bg-accent">
                Cancel
              </DialogClose>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={!url.trim() || createWebhook.isPending}
              >
                {createWebhook.isPending ? "Creating..." : "Create Endpoint"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation dialog content
// ---------------------------------------------------------------------------

function DeleteEndpointDialogContent({
  endpointId,
  endpointUrl,
  onClose,
}: {
  endpointId: string;
  endpointUrl: string;
  onClose: () => void;
}) {
  const deleteWebhook = useDeleteWebhook();

  function handleDelete() {
    deleteWebhook.mutate(endpointId, {
      onSuccess: () => {
        onClose();
        toast.success("Webhook endpoint deleted");
      },
      onError: (err) => {
        toast.error(err.message || "Failed to delete endpoint");
      },
    });
  }

  return (
    <DialogContent>
      <DialogTitle>Delete webhook endpoint?</DialogTitle>
      <DialogDescription>
        This will permanently delete the endpoint for{" "}
        <span className="font-mono text-foreground">{truncateUrl(endpointUrl)}</span>{" "}
        and its delivery history. This cannot be undone.
      </DialogDescription>
      <DialogFooter>
        <DialogClose
          className="inline-flex h-8 items-center justify-center rounded-md border border-border/50 bg-secondary px-3 text-xs font-medium text-foreground hover:bg-accent"
          disabled={deleteWebhook.isPending}
        >
          Cancel
        </DialogClose>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleDelete}
          disabled={deleteWebhook.isPending}
        >
          {deleteWebhook.isPending ? "Deleting..." : "Delete Endpoint"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ---------------------------------------------------------------------------
// Rotate secret dialog content
// ---------------------------------------------------------------------------

function RotateSecretDialogContent({
  endpointId,
  onSecretShown,
  onClose,
}: {
  endpointId: string;
  onSecretShown: (shown: boolean) => void;
  onClose: () => void;
}) {
  const rotateSecret = useRotateWebhookSecret();
  const [newSecret, setNewSecret] = useState<string | null>(null);

  function handleRotate() {
    rotateSecret.mutate(endpointId, {
      onSuccess: (data) => {
        setNewSecret(data.data.signingSecret);
        onSecretShown(true);
        toast.success("Signing secret rotated");
      },
      onError: (err) => {
        toast.error(err.message || "Failed to rotate secret");
      },
    });
  }

  function handleDone() {
    setNewSecret(null);
    onClose();
  }

  if (newSecret) {
    return (
      <DialogContent showCloseButton={false}>
        <DialogTitle>New signing secret</DialogTitle>
        <DialogDescription>
          Copy this secret now. You won&apos;t be able to see it again.
        </DialogDescription>
        <SecretDisplay secret={newSecret} />
        <DialogFooter>
          <button
            type="button"
            onClick={handleDone}
            className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Done
          </button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent>
      <DialogTitle>Rotate signing secret?</DialogTitle>
      <DialogDescription>
        The current secret will be replaced immediately. Your endpoint will need
        to be updated with the new secret to verify signatures.
      </DialogDescription>
      <DialogFooter>
        <DialogClose
          className="inline-flex h-8 items-center justify-center rounded-md border border-border/50 bg-secondary px-3 text-xs font-medium text-foreground hover:bg-accent"
          disabled={rotateSecret.isPending}
        >
          Cancel
        </DialogClose>
        <Button
          size="sm"
          onClick={handleRotate}
          disabled={rotateSecret.isPending}
        >
          {rotateSecret.isPending ? "Rotating..." : "Rotate Secret"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ---------------------------------------------------------------------------
// Shared secret display with copy button
// ---------------------------------------------------------------------------

function SecretDisplay({ secret }: { secret: string }) {
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(secret);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy secret. Please copy it manually.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-background p-3">
        <code className="flex-1 break-all font-mono text-xs text-foreground">
          {secret}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Copy secret to clipboard"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="text-[11px] text-amber-400/80">
        Store this secret securely. It will not be shown again.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state & skeleton
// ---------------------------------------------------------------------------

function EmptyWebhooks() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 border-t border-border/30 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/50">
        <Webhook className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">
          No webhook endpoints
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Add an endpoint to receive signed HTTP callbacks for cost events and
          budget alerts.
        </p>
      </div>
    </div>
  );
}

function WebhooksSkeleton() {
  return (
    <div className="space-y-2 border-t border-border/30 p-4">
      {Array.from({ length: 2 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-lg bg-secondary/50" />
      ))}
    </div>
  );
}
