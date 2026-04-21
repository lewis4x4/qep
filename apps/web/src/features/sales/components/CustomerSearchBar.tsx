import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";

export function CustomerSearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);

  // Debounce
  useEffect(() => {
    const timer = setTimeout(() => onChange(local), 300);
    return () => clearTimeout(timer);
  }, [local, onChange]);

  return (
    <div className="relative">
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[15px] h-[15px] text-muted-foreground/50" />
      <input
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder="Search customers, contacts, cities, Search 1/2..."
        className="w-full py-[11px] pl-10 pr-10 rounded-xl border border-white/[0.06] bg-[hsl(var(--card))] text-foreground text-sm font-medium placeholder:text-muted-foreground/40 outline-none focus:border-qep-orange transition-colors"
      />
      {local && (
        <button
          onClick={() => {
            setLocal("");
            onChange("");
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-foreground/20 flex items-center justify-center hover:bg-foreground/30 transition-colors"
        >
          <X className="w-3 h-3 text-foreground" />
        </button>
      )}
    </div>
  );
}
