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
    <div className="sticky top-0 z-10 bg-[hsl(var(--background))] border-b border-white/[0.06] relative">
      <div
        ref={scrollRef}
        className="overflow-x-auto scrollbar-none"
      >
        <div className="flex gap-1.5 px-3 pr-8 py-2.5 min-w-max">
          {options.map((opt) => (
            <button
              key={opt.key}
              ref={opt.key === active ? activeRef : undefined}
              onClick={() => onChange(opt.key)}
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-[7px] rounded-full text-xs font-bold whitespace-nowrap transition-all duration-150 border",
                opt.key === active
                  ? "bg-qep-orange text-white border-qep-orange"
                  : "bg-[hsl(var(--card))] text-muted-foreground border-white/[0.06] hover:border-white/20",
              )}
            >
              {opt.label}
              <span
                className={cn(
                  "text-[10px] font-extrabold rounded-[10px] px-[7px] py-[1px] min-w-[20px] text-center",
                  opt.key === active
                    ? "bg-white/25 text-white"
                    : "bg-foreground/[0.06] text-muted-foreground/60",
                )}
              >
                {opt.count}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[hsl(var(--background))] to-transparent"
      />
    </div>
  );
}
