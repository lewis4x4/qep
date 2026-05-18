export function PipelineSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading pipeline"
      className="flex flex-col pb-20 max-w-lg mx-auto animate-pulse motion-reduce:animate-none"
    >
      <span className="sr-only">Loading pipeline…</span>
      {/* Hero skeleton */}
      <div
        className="px-4 pt-3.5 pb-3 border-b border-white/[0.06]"
        style={{
          background:
            "linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%)",
        }}
      >
        <div className="flex items-start justify-between mb-2.5">
          <div className="space-y-1.5">
            <div className="h-2.5 w-24 bg-white/[0.06] rounded" />
            <div className="h-7 w-32 bg-white/[0.09] rounded-md" />
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="h-2.5 w-14 bg-white/[0.06] rounded" />
            <div className="h-5 w-20 bg-qep-orange/15 rounded-md" />
          </div>
        </div>
        <div className="h-1.5 w-full bg-white/[0.05] rounded mb-2.5" />
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex-1 h-[44px] bg-white/[0.04] rounded-[10px] border border-white/[0.05]"
            />
          ))}
        </div>
      </div>

      {/* Forecast strip skeleton */}
      <div className="px-4 pt-3 pb-1">
        <div className="h-[100px] rounded-2xl border border-qep-orange/15 bg-qep-orange/[0.03]" />
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

      {/* Stage tabs skeleton */}
      <div className="px-4 py-3 flex gap-2 overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-7 w-16 bg-white/[0.04] rounded-full shrink-0"
          />
        ))}
      </div>

      {/* Deal card skeletons */}
      <div className="px-4 py-1 flex flex-col gap-2.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[96px] bg-white/[0.04] rounded-2xl border border-white/[0.05]"
          />
        ))}
      </div>
    </div>
  );
}
