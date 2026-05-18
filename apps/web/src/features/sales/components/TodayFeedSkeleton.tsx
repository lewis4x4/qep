export function TodayFeedSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading today's agenda"
      className="px-4 py-4 space-y-5 max-w-lg mx-auto pb-8 animate-pulse motion-reduce:animate-none"
    >
      <span className="sr-only">Loading today's agenda…</span>
      {/* Mobile header skeleton */}
      <div className="flex items-center justify-between px-4 py-3 sm:hidden">
        <div className="h-6 w-20 bg-white/[0.08] rounded-md" />
        <div className="w-10 h-10 rounded-full bg-qep-orange/30" />
      </div>

      {/* Briefing hero (gradient orange placeholder) */}
      <div
        className="rounded-2xl h-[148px] relative overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, rgba(232,119,34,0.5) 0%, rgba(242,149,86,0.45) 40%, rgba(216,100,32,0.5) 100%)",
        }}
      >
        <div className="absolute -top-10 -right-10 w-44 h-44 rounded-full bg-white/[0.08] blur-[44px]" />
        <div className="absolute inset-x-5 top-5 space-y-2.5">
          <div className="h-3 w-32 bg-white/25 rounded" />
          <div className="h-5 w-44 bg-white/35 rounded-md" />
          <div className="h-3 w-3/4 bg-white/25 rounded mt-3" />
          <div className="h-3 w-2/3 bg-white/20 rounded" />
        </div>
      </div>

      {/* Momentum strip placeholder */}
      <div className="space-y-2">
        <div className="h-2.5 w-24 bg-white/[0.06] rounded" />
        <div className="h-[80px] rounded-xl bg-white/[0.04] border border-white/[0.05]" />
      </div>

      {/* Live signals strip placeholder */}
      <div className="space-y-2">
        <div className="h-2.5 w-28 bg-white/[0.06] rounded" />
        <div className="flex gap-2 overflow-hidden">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-[140px] shrink-0 h-[76px] bg-white/[0.04] rounded-xl border border-white/[0.05]"
            />
          ))}
        </div>
      </div>

      {/* Priority actions section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-3.5 h-3.5 bg-qep-orange/30 rounded" />
          <div className="h-2.5 w-28 bg-white/[0.06] rounded" />
          <div className="flex-1 h-px bg-white/[0.06]" />
        </div>
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-[96px] bg-white/[0.04] rounded-xl border border-white/[0.05]"
          />
        ))}
      </div>

      {/* Approvals section placeholder (Phase 2C) */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="w-3.5 h-3.5 bg-amber-400/25 rounded" />
          <div className="h-2.5 w-20 bg-white/[0.06] rounded" />
          <div className="flex-1 h-px bg-white/[0.06]" />
        </div>
        <div className="h-[68px] bg-white/[0.04] rounded-xl border border-amber-400/15" />
        <div className="h-[68px] bg-white/[0.04] rounded-xl border border-amber-400/10" />
      </div>

      {/* Meetings section placeholder */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-3.5 h-3.5 bg-purple-400/30 rounded" />
          <div className="h-2.5 w-32 bg-white/[0.06] rounded" />
          <div className="flex-1 h-px bg-white/[0.06]" />
        </div>
        <div className="h-[88px] bg-white/[0.04] rounded-xl border border-white/[0.05]" />
      </div>
    </div>
  );
}
