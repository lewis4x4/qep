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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, FileSignature, Loader2, Mic, Search, UserCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

interface Proposal {
  name: string;
  title: string | null;
  profileUrl: string | null;
  confidence: "high" | "medium" | "low";
  evidence: string;
  /** Why this proposal is weak (only present on low-confidence cards).
   *  Surfaced in the save-confirm guardrail. Optional for backward-compat
   *  with cached proposals written before the field existed. */
  mismatchReason?: string | null;
  /** Where the proposal came from. Internal sources (`signer`, `voice`)
   *  are customer-confirmed and bypass the low-confidence guardrail.
   *  `web` = Tavily / LinkedIn. Undefined on cached rows written before
   *  the edge function gained the CRM-first path. */
  source?: "signer" | "voice" | "web";
}

function isInternalSource(p: Proposal): boolean {
  return p.source === "signer" || p.source === "voice";
}

function sourceBadge(p: Proposal): { icon: typeof UserCheck; label: string; cls: string } | null {
  if (p.source === "signer") {
    return {
      icon: FileSignature,
      label: "Past signer",
      cls: "border-cyan-400/40 bg-cyan-400/10 text-cyan-200",
    };
  }
  if (p.source === "voice") {
    return {
      icon: Mic,
      label: "Named on call",
      cls: "border-violet-400/40 bg-violet-400/10 text-violet-200",
    };
  }
  return null;
}

interface Props {
  dealId: string;
  archetype: string;
  companyName: string | null;
  companyId: string | null;
  /** Fired after a candidate is successfully persisted. The parent uses this
   *  to close the drawer so the rep immediately sees the refreshed seat map. */
  onSaved?: () => void;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payloadError(payload: unknown): string | null {
  return isRecord(payload) && typeof payload.error === "string" ? payload.error : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function normalizeConfidence(value: unknown): Proposal["confidence"] {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function normalizeSource(value: unknown): Proposal["source"] {
  return value === "signer" || value === "voice" || value === "web" ? value : undefined;
}

function normalizeProposal(value: unknown): Proposal | null {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim()) return null;
  return {
    name: value.name.trim(),
    title: typeof value.title === "string" && value.title.trim() ? value.title : null,
    profileUrl: typeof value.profileUrl === "string" && value.profileUrl.trim() ? value.profileUrl : null,
    confidence: normalizeConfidence(value.confidence),
    evidence: typeof value.evidence === "string" ? value.evidence : "",
    mismatchReason: typeof value.mismatchReason === "string" ? value.mismatchReason : null,
    source: normalizeSource(value.source),
  };
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
  const payload: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payloadError(payload) ?? `ghost-propose returned ${res.status}`);
  const proposals = isRecord(payload) && Array.isArray(payload.proposals)
    ? payload.proposals
        .map(normalizeProposal)
        .filter((proposal): proposal is Proposal => proposal !== null)
    : [];
  return {
    proposals,
    source: isRecord(payload) && payload.source === "cache" ? "cache" : "fresh",
  };
}

function confidenceCls(level: Proposal["confidence"]): string {
  switch (level) {
    case "high": return "border-emerald-400/40 bg-emerald-400/10 text-emerald-200";
    case "medium": return "border-amber-400/40 bg-amber-400/10 text-amber-200";
    default: return "border-white/15 bg-white/[0.04] text-white/70";
  }
}

export function DecisionRoomGhostProposals({ dealId, archetype, companyName, companyId, onSaved }: Props) {
  const [fired, setFired] = useState(false);
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set());
  const [savingName, setSavingName] = useState<string | null>(null);
  /** Low-confidence candidates are hidden by default — the rep opts in to see them. */
  const [showWeaker, setShowWeaker] = useState(false);
  /** Name of the low-confidence proposal currently awaiting save-confirm, or null. */
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => fetchProposals({ dealId, archetype, companyName: companyName ?? "" }),
  });

  async function handleSaveContact(proposal: Proposal) {
    if (!companyId || savingName) return;
    setSavingName(proposal.name);
    try {
      // Pull the caller's user id so reps can insert under their own scope
      // (the rep-insert RLS policy requires assigned_rep_id = auth.uid()).
      const { data: { user } } = await supabase.auth.getUser();
      const { firstName, lastName } = splitName(proposal.name);
      // Pin the new contact directly to the archetype slot they were
      // proposed for. Without this, a voice-mentioned Sarah Chen saved
      // for the Economic Buyer seat falls through to Champion (the
      // no-title default), which is silently wrong. The override wins
      // over title inference in inferArchetypeForContact.
      const { error } = await supabase.from("crm_contacts").insert({
        first_name: firstName || proposal.name,
        last_name: lastName || "(unknown)",
        title: proposal.title,
        primary_company_id: companyId,
        assigned_rep_id: user?.id ?? null,
        metadata: {
          decision_room_source: {
            archetype,
            profile_url: proposal.profileUrl,
            confidence: proposal.confidence,
            evidence: proposal.evidence,
            deal_id: dealId,
          },
          decision_room_override: {
            archetype,
            set_at: new Date().toISOString(),
            set_by: "ghost_propose_save",
          },
        },
      });
      if (error) throw error;

      setSavedNames((prev) => new Set([...prev, proposal.name]));
      toast({
        title: "Saved as contact",
        description: `${proposal.name} added to this company. Decision room is refreshing.`,
      });
      // Force the downstream queries to refetch. `refetchType: "active"`
      // ensures the seat map on the page re-reads contacts even though the
      // drawer is on top. We also nudge composite in case downstream views
      // key off the same cache entry.
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["decision-room-simulator", dealId, "relationship"],
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: ["decision-room-simulator", dealId, "composite"],
          refetchType: "active",
        }),
      ]);
      // Close the drawer so the rep sees the seat flip ghost → named without
      // having to back out manually.
      onSaved?.();
    } catch (err) {
      toast({
        title: "Couldn't save contact",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSavingName(null);
    }
  }

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
        <p>Couldn't reach the web search. {errorMessage(mutation.error)}</p>
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

  // Split: internal (past signers + voice mentions — always trustworthy),
  // strong web matches (high + medium confidence), and weak web matches.
  // Weak web candidates almost always reference the wrong company — we
  // hide those behind an explicit opt-in so the default view stays honest.
  // Internal candidates bypass the weak-match rules entirely because the
  // rep's own team surfaced them.
  const internalProposals = proposals.filter(isInternalSource);
  const webProposals = proposals.filter((p) => !isInternalSource(p));
  const strongProposals = webProposals.filter((p) => p.confidence !== "low");
  const weakProposals = webProposals.filter((p) => p.confidence === "low");

  const renderCard = (p: Proposal, key: string) => {
    const saved = savedNames.has(p.name);
    const savingThis = savingName === p.name;
    // Internal sources never need the low-confidence guardrail — the
    // customer's own team surfaced them. A "low" internal rating would
    // only occur through a cache glitch, so treat internal as non-weak.
    const isInternal = isInternalSource(p);
    const isLow = !isInternal && p.confidence === "low";
    const awaitingConfirm = confirmName === p.name;
    const badge = sourceBadge(p);
    const BadgeIcon = badge?.icon ?? null;
    return (
      <li
        key={key}
        className={cn(
          "flex flex-col gap-2 rounded-lg border p-3",
          isInternal && badge ? badge.cls : confidenceCls(p.confidence),
        )}
      >
        {isInternal && badge && BadgeIcon ? (
          <span className="inline-flex w-fit items-center gap-1 rounded-full border border-current/30 bg-current/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider">
            <BadgeIcon className="h-2.5 w-2.5" aria-hidden />
            {badge.label}
          </span>
        ) : null}
        <div className="flex items-start gap-3">
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
        </div>
        {companyId ? (
          saved ? (
            <div className="flex justify-end">
              <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Saved to CRM
              </span>
            </div>
          ) : awaitingConfirm ? (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-md border border-amber-400/40 bg-amber-400/10 p-2 text-[11px] text-amber-100"
            >
              <div className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <p>
                  <span className="font-semibold">Weak match.</span>{" "}
                  {p.mismatchReason ?? `Could not confirm "${companyName}" on this profile.`} Save anyway?
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmName(null)}
                  className="h-7 text-[11px]"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={savingThis}
                  onClick={() => {
                    setConfirmName(null);
                    void handleSaveContact(p);
                  }}
                  className="h-7 gap-1 text-[11px]"
                >
                  {savingThis ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save anyway"
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={savingThis}
                onClick={() => {
                  // Low-confidence saves route through an inline confirm
                  // so the rep sees *why* the match is weak before creating
                  // a CRM contact they might not mean to.
                  if (isLow) setConfirmName(p.name);
                  else void handleSaveContact(p);
                }}
                className="h-7 gap-1 text-[11px]"
              >
                {savingThis ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <UserPlus className="h-3 w-3" />
                    Save as contact
                  </>
                )}
              </Button>
            </div>
          )
        ) : null}
      </li>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>Candidate names</span>
        {mutation.data?.source === "cache" ? (
          <span className="text-[10px] italic">from cache</span>
        ) : null}
      </div>

      {/* Internal candidates first — past signers and voice-capture mentions.
          These come from the rep's own workspace, so we trust them absolutely
          and skip the weak-match guardrail. */}
      {internalProposals.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-emerald-300/80">
            From your CRM
          </p>
          <ul className="space-y-2">
            {internalProposals.map((p, i) => renderCard(p, `internal-${p.name}-${i}`))}
          </ul>
        </div>
      ) : null}

      {/* Web-sourced candidates — strong matches first, weak hidden. */}
      {strongProposals.length > 0 ? (
        <div className={cn("space-y-2", internalProposals.length > 0 && "pt-2")}>
          {internalProposals.length > 0 ? (
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              From the web
            </p>
          ) : null}
          <ul className="space-y-2">
            {strongProposals.map((p, i) => renderCard(p, `strong-${p.name}-${i}`))}
          </ul>
        </div>
      ) : internalProposals.length === 0 ? (
        <p className="rounded-md border border-white/10 bg-white/[0.02] p-3 text-xs text-muted-foreground">
          No strong matches for {companyName}. The web search returned only partial-company hits, which are usually wrong-company false positives. Ask your champion directly or expand weaker candidates below.
        </p>
      ) : null}

      {weakProposals.length > 0 ? (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowWeaker((v) => !v)}
            aria-expanded={showWeaker}
            className="flex w-full items-center justify-between rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5 text-[11px] text-muted-foreground transition hover:bg-white/[0.04]"
          >
            <span>
              {showWeaker ? "Hide" : "Show"} {weakProposals.length} weaker candidate
              {weakProposals.length === 1 ? "" : "s"}
            </span>
            {showWeaker ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
          {showWeaker ? (
            <ul className="mt-2 space-y-2">
              {weakProposals.map((p, i) => renderCard(p, `weak-${p.name}-${i}`))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <p className="text-[10px] italic text-muted-foreground">
        Candidates are web-sourced starting points, not verified facts. Confirm with your champion before outreach.
      </p>
    </div>
  );
}
