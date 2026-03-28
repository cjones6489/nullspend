import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  className,
  hero,
}: {
  label: string;
  value: string;
  className?: string;
  hero?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-colors",
        hero
          ? "border-primary/30 bg-primary/5"
          : "border-border/30 bg-background",
      )}
    >
      <p
        className={cn(
          "font-bold tabular-nums text-foreground",
          hero ? "text-3xl leading-tight" : "text-lg",
          className,
        )}
      >
        {value}
      </p>
      <p className={cn("text-muted-foreground", hero ? "mt-1 text-xs" : "text-[11px]")}>{label}</p>
    </div>
  );
}
