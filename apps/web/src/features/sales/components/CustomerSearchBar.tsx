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
    <div className="sticky top-14 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-4 py-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          placeholder="Search customers..."
          className="w-full h-10 pl-9 pr-9 rounded-xl bg-slate-100 text-sm placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-qep-orange/30"
        />
        {local && (
          <button
            onClick={() => {
              setLocal("");
              onChange("");
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-slate-300 flex items-center justify-center hover:bg-slate-400"
          >
            <X className="w-3 h-3 text-white" />
          </button>
        )}
      </div>
    </div>
  );
}
