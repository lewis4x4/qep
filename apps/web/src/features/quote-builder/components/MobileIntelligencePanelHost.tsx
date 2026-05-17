/**
 * WAVE phase 1: Surface the right-rail intelligence panels (AI
 * Recommendation, Deal Coach, etc.) on mobile / tablet viewports.
 * Renders a horizontally scrolling chip rail with `MobileBottomSheet`
 * drawers — one per panel slot — so the rep can pull each up over the
 * current step. Hidden on `xl` and above, where the desktop sidebar
 * inside `QuoteBuilderV2PageShell` takes over.
 */

import { useState, type ReactNode } from "react";
import { Sparkles, Brain, Compass } from "lucide-react";
import { MobileBottomSheet } from "@/features/sales/components/MobileBottomSheet";
import { cn } from "@/lib/utils";

export interface MobileIntelligencePanelHostProps {
  /** Top-level intelligence panel (CustomerIntel / QuoteIntelligencePanel). */
  intelligencePanel: ReactNode;
  /** Optional deal-coach panel — passed as JSX so the host stays presentational. */
  dealCoachPanel?: ReactNode;
  /** Optional extra chips with their own sheet content (financing, what-to-mention, etc.). */
  extraPanels?: MobileIntelligenceExtraPanel[];
  className?: string;
}

export interface MobileIntelligenceExtraPanel {
  id: string;
  label: string;
  icon?: ReactNode;
  content: ReactNode;
}

type ActivePanel = "intel" | "coach" | { extra: string } | null;

export function MobileIntelligencePanelHost({
  intelligencePanel,
  dealCoachPanel,
  extraPanels,
  className,
}: MobileIntelligencePanelHostProps) {
  const [active, setActive] = useState<ActivePanel>(null);
  const close = () => setActive(null);

  return (
    <div
      className={cn("xl:hidden w-full", className)}
      data-testid="mobile-intelligence-panel-host"
    >
      <div className="flex gap-2 overflow-x-auto scrollbar-none px-1 pb-1 -mx-1 snap-x snap-mandatory">
        <ChipButton
          icon={<Sparkles className="w-3.5 h-3.5" aria-hidden />}
          label="AI Recommendation"
          onClick={() => setActive("intel")}
        />
        {dealCoachPanel && (
          <ChipButton
            icon={<Compass className="w-3.5 h-3.5" aria-hidden />}
            label="Deal Coach"
            onClick={() => setActive("coach")}
          />
        )}
        {extraPanels?.map((panel) => (
          <ChipButton
            key={panel.id}
            icon={panel.icon ?? <Brain className="w-3.5 h-3.5" aria-hidden />}
            label={panel.label}
            onClick={() => setActive({ extra: panel.id })}
          />
        ))}
      </div>

      <MobileBottomSheet
        open={active === "intel"}
        onOpenChange={(open) => !open && close()}
        title="AI Recommendation"
        description="Iron's read on this deal"
        size="tall"
      >
        {intelligencePanel}
      </MobileBottomSheet>

      {dealCoachPanel && (
        <MobileBottomSheet
          open={active === "coach"}
          onOpenChange={(open) => !open && close()}
          title="Deal Coach"
          description="Live margin + signal coaching"
          size="tall"
        >
          {dealCoachPanel}
        </MobileBottomSheet>
      )}

      {extraPanels?.map((panel) => (
        <MobileBottomSheet
          key={panel.id}
          open={
            active !== null &&
            typeof active === "object" &&
            "extra" in active &&
            active.extra === panel.id
          }
          onOpenChange={(open) => !open && close()}
          title={panel.label}
          size="tall"
        >
          {panel.content}
        </MobileBottomSheet>
      ))}
    </div>
  );
}

function ChipButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="snap-start shrink-0 inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 text-xs font-semibold whitespace-nowrap hover:border-cyan-400/60 active:scale-[0.97] transition-all"
      data-mobile-intel-chip={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
