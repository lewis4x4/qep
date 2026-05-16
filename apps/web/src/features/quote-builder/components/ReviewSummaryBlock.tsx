export function ReviewSummaryBlock({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string]>;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/50 p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
      <div className="mt-3 space-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">{label}</span>
            <span className="max-w-[60%] text-right font-medium text-foreground">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
