import { PRIORITY_LABELS, STATUS_FLAG_LABELS } from "../lib/constants";
import type { ServiceListFilters } from "../lib/types";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  filters: ServiceListFilters;
  onChange: (filters: ServiceListFilters) => void;
}

const selectClass = cn(
  "h-8 rounded-lg border border-border/50 bg-background px-2.5 pr-7 text-xs font-medium",
  "text-foreground appearance-none cursor-pointer",
  "transition-colors hover:border-border focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40",
  "dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-white/[0.15] dark:focus:border-primary/40",
  "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%239CA3AF%22%20stroke-width%3D%222.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22/%3E%3C/svg%3E')] bg-[length:12px] bg-[right_6px_center] bg-no-repeat",
);

export function ServiceCommandFilters({ filters, onChange }: Props) {
  const hasActiveFilters = !!(filters.search || filters.priority || filters.status_flag || filters.include_closed);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={filters.search ?? ""}
          onChange={(e) => onChange({ ...filters, search: e.target.value || undefined, page: 1 })}
          placeholder="Search jobs..."
          className={cn(
            "h-8 w-44 rounded-lg border border-border/50 bg-background pl-8 pr-3 text-xs",
            "placeholder:text-muted-foreground/60",
            "transition-colors hover:border-border focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40",
            "dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-white/[0.15] dark:focus:border-primary/40",
          )}
        />
      </div>
      <select
        value={filters.priority ?? ""}
        onChange={(e) => onChange({ ...filters, priority: e.target.value || undefined, page: 1 })}
        className={selectClass}
      >
        <option value="">Priority</option>
        {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      <select
        value={filters.status_flag ?? ""}
        onChange={(e) => onChange({ ...filters, status_flag: e.target.value || undefined, page: 1 })}
        className={selectClass}
      >
        <option value="">Flags</option>
        {Object.entries(STATUS_FLAG_LABELS).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      <label className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 text-xs font-medium cursor-pointer",
        "transition-colors hover:border-border",
        "dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-white/[0.15]",
        filters.include_closed && "border-primary/30 bg-primary/5 dark:border-primary/30 dark:bg-primary/10",
      )}>
        <input
          type="checkbox"
          checked={filters.include_closed ?? false}
          onChange={(e) => onChange({ ...filters, include_closed: e.target.checked, page: 1 })}
          className="sr-only"
        />
        <div className={cn(
          "h-3.5 w-3.5 rounded border flex items-center justify-center transition-colors",
          filters.include_closed
            ? "bg-primary border-primary text-primary-foreground"
            : "border-border dark:border-white/20"
        )}>
          {filters.include_closed && (
            <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none">
              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        <span className="text-muted-foreground">Closed</span>
      </label>
      {hasActiveFilters && (
        <button
          type="button"
          onClick={() => onChange({ per_page: 100 })}
          className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground dark:hover:bg-white/[0.05]"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
      )}
    </div>
  );
}
