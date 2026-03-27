import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface PayloadViewerProps {
  title: string;
  data: Record<string, unknown> | null;
}

function isSSEPayload(data: Record<string, unknown>): data is { _format: "sse"; text: string } {
  return data._format === "sse" && typeof data.text === "string";
}

export function PayloadViewer({ title, data }: PayloadViewerProps) {
  if (!data || Object.keys(data).length === 0) return null;

  const isSse = isSSEPayload(data);

  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}{isSse ? " (streaming)" : ""}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="overflow-x-auto rounded-md border border-border/30 bg-background p-4 font-mono text-[13px] leading-relaxed text-foreground/80">
          {isSse ? data.text : JSON.stringify(data, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}
