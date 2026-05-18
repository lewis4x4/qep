import { Mic, Sparkles } from "lucide-react";

export type TimeOfDay = "morning" | "afternoon" | "evening";

export interface EveningBriefingHeroProps {
  firstName: string | null;
  timeOfDay: TimeOfDay;
  /** Headline summary line ("Today: 4 visits logged, $1.2M in motion.") */
  headline: string | null;
  /** Optional secondary line — usually the tomorrow setup. */
  followup?: string | null;
  /** What the assistant is doing right now ("Scanning 47 deals…"). Drives the live dot. */
  assistantStatus?: string;
  /** Tap-to-dictate handler. Always present so voice is one tap from the hero. */
  onVoicePress?: () => void;
}

const LABELS: Record<TimeOfDay, string> = {
  morning: "Morning Briefing",
  afternoon: "Midday Pulse",
  evening: "Evening Briefing",
};

const VOICE_PROMPTS: Record<TimeOfDay, string> = {
  morning: "Hold to plan the day",
  afternoon: "Hold to log a touch",
  evening: "Hold to recap the day",
};

export function EveningBriefingHero({
  firstName,
  timeOfDay,
  headline,
  followup,
  assistantStatus,
  onVoicePress,
}: EveningBriefingHeroProps) {
  const greeting = firstName
    ? `Good ${timeOfDay}, ${firstName}`
    : `Good ${timeOfDay}`;

  return (
    <div
      data-testid="evening-briefing-hero"
      className="rounded-2xl px-5 py-5 relative overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, #E87722 0%, #F29556 40%, #D86420 100%)",
        boxShadow:
          "0 8px 32px rgba(232,119,34,0.28), inset 0 1px 0 rgba(255,255,255,0.22)",
      }}
    >
      <div className="absolute -top-10 -right-10 w-44 h-44 rounded-full bg-white/[0.09] blur-[44px] pointer-events-none" />

      <div className="relative">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-white/90" />
            <span className="text-[11px] font-bold text-white/90 uppercase tracking-[0.1em]">
              {LABELS[timeOfDay]}
            </span>
          </div>
          {assistantStatus && (
            <div
              className="flex items-center gap-1.5"
              aria-label={`Assistant status: ${assistantStatus}`}
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white/80 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
              </span>
              <span className="text-[10px] font-semibold text-white/90 uppercase tracking-wider">
                {assistantStatus}
              </span>
            </div>
          )}
        </div>

        <p className="text-xl font-extrabold text-white leading-snug tracking-tight">
          {greeting}
        </p>

        {headline && (
          <p className="text-sm font-medium text-white/[0.95] leading-relaxed mt-1.5">
            {headline}
          </p>
        )}
        {followup && (
          <p className="text-[13px] text-white/85 leading-relaxed mt-1">
            {followup}
          </p>
        )}

        {onVoicePress && (
          <button
            type="button"
            onClick={onVoicePress}
            aria-label="Dictate a note"
            className="mt-4 inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-white/15 backdrop-blur-sm border border-white/25 text-white text-xs font-semibold active:scale-95 transition-transform hover:bg-white/25"
          >
            <Mic className="w-3.5 h-3.5" />
            {VOICE_PROMPTS[timeOfDay]}
          </button>
        )}
      </div>
    </div>
  );
}
