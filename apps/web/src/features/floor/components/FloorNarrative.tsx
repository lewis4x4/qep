/**
 * FloorNarrative — one-sentence overnight brief across the top of the
 * Floor. 48px fixed height on desktop; wraps to 2 lines on mobile.
 *
 * v1 renders a static, role-flavored sentence derived from the widget
 * ids in the layout. A server-side Claude-generated narrative edge fn
 * (`floor-narrative`) lands in a follow-up slice and will replace the
 * `buildStaticNarrative` call here.
 */
import { Sparkles } from "lucide-react";
import type { IronRole } from "@/features/qrm/lib/iron-roles";

export interface FloorNarrativeProps {
  role: IronRole;
  userFirstName: string;
  /** True when the narrative is "fresh" (generated in the last 15m).
   *  Drives the orange pulse dot. v1 always renders as fresh since
   *  copy is generated locally. */
  fresh?: boolean;
}

/**
 * v1 narrative copy — deliberately short, brand-voice ("direct, work-ready,
 * no corporate jargon, no AI-fluff"). These are placeholders until the
 * narrative edge fn ships — each variant reads like a sentence a seasoned
 * manager would say at a standup, not a chatbot.
 */
function buildStaticNarrative(role: IronRole, firstName: string): string {
  const greeting = firstName ? `${firstName}, ` : "";
  switch (role) {
    case "iron_owner":
      return `${greeting}here's the floor — approvals and at-risk customers surfaced below. Nothing's on fire.`;
    case "iron_manager":
      return `${greeting}approvals, stale deals, and pipeline pressure are all on-deck. Start with the queue.`;
    case "iron_advisor":
      return `${greeting}your day's shape is below. The first action is the one that unsticks a deal.`;
    case "iron_woman":
      return `${greeting}processing work, deposits, and credit apps are ready for you. Clear the blockers first.`;
    case "iron_man":
      return `${greeting}prep queue is loaded. PDI checklists are waiting. Next job is at the top.`;
    case "iron_parts_counter":
      return `${greeting}drop a serial to quote. Drafts are saved. Everything else is one button away.`;
    case "iron_parts_manager":
      return `${greeting}demand forecast is trending. Replenishment queue is ready for your review.`;
  }
}

export function FloorNarrative({ role, userFirstName, fresh = true }: FloorNarrativeProps) {
  const text = buildStaticNarrative(role, userFirstName);
  return (
    <div
      role="status"
      aria-live="polite"
      className="relative flex shrink-0 items-start gap-2.5 bg-[hsl(var(--qep-deck))] px-6 py-3 sm:h-14 sm:py-0"
    >
      {/* Slice: The Floor v2 — breathing orange thread.
          A 2px full-width bar at the bottom of the narrative strip
          gently breathes when the narrative is fresh (<15m). Replaces
          the barely-visible tiny dot with deliberate brand chrome —
          reads as "this line is alive" at a glance. */}
      <span
        aria-hidden="true"
        className={`absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[hsl(var(--qep-orange))] to-transparent ${
          fresh ? "floor-breathe" : "opacity-30"
        }`}
      />

      {/* Marker icon — sparkle when stale, pulse when fresh */}
      <span className="mt-1.5 flex shrink-0 items-center justify-center sm:mt-[22px]">
        {fresh ? (
          <span className="relative flex h-2 w-2 items-center justify-center">
            <span className="absolute h-2 w-2 animate-pulse-ring rounded-full bg-[hsl(var(--qep-orange))]/60" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-[hsl(var(--qep-orange))]" />
          </span>
        ) : (
          <Sparkles className="h-3 w-3 text-muted-foreground" />
        )}
      </span>

      {/* Sentence — bumped to 15pt Inter semibold so it reads as a headline, not a caption */}
      <p className="min-w-0 flex-1 self-center text-[15px] font-medium leading-snug text-foreground sm:truncate">
        {text}
      </p>
    </div>
  );
}
