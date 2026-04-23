/**
 * FloorStubWidget — brand-compliant preview placeholder.
 *
 * Renders for widget ids that are registered in the floor registry but
 * not yet wired to a real data source. Keeps the Floor visually
 * coherent during the transition period where Brian is composing layouts
 * against widgets whose components still need to be built (e.g.
 * `sales.commission-to-date`, `parts.serial-first`).
 *
 * Intentionally NOT pretending to show data. The copy reads as a
 * deliberate preview, not a broken widget.
 */
import { Sparkles } from "lucide-react";

export interface FloorStubWidgetProps {
  title: string;
  purpose: string;
  /** Optional one-liner sample data (e.g. "3 quotes pending follow-up").
   *  Rendered as dimmed, italic — clearly a mock. */
  sample?: string;
}

export function FloorStubWidget({ title, purpose, sample }: FloorStubWidgetProps) {
  return (
    <div
      role="figure"
      aria-label={`${title} (preview — not yet live)`}
      className="floor-widget-in group relative flex h-full min-h-[168px] flex-col overflow-hidden rounded-xl border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))] p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] transition-all duration-150 ease-out hover:border-[hsl(var(--qep-orange))]/40 hover:translate-y-[-1px]"
    >
      {/* Slice: The Floor v2 chrome — 2px orange left-rule identifies
          every Floor widget at a glance as QEP brand chrome. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[2px] bg-[hsl(var(--qep-orange))]/60"
      />

      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate font-kpi text-[11px] font-extrabold uppercase tracking-[0.14em] text-[hsl(var(--qep-gray))]">
          {title}
        </h3>
        <span className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--qep-orange))]/40 bg-[hsl(var(--qep-orange))]/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--qep-orange))]">
          <Sparkles className="h-2.5 w-2.5" />
          Preview
        </span>
      </div>

      {/* Body */}
      <p className="mt-3 text-sm font-medium leading-snug text-foreground">{purpose}</p>
      {sample && (
        <p className="mt-1 text-xs italic text-muted-foreground">{sample}</p>
      )}

      {/* Footer hint */}
      <div className="mt-auto pt-3">
        <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Wiring in progress — the real widget lands in a follow-up slice.
        </p>
      </div>
    </div>
  );
}
