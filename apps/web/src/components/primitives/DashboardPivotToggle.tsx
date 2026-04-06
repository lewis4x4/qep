interface PivotOption {
  key: string;
  label: string;
  icon?: React.ReactNode;
}

interface DashboardPivotToggleProps {
  pivots: PivotOption[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}

/**
 * Generalization of the T3 "Service Dashboard / Mechanic Overview" pivot
 * pattern. Used by Service Dashboard, Fleet Map, and any dashboard that
 * supports multiple lenses on the same data set.
 */
export function DashboardPivotToggle({
  pivots, value, onChange, className = "",
}: DashboardPivotToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="Dashboard pivot"
      className={`inline-flex rounded-md border border-border bg-card p-0.5 ${className}`}
    >
      {pivots.map((p) => {
        const isActive = p.key === value;
        return (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(p.key)}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              isActive
                ? "bg-qep-orange text-white"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.icon}
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
