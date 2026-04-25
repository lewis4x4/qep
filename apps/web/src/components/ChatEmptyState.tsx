import { useMemo } from "react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  Building2,
  DollarSign,
  Sparkles,
  Wrench,
} from "lucide-react";
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

interface CapabilityTile {
  label: string;
  hint: string;
  icon: typeof Wrench;
}

const CAPABILITY_TILES: CapabilityTile[] = [
  { label: "Pipeline", hint: "Open deals, forecast, follow-ups", icon: Activity },
  { label: "Equipment specs", hint: "Models, attachments, serials", icon: Wrench },
  { label: "Financing & incentives", hint: "Rates, OEM programs", icon: DollarSign },
  { label: "Customer intel", hint: "Companies, contacts, history", icon: Building2 },
  { label: "Policies & process", hint: "Warranty, PTO, SOPs", icon: BookOpen },
  { label: "Field signals", hint: "Voice notes, recent activity", icon: Sparkles },
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
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const timeIdx = Math.floor(Math.random() * timeSuggestions.length);
  return [timeSuggestions[timeIdx], ...shuffled.slice(0, 5)];
}

export function ChatEmptyState({ userRole, onSuggestionClick }: ChatEmptyStateProps) {
  const suggestions = useMemo(() => getSuggestions(userRole), [userRole]);

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center gap-6 px-4 py-10">
      {/* Hero */}
      <header className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-[#f28a07]/35 bg-gradient-to-br from-[#f28a07]/20 via-black/40 to-black/80 p-3 shadow-[0_18px_60px_-30px_rgba(242,138,7,0.4)]">
          <BrandLogo className="h-full w-full max-h-12 object-contain" decorative />
        </div>
        <div>
          <p className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {BRAND_NAME} Assistant
          </p>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Grounded in your equipment catalog, customer history, deal pipeline, and policies — ask anything.
          </p>
        </div>
      </header>

      {/* Capability tiles */}
      <section
        aria-label="What you can ask about"
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
      >
        {CAPABILITY_TILES.map((tile) => {
          const Icon = tile.icon;
          return (
            <div
              key={tile.label}
              className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-left"
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f28a07]/10 text-[#f6a53a]">
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-foreground">{tile.label}</p>
                <p className="text-[11px] text-muted-foreground">{tile.hint}</p>
              </div>
            </div>
          );
        })}
      </section>

      {/* Starter prompts */}
      <section aria-label="Suggested prompts">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Try one of these
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onSuggestionClick(suggestion)}
              className="group flex items-center justify-between gap-3 rounded-xl border border-white/12 bg-gradient-to-b from-white/[0.06] to-white/[0.01] px-4 py-3 text-left text-sm text-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] backdrop-blur-md transition-all duration-150 hover:border-[#f28a07]/45 hover:from-[#f28a07]/10 hover:to-[#f28a07]/[0.02] hover:text-[#f6a53a]"
            >
              <span className="min-w-0 truncate">{suggestion}</span>
              <ArrowRight
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-[#f6a53a]"
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      </section>

      <p className="text-center text-[11px] text-muted-foreground">
        Or start typing below — Enter to send · Shift+Enter for a new line.
      </p>
    </div>
  );
}
