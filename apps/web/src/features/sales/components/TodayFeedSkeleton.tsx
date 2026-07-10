import {
  HERO_COLLAPSED_MIN_HEIGHT_PX,
  HERO_EXPANDED_MIN_HEIGHT_PX,
  readHeroCollapsedState,
} from "./EveningBriefingHero";

function SkeletonLine({ className }: { className: string }) {
  return <div className={`rounded bg-white/[0.07] ${className}`} />;
}

function SectionLabelPlaceholder({ width = "w-24" }: { width?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-3.5 w-3.5 rounded bg-qep-orange/25" />
      <SkeletonLine className={`h-2.5 ${width}`} />
      <div className="h-px flex-1 bg-white/[0.06]" />
    </div>
  );
}

export function TodayFeedSkeleton() {
  const heroCollapsed = readHeroCollapsedState("today-hero");

  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading today's agenda"
      className="px-4 py-4 space-y-4 max-w-lg mx-auto pb-8 animate-pulse motion-reduce:animate-none"
    >
      <span className="sr-only">Loading today's agenda…</span>

      <div className="flex items-center justify-between px-4 py-3 sm:hidden">
        <SkeletonLine className="h-6 w-20" />
        <div className="h-10 w-10 rounded-full bg-qep-orange/30" />
      </div>

      <div
        data-testid="today-feed-skeleton-hero"
        className="relative overflow-hidden rounded-2xl px-5 py-5"
        style={{
          minHeight: heroCollapsed
            ? HERO_COLLAPSED_MIN_HEIGHT_PX
            : HERO_EXPANDED_MIN_HEIGHT_PX,
          background:
            "linear-gradient(135deg, rgba(232,119,34,0.5) 0%, rgba(242,149,86,0.45) 40%, rgba(216,100,32,0.5) 100%)",
        }}
      >
        <div className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/[0.08] blur-[44px]" />
        <div className="relative space-y-2.5">
          <SkeletonLine className="h-3 w-32 bg-white/25" />
          <SkeletonLine className="h-6 w-52 bg-white/30" />
          {!heroCollapsed && (
            <>
              <SkeletonLine className="mt-3 h-3 w-3/4 bg-white/25" />
              <SkeletonLine className="h-3 w-2/3 bg-white/20" />
              <div className="mt-4 h-9 w-36 rounded-full bg-white/20" />
            </>
          )}
        </div>
      </div>

      <section
        data-testid="today-feed-skeleton-narrative"
        className="min-h-[132px] rounded-2xl border border-white/[0.06] bg-[hsl(var(--card))] p-5"
      >
        <SkeletonLine className="h-3 w-24" />
        <SkeletonLine className="mt-3 h-4 w-full" />
        <SkeletonLine className="mt-2 h-4 w-11/12" />
        <SkeletonLine className="mt-2 h-4 w-2/3" />
      </section>

      <div data-testid="today-feed-skeleton-live-signals" className="space-y-2">
        <SkeletonLine className="h-2.5 w-28" />
        <div className="flex gap-2 overflow-hidden">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="h-[76px] w-[140px] shrink-0 rounded-xl border border-white/[0.05] bg-white/[0.04]"
            />
          ))}
        </div>
      </div>


      <div
        data-testid="today-feed-skeleton-streak"
        className="h-11 w-full rounded-full border border-white/[0.06] bg-card"
      />

      <section data-testid="today-feed-skeleton-actions" className="space-y-3">
        <SectionLabelPlaceholder width="w-20" />
        <div className="min-h-[226px] rounded-3xl border border-qep-orange/40 bg-qep-orange/[0.12]" />
        <div className="grid grid-cols-2 gap-3">
          <div className="min-h-[160px] rounded-2xl border border-qep-orange/20 bg-qep-orange/[0.06]" />
          <div className="min-h-[160px] rounded-2xl border border-white/[0.08] bg-[hsl(var(--card))]" />
        </div>
      </section>

      <div
        data-testid="today-feed-skeleton-tomorrow"
        aria-hidden="true"
        className="h-[112px] w-full rounded-xl border border-white/[0.08] bg-[hsl(var(--card))]"
      />

      <section
        data-testid="today-feed-skeleton-quick-tools"
        className="rounded-2xl border border-white/[0.06] bg-[hsl(var(--card))] p-4"
      >
        <SkeletonLine className="h-2.5 w-32" />
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-[50px] rounded-xl border border-white/[0.08] bg-black/20"
            />
          ))}
        </div>
      </section>

    </div>
  );
}
