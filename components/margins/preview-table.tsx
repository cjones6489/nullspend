const PREVIEW_DATA = [
  { customer: "Acme Corp", revenue: "$12,400", cost: "$3,200", margin: "74%", color: "bg-green-400" },
  { customer: "Beta Inc", revenue: "$8,100", cost: "$5,900", margin: "27%", color: "bg-blue-400" },
  { customer: "Gamma LLC", revenue: "$4,200", cost: "$4,800", margin: "-14%", color: "bg-red-400" },
];

export function MarginPreviewTable() {
  return (
    <div className="pointer-events-none select-none opacity-40">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="pb-2 text-left font-medium">Customer</th>
            <th className="pb-2 text-right font-medium">Revenue</th>
            <th className="pb-2 text-right font-medium">Cost</th>
            <th className="pb-2 text-right font-medium">Margin</th>
          </tr>
        </thead>
        <tbody>
          {PREVIEW_DATA.map((row) => (
            <tr key={row.customer} className="border-t border-border/20">
              <td className="py-1.5 text-foreground">{row.customer}</td>
              <td className="py-1.5 text-right font-mono tabular-nums text-foreground">
                {row.revenue}
              </td>
              <td className="py-1.5 text-right font-mono tabular-nums text-foreground">
                {row.cost}
              </td>
              <td className="py-1.5 text-right">
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-mono tabular-nums text-foreground">
                    {row.margin}
                  </span>
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${row.color}`}
                  />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
