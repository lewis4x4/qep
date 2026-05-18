import { useNavigate } from "react-router-dom";
import { Mic, FileText, Users, Sparkles, ArrowRight } from "lucide-react";

interface PipelineEmptyStateProps {
  /** When set, render the lighter "no deals in this filter" variant. */
  filterLabel?: string;
}

export function PipelineEmptyState({ filterLabel }: PipelineEmptyStateProps) {
  const navigate = useNavigate();

  if (filterLabel) {
    return (
      <div className="text-center py-10">
        <p className="text-muted-foreground text-sm">
          No deals in <span className="text-foreground font-semibold">{filterLabel}</span>.
        </p>
        <p className="text-muted-foreground/60 text-xs mt-1">
          Switch filter, or capture a visit to grow this stage.
        </p>
      </div>
    );
  }

  return (
    <div className="px-1 pt-2 pb-8">
      {/* Gradient hero */}
      <div
        className="relative overflow-hidden rounded-2xl px-5 pt-6 pb-5 mb-4"
        style={{
          background:
            "linear-gradient(135deg, #E87722 0%, #F29556 40%, #D86420 100%)",
          boxShadow:
            "0 8px 32px rgba(232,119,34,0.25), inset 0 1px 0 rgba(255,255,255,0.2)",
        }}
      >
        <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white/[0.08] blur-[40px]" />
        <div className="absolute -bottom-12 -left-8 w-32 h-32 rounded-full bg-white/[0.05] blur-[36px]" />

        <div className="relative flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0 border border-white/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-extrabold text-white/80 uppercase tracking-[0.14em] mb-1">
              Your pipeline is a blank canvas
            </p>
            <h2 className="text-[19px] font-black text-white leading-[1.15] mb-2 tracking-[-0.01em]">
              Let&apos;s build it together.
            </h2>
            <p className="text-[13px] text-white/85 leading-snug">
              Capture a visit, draft a quote, or browse customers — every
              touchpoint feeds your forecast and unlocks AI follow-ups.
            </p>
          </div>
        </div>
      </div>

      {/* Action stack */}
      <div className="flex flex-col gap-2">
        <ActionRow
          onClick={() => navigate("/sales/capture")}
          icon={<Mic className="w-[18px] h-[18px]" />}
          label="Capture a Visit"
          hint="Voice-log a customer touchpoint — fastest way to start a deal"
          variant="primary"
        />
        <ActionRow
          onClick={() => navigate("/sales/quotes/new")}
          icon={<FileText className="w-[18px] h-[18px]" />}
          label="Draft a Quote"
          hint="Quotes auto-create pipeline deals tied to the customer"
          variant="secondary"
        />
        <ActionRow
          onClick={() => navigate("/sales/customers")}
          icon={<Users className="w-[18px] h-[18px]" />}
          label="Browse Customers"
          hint="Re-engage accounts that have gone quiet"
          variant="secondary"
        />
      </div>

      <p className="text-[11px] text-muted-foreground/60 text-center mt-5 px-4 leading-relaxed">
        Once deals land here, your pipeline surfaces at-risk accounts, closing
        opportunities, and your next best move — automatically.
      </p>
    </div>
  );
}

function ActionRow({
  onClick,
  icon,
  label,
  hint,
  variant,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
  variant: "primary" | "secondary";
}) {
  const isPrimary = variant === "primary";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group w-full flex items-center gap-3 px-3.5 py-3 rounded-[14px] border text-left transition-all active:scale-[0.985] ${
        isPrimary
          ? "border-qep-orange/40 bg-qep-orange/10 hover:bg-qep-orange/15"
          : "border-white/[0.07] bg-[hsl(var(--card))] hover:bg-white/[0.04]"
      }`}
    >
      <div
        className={`w-10 h-10 rounded-[11px] flex items-center justify-center shrink-0 ${
          isPrimary
            ? "bg-qep-orange/20 text-qep-orange"
            : "bg-white/[0.05] text-foreground/80"
        }`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={`text-[14px] font-bold leading-tight ${
            isPrimary ? "text-qep-orange" : "text-foreground"
          }`}
        >
          {label}
        </p>
        <p className="text-[11.5px] text-muted-foreground/80 leading-snug mt-0.5">
          {hint}
        </p>
      </div>
      <ArrowRight
        className={`w-4 h-4 shrink-0 transition-transform group-active:translate-x-0.5 ${
          isPrimary ? "text-qep-orange" : "text-muted-foreground/60"
        }`}
      />
    </button>
  );
}
