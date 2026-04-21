import { Search, X } from "lucide-react";

export interface OmniSearchProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
}

export function OmniSearch({ value, onChange, onSubmit, onClear }: OmniSearchProps) {
  return (
    <form
      className="relative"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search document titles and evidence..."
        className="w-full rounded-md border border-input bg-background px-9 py-2 text-sm text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
      />
      {value && (
        <button
          type="button"
          onClick={onClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
          <span className="sr-only">Clear search</span>
        </button>
      )}
    </form>
  );
}
