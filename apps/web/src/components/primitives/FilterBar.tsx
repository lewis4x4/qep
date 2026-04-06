import { useSearchParams } from "react-router-dom";
import { useCallback, useMemo } from "react";
import { Filter, X } from "lucide-react";

export interface FilterDef {
  key: string;
  label: string;
  type: "select" | "text" | "date";
  options?: Array<{ value: string; label: string }>;
}

interface FilterBarProps {
  filters: FilterDef[];
  /** Optional controlled value override; otherwise reads from URL search params. */
  value?: Record<string, string>;
  onChange?: (next: Record<string, string>) => void;
  className?: string;
}

/**
 * Persistent top-of-list filter bar. State is mirrored to URL search params
 * by default so filtered views are shareable; pass `value` + `onChange` for
 * controlled embeds (modals, drawers).
 */
export function FilterBar({ filters, value, onChange, className = "" }: FilterBarProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  const current = useMemo<Record<string, string>>(() => {
    if (value) return value;
    const out: Record<string, string> = {};
    for (const f of filters) {
      const v = searchParams.get(f.key);
      if (v) out[f.key] = v;
    }
    return out;
  }, [value, filters, searchParams]);

  const update = useCallback((key: string, v: string) => {
    const next = { ...current, [key]: v };
    if (!v) delete next[key];
    if (onChange) onChange(next);
    if (!value) {
      const params = new URLSearchParams(searchParams);
      if (v) params.set(key, v);
      else params.delete(key);
      setSearchParams(params, { replace: true });
    }
  }, [current, onChange, searchParams, setSearchParams, value]);

  const clearAll = useCallback(() => {
    if (onChange) onChange({});
    if (!value) {
      const params = new URLSearchParams(searchParams);
      for (const f of filters) params.delete(f.key);
      setSearchParams(params, { replace: true });
    }
  }, [filters, onChange, searchParams, setSearchParams, value]);

  const activeCount = Object.keys(current).length;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <Filter className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      {filters.map((f) => {
        const v = current[f.key] ?? "";
        if (f.type === "select" && f.options) {
          return (
            <select
              key={f.key}
              value={v}
              onChange={(e) => update(f.key, e.target.value)}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs"
              aria-label={f.label}
            >
              <option value="">{f.label}</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          );
        }
        if (f.type === "date") {
          return (
            <input
              key={f.key}
              type="date"
              value={v}
              onChange={(e) => update(f.key, e.target.value)}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs"
              aria-label={f.label}
            />
          );
        }
        return (
          <input
            key={f.key}
            type="text"
            value={v}
            onChange={(e) => update(f.key, e.target.value)}
            placeholder={f.label}
            className="rounded-md border border-border bg-card px-2 py-1 text-xs"
            aria-label={f.label}
          />
        );
      })}
      {activeCount > 0 && (
        <button
          type="button"
          onClick={clearAll}
          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" /> Clear ({activeCount})
        </button>
      )}
    </div>
  );
}
