/**
 * DecisionRoomGhostProposals — web-sourced named candidates for a ghost
 * seat. Fetches from decision-room-ghost-propose on demand (one click per
 * drawer-open), caches per (dealId, archetype) in React Query, and renders
 * each candidate as a card with name + title + LinkedIn link + confidence.
 *
 * Extension hook: each proposal has a profileUrl so the rep can open the
 * LinkedIn page in a new tab; future phases can wire a "Save as CRM
 * contact" action that upserts a crm_contacts row.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, Loader2, Search, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

interface Proposal {
  name: string;
  title: string | null;
  profileUrl: string | null;
  confidence: "high" | "medium" | "low";
  evidence: string;
}

interface Props {
  dealId: string;
  archetype: string;
  companyName: string | null;
}

async function fetchProposals(input: {
  dealId: string;
  archetype: string;
  companyName: string;
}): Promise<{ proposals: Proposal[]; source: "cache" | "fresh" }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/decision-room-ghost-propose`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(input),
    },
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error ?? `ghost-propose returned ${res.status}`);
  return { proposals: payload.proposals ?? [], source: payload.source ?? "fresh" };
}

function confidenceCls(level: Proposal["confidence"]): string {
  switch (level) {
    case "high": return "border-emerald-400/40 bg-emerald-400/10 text-emerald-200";
    case "medium": return "border-amber-400/40 bg-amber-400/10 text-amber-200";
    default: return "border-white/15 bg-white/[0.04] text-white/70";
  }
}

export function DecisionRoomGhostProposals({ dealId, archetype, companyName }: Props) {
  const [fired, setFired] = useState(false);
  const mutation = useMutation({
    mutationFn: () => fetchProposals({ dealId, archetype, companyName: companyName ?? "" }),
  });

  if (!companyName) {
    return (
      <p className="text-xs text-muted-foreground">
        Attach this deal to a company before proposing candidate names.
      </p>
    );
  }

  if (!fired && !mutation.data) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          setFired(true);
          mutation.mutate();
        }}
        className="gap-1.5"
      >
        <Search className="h-3.5 w-3.5" />
        Propose candidates from the web
      </Button>
    );
  }

  if (mutation.isPending) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
        <Loader2 className="h-3 w-3 animate-spin" />
        Searching LinkedIn for likely candidates at {companyName}…
      </p>
    );
  }

  if (mutation.error) {
    return (
      <div role="alert" className="rounded-md border border-red-400/40 bg-red-500/10 p-3 text-xs text-red-200">
        <p>Couldn't reach the web search. {(mutation.error as Error).message}</p>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          className="mt-1 underline hover:text-red-100"
        >
          Retry
        </button>
      </div>
    );
  }

  const proposals = mutation.data?.proposals ?? [];
  if (proposals.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No candidates surfaced for this archetype at {companyName}. The rep's champion is usually the fastest path — ask directly.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>Candidate names</span>
        {mutation.data?.source === "cache" ? (
          <span className="text-[10px] italic">from cache</span>
        ) : null}
      </div>
      <ul className="space-y-2">
        {proposals.map((p, i) => (
          <li
            key={`${p.name}-${i}`}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3",
              confidenceCls(p.confidence),
            )}
          >
            <UserCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{p.name}</p>
              {p.title ? (
                <p className="truncate text-xs text-foreground/80">{p.title}</p>
              ) : null}
              <p className="mt-1 text-[10px] italic text-muted-foreground">{p.evidence}</p>
            </div>
            {p.profileUrl ? (
              <a
                href={p.profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-qep-orange hover:text-orange-300"
                aria-label={`Open LinkedIn profile for ${p.name}`}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-[10px] italic text-muted-foreground">
        Candidates are web-sourced starting points, not verified facts. Confirm with your champion before outreach.
      </p>
    </div>
  );
}
