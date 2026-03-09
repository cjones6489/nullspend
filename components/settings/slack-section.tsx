"use client";

import { MessageSquare, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
import { Switch } from "@/components/ui/switch";
import {
  useDeleteSlackConfig,
  useSaveSlackConfig,
  useSlackConfig,
  useTestSlackNotification,
} from "@/lib/queries/slack";
import { Skeleton } from "@/components/ui/skeleton";

export function SlackSection() {
  const { data, isLoading, error } = useSlackConfig();
  const config = data?.data ?? null;

  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="pb-4">
        <div>
          <CardTitle className="text-sm font-medium text-foreground">
            Slack Integration
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Get notified in Slack when new actions are pending approval.
            Approve or reject directly from Slack.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <SlackSkeleton />}

        {error && (
          <div className="text-sm text-red-400">
            Failed to load Slack configuration.
          </div>
        )}

        {!isLoading && !error && !config && <ConnectForm />}

        {!isLoading && !error && config && <ConnectedState config={config} />}
      </CardContent>
    </Card>
  );
}

function ConnectForm() {
  const saveConfig = useSaveSlackConfig();
  const [webhookUrl, setWebhookUrl] = useState("");
  const [channelName, setChannelName] = useState("");

  function handleConnect() {
    saveConfig.mutate(
      { webhookUrl, channelName: channelName || undefined },
      {
        onSuccess: () => {
          toast.success("Slack connected");
          setWebhookUrl("");
          setChannelName("");
        },
        onError: (err) => {
          toast.error(err.message || "Failed to connect Slack");
        },
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="webhook-url" className="text-xs text-muted-foreground">
          Webhook URL
        </Label>
        <Input
          id="webhook-url"
          placeholder="https://hooks.slack.com/services/..."
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          className="h-9 border-border/50 bg-background text-[13px] font-mono placeholder:text-muted-foreground/50"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="channel-name" className="text-xs text-muted-foreground">
          Channel name (optional)
        </Label>
        <Input
          id="channel-name"
          placeholder='e.g. "#agent-alerts"'
          value={channelName}
          onChange={(e) => setChannelName(e.target.value)}
          className="h-9 border-border/50 bg-background text-[13px] placeholder:text-muted-foreground/50"
          maxLength={80}
        />
      </div>
      <Button
        size="sm"
        onClick={handleConnect}
        disabled={!webhookUrl.trim() || saveConfig.isPending}
      >
        {saveConfig.isPending ? "Connecting..." : "Connect Slack"}
      </Button>
    </div>
  );
}

function ConnectedState({
  config,
}: {
  config: {
    id: string;
    webhookUrl: string;
    channelName: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  };
}) {
  const saveConfig = useSaveSlackConfig();
  const deleteConfig = useDeleteSlackConfig();
  const testNotification = useTestSlackNotification();
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  function handleToggle(checked: boolean) {
    saveConfig.mutate(
      {
        webhookUrl: config.webhookUrl,
        channelName: config.channelName ?? undefined,
        isActive: checked,
      },
      {
        onSuccess: () => {
          toast.success(checked ? "Slack notifications enabled" : "Slack notifications paused");
        },
        onError: (err) => {
          toast.error(err.message || "Failed to update Slack config");
        },
      },
    );
  }

  function handleDisconnect() {
    deleteConfig.mutate(undefined, {
      onSuccess: () => {
        setDisconnectOpen(false);
        toast.success("Slack disconnected");
      },
      onError: (err) => {
        toast.error(err.message || "Failed to disconnect Slack");
      },
    });
  }

  function handleTest() {
    testNotification.mutate(undefined, {
      onSuccess: () => {
        toast.success("Test notification sent to Slack");
      },
      onError: (err) => {
        toast.error(err.message || "Failed to send test notification");
      },
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary/50">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-[13px] font-medium text-foreground">
              {config.channelName || "Slack connected"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {config.isActive ? "Notifications active" : "Notifications paused"}
            </p>
          </div>
        </div>
        <Switch
          checked={config.isActive}
          onCheckedChange={handleToggle}
          aria-label="Toggle Slack notifications"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={testNotification.isPending}
          className="text-xs"
        >
          {testNotification.isPending ? "Sending..." : "Send Test"}
        </Button>

        <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
          <DialogTrigger
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border/50 bg-secondary px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            <Trash2 className="mr-1.5 h-3 w-3" />
            Disconnect
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>Disconnect Slack?</DialogTitle>
            <DialogDescription>
              This will remove your Slack webhook configuration.
              You will no longer receive notifications in Slack for new actions.
            </DialogDescription>
            <DialogFooter>
              <DialogClose
                className="inline-flex h-8 items-center justify-center rounded-md border border-border/50 bg-secondary px-3 text-xs font-medium text-foreground hover:bg-accent"
                disabled={deleteConfig.isPending}
              >
                Cancel
              </DialogClose>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDisconnect}
                disabled={deleteConfig.isPending}
              >
                {deleteConfig.isPending ? "Disconnecting..." : "Disconnect"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function SlackSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-10 w-full rounded-lg bg-secondary/50" />
      <Skeleton className="h-8 w-32 rounded-lg bg-secondary/50" />
    </div>
  );
}
