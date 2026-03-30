"use client";

import { useState } from "react";
import { X, Plus, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PROVIDERS = ["openai", "anthropic"] as const;

interface PolicyEditorProps {
  allowedProviders: string[] | null;
  allowedModels: string[] | null;
  onSave: (providers: string[] | null, models: string[] | null) => Promise<void>;
  disabled?: boolean;
  saving?: boolean;
}

export function PolicyEditor({
  allowedProviders,
  allowedModels,
  onSave,
  disabled,
  saving,
}: PolicyEditorProps) {
  // Derive initial state from props, reset when key selection changes
  const propsKey = `${JSON.stringify(allowedProviders)}|${JSON.stringify(allowedModels)}`;
  const [stateKey, setStateKey] = useState(propsKey);
  const [editing, setEditing] = useState(false);
  const [providers, setProviders] = useState<string[]>(allowedProviders ?? []);
  const [models, setModels] = useState<string[]>(allowedModels ?? []);
  const [modelInput, setModelInput] = useState("");
  const [providersUnrestricted, setProvidersUnrestricted] = useState(allowedProviders === null);
  const [modelsUnrestricted, setModelsUnrestricted] = useState(allowedModels === null);

  // Reset local state when the selected key changes (prop-driven reset)
  if (propsKey !== stateKey) {
    setStateKey(propsKey);
    setProviders(allowedProviders ?? []);
    setModels(allowedModels ?? []);
    setProvidersUnrestricted(allowedProviders === null);
    setModelsUnrestricted(allowedModels === null);
    setEditing(false);
  }

  const handleSave = async () => {
    await onSave(
      providersUnrestricted ? null : providers,
      modelsUnrestricted ? null : models,
    );
    setEditing(false);
  };

  const handleCancel = () => {
    setProviders(allowedProviders ?? []);
    setModels(allowedModels ?? []);
    setProvidersUnrestricted(allowedProviders === null);
    setModelsUnrestricted(allowedModels === null);
    setEditing(false);
  };

  const toggleProvider = (p: string) => {
    setProviders((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  const addModel = () => {
    const trimmed = modelInput.trim();
    if (trimmed && !models.includes(trimmed)) {
      setModels((prev) => [...prev, trimmed]);
    }
    setModelInput("");
  };

  const removeModel = (m: string) => {
    setModels((prev) => prev.filter((x) => x !== m));
  };

  // Read-only view
  if (!editing) {
    return (
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Allowed Providers
          </p>
          {allowedProviders === null ? (
            <span className="text-[13px] text-muted-foreground">All providers</span>
          ) : allowedProviders.length === 0 ? (
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

        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Allowed Models
          </p>
          {allowedModels === null ? (
            <span className="text-[13px] text-muted-foreground">All models</span>
          ) : allowedModels.length === 0 ? (
            <span className="text-[13px] text-red-400">None (all blocked)</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {allowedModels.map((m) => (
                <Badge key={m} variant="secondary" className="font-mono text-[11px]">
                  {m}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {!disabled && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => setEditing(true)}
          >
            Edit Policy
          </Button>
        )}
      </div>
    );
  }

  // Edit view
  return (
    <div className="space-y-4">
      {/* Providers */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Allowed Providers
          </p>
          <button
            type="button"
            onClick={() => setProvidersUnrestricted(!providersUnrestricted)}
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors",
              providersUnrestricted
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {providersUnrestricted ? "Unrestricted" : "Restricted"}
          </button>
        </div>

        {!providersUnrestricted && (
          <div className="flex gap-2">
            {PROVIDERS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => toggleProvider(p)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-[12px] font-medium capitalize transition-colors",
                  providers.includes(p)
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Models */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Allowed Models
          </p>
          <button
            type="button"
            onClick={() => setModelsUnrestricted(!modelsUnrestricted)}
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors",
              modelsUnrestricted
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {modelsUnrestricted ? "Unrestricted" : "Restricted"}
          </button>
        </div>

        {!modelsUnrestricted && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {models.map((m) => (
                <Badge
                  key={m}
                  variant="secondary"
                  className="gap-1 font-mono text-[11px]"
                >
                  {m}
                  <button
                    type="button"
                    onClick={() => removeModel(m)}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={modelInput}
                onChange={(e) => setModelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addModel();
                  }
                }}
                placeholder="e.g. gpt-4o-mini"
                className="h-8 flex-1 font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1"
                onClick={addModel}
              >
                <Plus className="h-3 w-3" />
                Add
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="gap-1.5"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          Save Policy
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          disabled={saving}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
