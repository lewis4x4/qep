export function DealDetailSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading deal details"
      className="flex w-full flex-col gap-4 px-4 pb-28 pt-3 animate-pulse motion-reduce:animate-none"
      data-testid="deal-detail-skeleton"
    >
      <span className="sr-only">Loading deal details…</span>
      {/* Top bar: back button + title */}
      <div className="flex items-center gap-2 -mx-1">
        <div className="h-10 w-10 rounded-full bg-foreground/[0.06] border border-white/[0.06]" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="h-5 w-44 rounded bg-foreground/[0.08]" />
          <div className="h-3 w-28 rounded bg-foreground/[0.04]" />
        </div>
      </div>

      {/* KPI grid (4 tiles) */}
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-[68px] rounded-xl border border-white/[0.06] ${
              i === 0 ? "bg-qep-orange/[0.06]" : "bg-foreground/[0.04]"
            }`}
          />
        ))}
      </div>

      {/* Customer card */}
      <div className="rounded-2xl border border-white/[0.06] bg-foreground/[0.04] p-4 space-y-2.5">
        <div className="h-2.5 w-20 bg-foreground/[0.08] rounded" />
        <div className="h-4 w-48 bg-foreground/[0.08] rounded-md" />
        <div className="flex gap-2 pt-1">
          <div className="h-8 w-32 rounded-full bg-foreground/[0.05] border border-white/[0.06]" />
          <div className="h-8 w-20 rounded-full bg-foreground/[0.05] border border-white/[0.06]" />
        </div>
      </div>

      {/* Quote CTA card */}
      <div className="rounded-2xl border border-qep-orange/20 bg-qep-orange/[0.05] p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="h-4 w-4 rounded bg-qep-orange/30 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-32 bg-foreground/[0.08] rounded" />
            <div className="h-2.5 w-3/4 bg-foreground/[0.05] rounded" />
          </div>
        </div>
        <div className="h-11 w-full rounded-full bg-qep-orange/30" />
      </div>

      {/* Activity timeline */}
      <div className="rounded-2xl border border-white/[0.06] bg-foreground/[0.04] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="h-2.5 w-24 bg-foreground/[0.08] rounded" />
          <div className="h-3 w-10 bg-qep-orange/30 rounded" />
        </div>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[56px] rounded-xl border border-white/[0.04] bg-foreground/[0.02]"
          />
        ))}
      </div>
    </div>
  );
}
