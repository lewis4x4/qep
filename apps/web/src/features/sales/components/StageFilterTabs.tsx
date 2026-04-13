import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface FilterOption {
  key: string;
  label: string;
  count: number;
}

export function StageFilterTabs({
  options,
  active,
  onChange,
}: {
  options: FilterOption[];
  active: string;
  onChange: (key: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Scroll active tab into view
  useEffect(() => {
    activeRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [active]);

  return (
    <div
      ref={scrollRef}
      className="sticky top-14 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200 overflow-x-auto scrollbar-none"
    >
      <div className="flex gap-1 px-4 py-2 min-w-max">
        {options.map((opt) => (
          <button
            key={opt.key}
            ref={opt.key === active ? activeRef : undefined}
            onClick={() => onChange(opt.key)}
            className={cn(
              "flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors",
              opt.key === active
                ? "bg-qep-orange text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200",
            )}
          >
            {opt.label}
            <span
              className={cn(
                "text-xs rounded-full px-1.5 py-0.5 font-semibold min-w-[20px] text-center",
                opt.key === active
                  ? "bg-white/20 text-white"
                  : "bg-slate-200 text-slate-500",
              )}
            >
              {opt.count}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
