import { PRIORITY_LABELS, STATUS_FLAG_LABELS } from "../lib/constants";
import type { ServiceListFilters } from "../lib/types";

interface Props {
  filters: ServiceListFilters;
  onChange: (filters: ServiceListFilters) => void;
}

export function ServiceCommandFilters({ filters, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={filters.search ?? ""}
        onChange={(e) => onChange({ ...filters, search: e.target.value || undefined, page: 1 })}
        placeholder="Search jobs..."
        className="rounded-md border px-3 py-1.5 text-sm bg-background w-48"
      />
      <select
        value={filters.priority ?? ""}
        onChange={(e) => onChange({ ...filters, priority: e.target.value || undefined, page: 1 })}
        className="rounded-md border px-2 py-1.5 text-sm bg-background"
      >
        <option value="">All Priorities</option>
        {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      <select
        value={filters.status_flag ?? ""}
        onChange={(e) => onChange({ ...filters, status_flag: e.target.value || undefined, page: 1 })}
        className="rounded-md border px-2 py-1.5 text-sm bg-background"
      >
        <option value="">All Flags</option>
        {Object.entries(STATUS_FLAG_LABELS).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          checked={filters.include_closed ?? false}
          onChange={(e) => onChange({ ...filters, include_closed: e.target.checked, page: 1 })}
          className="rounded border"
        />
        Closed
      </label>
    </div>
  );
}
