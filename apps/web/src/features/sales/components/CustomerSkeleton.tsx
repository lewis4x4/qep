export function CustomerSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading customers"
      className="flex flex-col pb-20 max-w-lg mx-auto animate-pulse motion-reduce:animate-none"
    >
      {/* Hero skeleton */}
      <div
        className="px-4 pt-3.5 pb-3 border-b border-white/[0.06]"
        style={{
          background:
            "linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%)",
        }}
      >
        <span className="sr-only">Loading customers…</span>
        <div className="flex items-end justify-between mb-3">
          <div className="space-y-1.5">
            <div className="h-2.5 w-32 bg-white/[0.06] rounded" />
            <div className="h-6 w-24 bg-white/[0.09] rounded-md" />
          </div>
          <div className="flex gap-4">
            <div className="flex flex-col items-end gap-1">
              <div className="h-2.5 w-14 bg-white/[0.06] rounded" />
              <div className="h-4 w-8 bg-qep-orange/15 rounded" />
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="h-2.5 w-8 bg-white/[0.06] rounded" />
              <div className="h-4 w-8 bg-red-500/15 rounded" />
            </div>
          </div>
        </div>
        {/* Search bar skeleton */}
        <div className="h-11 w-full bg-white/[0.04] rounded-xl border border-white/[0.05]" />
      </div>

      {/* Pulse skeleton */}
      <div className="px-4 pt-2.5 pb-0.5">
        <div className="h-[42px] rounded-[12px] bg-white/[0.03] border border-white/[0.05]" />
      </div>

      {/* Insights strip skeleton */}
      <div className="px-4 pt-3 pb-1">
        <div className="h-2.5 w-20 bg-white/[0.06] rounded mb-2" />
        <div className="flex gap-2 overflow-hidden">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-[148px] shrink-0 h-[82px] bg-white/[0.04] rounded-[14px] border border-white/[0.05]"
            />
          ))}
        </div>
      </div>

      {/* Iron-Ranked banner skeleton */}
      <div className="px-4 pt-2.5 pb-0 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="w-[22px] h-[22px] rounded-[7px] bg-qep-orange/10" />
          <div className="h-2.5 w-40 bg-white/[0.06] rounded" />
        </div>
        <div className="h-2.5 w-12 bg-white/[0.05] rounded" />
      </div>

      {/* Customer card skeletons */}
      <div className="px-4 py-3 flex flex-col gap-2.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[180px] bg-white/[0.04] rounded-2xl border border-white/[0.05]"
          />
        ))}
      </div>
    </div>
  );
}
