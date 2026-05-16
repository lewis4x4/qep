export function SummaryRow({
  label,
  value,
  emphasize = false,
  positive = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  positive?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${emphasize ? "border-t border-border pt-2" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${emphasize ? "text-qep-orange" : positive ? "text-emerald-400" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}
