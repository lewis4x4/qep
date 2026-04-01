import { useMemo, useState, useEffect, useCallback } from "react";
import { BRAND_NAME, BrandLogo } from "@/components/BrandLogo";
import { supabase } from "@/lib/supabase";
import type { UserRole } from "@/lib/database.types";
import { X, Sparkles, Loader2 } from "lucide-react";

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

  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const timeIdx = Math.floor(Math.random() * timeSuggestions.length);
  return [timeSuggestions[timeIdx], ...shuffled.slice(0, 3)];
}

interface BriefingData {
  content: string;
  data: Record<string, unknown>;
  briefing_date: string;
}

function MorningBriefingCard() {
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [generating, setGenerating] = useState(false);

  const loadBriefing = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const today = new Date().toISOString().split("T")[0];
    const { data } = await db
      .from("morning_briefings")
      .select("content, data, briefing_date")
      .eq("briefing_date", today)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setBriefing(data as BriefingData | null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadBriefing();
  }, [loadBriefing]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/morning-briefing`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: "{}",
      });
      await loadBriefing();
    } catch {
      // silently fail
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return null;
  if (dismissed) return null;

  if (!briefing) {
    return (
      <div className="max-w-2xl mx-auto mb-4 w-full">
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 bg-white/5 px-4 py-3 text-sm text-muted-foreground hover:border-qep-orange/40 hover:text-qep-orange transition-colors"
        >
          {generating ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Generating your briefing...</>
          ) : (
            <><Sparkles className="h-4 w-4" /> Generate today&apos;s morning briefing</>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto mb-4 w-full">
      <div className="rounded-lg border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-4 relative">
        <button
          onClick={() => setDismissed(true)}
          className="absolute top-2 right-2 p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Dismiss briefing"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-qep-orange" />
          <span className="text-sm font-semibold text-foreground">Morning Briefing</span>
          <span className="text-xs text-muted-foreground">
            {new Date(briefing.briefing_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
          </span>
        </div>
        <div className="prose prose-sm prose-invert max-w-none text-foreground/90 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_p]:text-sm [&_li]:text-sm [&_strong]:text-foreground">
          <div dangerouslySetInnerHTML={{ __html: briefing.content.replace(/\n/g, "<br/>") }} />
        </div>
      </div>
    </div>
  );
}

export function ChatEmptyState({ userRole, onSuggestionClick }: ChatEmptyStateProps) {
  const suggestions = useMemo(() => getSuggestions(userRole), [userRole]);

  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-4 pb-16 px-4">
      <MorningBriefingCard />

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
