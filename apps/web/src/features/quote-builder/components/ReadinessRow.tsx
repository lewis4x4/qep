export function ReadinessRow({
  label,
  ready,
  detail,
}: {
  label: string;
  ready: boolean;
  detail?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded border border-border/60 bg-background/50 px-3 py-2">
      <div>
        <p className="font-medium text-foreground">{label}</p>
        {!ready && detail ? <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p> : null}
      </div>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
        ready ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-300"
      }`}>
        {ready ? "ready" : "open"}
      </span>
    </div>
  );
}
