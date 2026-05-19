import { useFloorNarrative } from "@/features/floor/hooks/useFloorNarrative";

export interface SalesNarrativeBlockProps {
  /** First name used for narrative personalization (placeholder-aware upstream). */
  firstName: string | null;
}

export function SalesNarrativeBlock({ firstName }: SalesNarrativeBlockProps) {
  const narrative = useFloorNarrative("iron_advisor", firstName ?? "");

  if (narrative.isLoading) {
    return (
      <section
        data-testid="sales-narrative-block"
        className="rounded-2xl border border-white/[0.06] bg-[hsl(var(--card))] p-5"
      >
        <div className="h-4 w-24 animate-pulse rounded bg-white/[0.08]" />
        <div className="mt-3 h-4 w-full animate-pulse rounded bg-white/[0.05]" />
        <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-white/[0.05]" />
      </section>
    );
  }

  return (
    <section
      data-testid="sales-narrative-block"
      className="rounded-2xl border border-white/[0.06] bg-[hsl(var(--card))] p-5"
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-qep-orange">
          01 Narrative
        </p>
        {narrative.fresh && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            Last 24h
          </span>
        )}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-foreground/90">
        {narrative.text}
      </p>
    </section>
  );
}
