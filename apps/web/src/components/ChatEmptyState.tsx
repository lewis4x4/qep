import { useMemo } from "react";
import { BRAND_NAME, BrandLogo } from "@/components/BrandLogo";
import type { UserRole } from "@/lib/database.types";

interface ChatEmptyStateProps {
  userRole: UserRole;
  onSuggestionClick: (text: string) => void;
}

const REP_SUGGESTIONS = [
  "What deals are closing this week?",
  "Show me my pipeline summary",
  "What financing options do we offer?",
  "Barko 595B specifications",
  "How do I submit a warranty claim?",
  "What competitor listings are there for CAT excavators?",
  "What manufacturer incentives are active right now?",
  "Tell me about my recent activities",
];

const MANAGER_SUGGESTIONS = [
  "Show me the full pipeline summary",
  "Which deals need follow-up this week?",
  "What's the team's activity trend?",
  "What competitor pricing are we seeing for loaders?",
  "Who are our highest-value contacts?",
  "What equipment do we have available for rent?",
  "Show me recent voice notes from the team",
  "What manufacturer incentives can we leverage?",
];

const ADMIN_OWNER_SUGGESTIONS = [
  "Give me a pipeline summary for the next 30 days",
  "What's our equipment utilization look like?",
  "Show me chat feedback trends",
  "Which deals are stalling?",
  "What are our best financing rates right now?",
  "Compare our pricing to competitor listings",
  "What's the PTO policy?",
  "What OEM incentive programs are running?",
];

const MORNING_SUGGESTIONS = [
  "What's on my plate today?",
  "Which deals need attention this week?",
  "Any new voice notes from the field?",
];

const AFTERNOON_SUGGESTIONS = [
  "Summarize today's activities",
  "What follow-ups am I behind on?",
  "Pipeline check — anything closing soon?",
];

function getSuggestions(role: UserRole): string[] {
  const hour = new Date().getHours();
  const isAM = hour < 12;

  let pool: string[];
  if (role === "owner" || role === "admin") {
    pool = ADMIN_OWNER_SUGGESTIONS;
  } else if (role === "manager") {
    pool = MANAGER_SUGGESTIONS;
  } else {
    pool = REP_SUGGESTIONS;
  }

  const timeSuggestions = isAM ? MORNING_SUGGESTIONS : AFTERNOON_SUGGESTIONS;

  // Pick 1 time-based + 3 role-based (shuffled)
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const timeIdx = Math.floor(Math.random() * timeSuggestions.length);
  return [timeSuggestions[timeIdx], ...shuffled.slice(0, 3)];
}

export function ChatEmptyState({ userRole, onSuggestionClick }: ChatEmptyStateProps) {
  const suggestions = useMemo(() => getSuggestions(userRole), [userRole]);

  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-4 pb-16 px-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/80 p-2 ring-1 ring-border">
        <BrandLogo className="h-full w-full max-h-12 object-contain" decorative />
      </div>
      <div>
        <p className="font-semibold text-foreground">{BRAND_NAME} Assistant</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          Ask me anything about equipment, customers, deals, policies, and market intelligence
        </p>
      </div>
      <div className="flex flex-wrap gap-2 justify-center max-w-lg mt-1">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => onSuggestionClick(suggestion)}
            className="rounded-full border border-white/14 bg-gradient-to-b from-white/[0.12] to-white/[0.03] px-4 py-2 min-h-[44px] text-sm text-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18)] backdrop-blur-md transition-all duration-150 hover:border-qep-orange/55 hover:from-qep-orange/20 hover:to-qep-orange/5 hover:text-qep-orange dark:border-white/12 dark:from-white/[0.08] dark:to-white/[0.02]"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
