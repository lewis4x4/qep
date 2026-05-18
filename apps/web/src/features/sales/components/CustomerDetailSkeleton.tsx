export function CustomerDetailSkeleton() {
  return (
    <div className="pb-20 max-w-lg mx-auto animate-pulse">
      {/* Header */}
      <div
        className="px-4 pt-3 pb-4 border-b border-white/[0.06]"
        style={{
          background:
            "linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%)",
        }}
      >
        {/* Back button */}
        <div className="h-4 w-24 bg-white/[0.06] rounded mb-3" />

        {/* Avatar + Name + Score */}
        <div className="flex items-start gap-3 mb-3">
          <div className="w-[52px] h-[52px] rounded-xl bg-qep-orange/30 shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="h-5 w-48 bg-white/[0.08] rounded-md" />
            <div className="h-3 w-32 bg-white/[0.05] rounded" />
            <div className="h-2.5 w-24 bg-white/[0.04] rounded" />
          </div>
          <div className="w-14 h-7 rounded-xl bg-white/[0.05] border border-white/[0.06]" />
        </div>

        {/* Action row */}
        <div className="grid grid-cols-4 gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-[52px] rounded-[10px] ${
                i === 0 ? "bg-qep-orange/30" : "bg-white/[0.05]"
              } border border-white/[0.06]`}
            />
          ))}
        </div>
      </div>

      {/* Body sections */}
      <div className="px-4 pt-4 space-y-5">
        {/* Equipment fleet placeholder */}
        <div className="space-y-2">
          <div className="h-2.5 w-32 bg-white/[0.06] rounded" />
          <div className="h-[140px] bg-white/[0.04] rounded-2xl border border-white/[0.05]" />
        </div>

        {/* Active deal placeholder */}
        <div className="space-y-2">
          <div className="h-2.5 w-24 bg-white/[0.06] rounded" />
          <div className="h-[88px] bg-white/[0.04] rounded-[14px] border border-qep-orange/15" />
        </div>

        {/* Timeline placeholder */}
        <div className="space-y-2">
          <div className="h-2.5 w-28 bg-white/[0.06] rounded" />
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[64px] bg-white/[0.04] rounded-xl border border-white/[0.05]"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
