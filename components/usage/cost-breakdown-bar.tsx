import { formatMicrodollars } from "@/lib/utils/format";

interface CostBreakdown {
  input?: number;
  output?: number;
  cached?: number;
  reasoning?: number;
  toolDefinition?: number;
}

interface CostBreakdownBarProps {
  breakdown: CostBreakdown | null | undefined;
}

interface Segment {
  label: string;
  value: number;
  color: string;
}

function decompose(b: CostBreakdown): Segment[] {
  const inputBase = b.input ?? 0;
  const outputBase = b.output ?? 0;
  const cached = b.cached ?? 0;
  const reasoning = b.reasoning ?? 0;
  const toolDef = b.toolDefinition ?? 0;

  const segments: Segment[] = [];

  const inputExclTool = Math.max(0, inputBase - toolDef);
  if (inputExclTool > 0) {
    segments.push({ label: "Input", value: inputExclTool, color: "bg-blue-500" });
  }
  if (toolDef > 0) {
    segments.push({ label: "Tool Definition", value: toolDef, color: "bg-orange-500" });
  }

  const outputExclReasoning = Math.max(0, outputBase - reasoning);
  if (outputExclReasoning > 0) {
    segments.push({ label: "Output", value: outputExclReasoning, color: "bg-emerald-500" });
  }
  if (reasoning > 0) {
    segments.push({ label: "Reasoning", value: reasoning, color: "bg-amber-500" });
  }

  if (cached > 0) {
    segments.push({ label: "Cached", value: cached, color: "bg-purple-500" });
  }

  return segments;
}

export function CostBreakdownBar({ breakdown }: CostBreakdownBarProps) {
  if (!breakdown) return null;

  const segments = decompose(breakdown);
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  if (total === 0) {
    return (
      <p className="py-1 text-[11px] text-muted-foreground/60">
        No cost breakdown
      </p>
    );
  }

  return (
    <div className="space-y-2 py-1.5">
      {/* Stacked bar */}
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary/30">
        {segments.map((seg) => (
          <div
            key={seg.label}
            className={`${seg.color} transition-all`}
            style={{ width: `${(seg.value / total) * 100}%` }}
            title={`${seg.label}: ${formatMicrodollars(seg.value)}`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${seg.color}`} />
            <span className="text-[11px] text-muted-foreground">{seg.label}</span>
            <span className="font-mono text-[11px] text-foreground">
              {formatMicrodollars(seg.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Format a cost breakdown as a plain text string for use in title attributes.
 * Returns null if breakdown is null/undefined or all values are zero.
 */
export function formatBreakdownTitle(
  breakdown: CostBreakdown | null | undefined,
): string | null {
  if (!breakdown) return null;

  const segments = decompose(breakdown);
  if (segments.length === 0) return null;

  return segments
    .map((s) => `${s.label}: ${formatMicrodollars(s.value)}`)
    .join(" | ");
}
