import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Mail, Send, Trash2, Edit3, Save, X, AlertTriangle, Filter, Copy, ExternalLink,
} from "lucide-react";
import {
  listEmailDrafts,
  updateEmailDraft,
  dismissEmailDraft,
  markEmailDraftSent,
  sendEmailDraft,
  SCENARIO_LABELS,
  SCENARIO_COLORS,
  type EmailDraft,
  type DraftScenario,
} from "../lib/email-drafts-api";

const SCENARIOS: Array<DraftScenario | "all"> = [
  "all", "budget_cycle", "price_increase", "tariff", "requote", "trade_up", "custom",
];

export function EmailDraftInboxPage() {
  const queryClient = useQueryClient();
  const [filterScenario, setFilterScenario] = useState<DraftScenario | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editState, setEditState] = useState<{ id: string; subject: string; body: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: drafts = [], isLoading, isError } = useQuery({
    queryKey: ["email-drafts", "inbox"],
    queryFn: () => listEmailDrafts(["pending", "edited"]),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["email-drafts", "inbox"] });

  const handleActionError = (err: unknown) =>
    setActionError(err instanceof Error ? err.message : "Action failed");

  const saveMutation = useMutation({
    mutationFn: (input: { id: string; subject: string; body: string }) =>
      updateEmailDraft(input.id, { subject: input.subject, body: input.body }),
    onSuccess: () => {
      setEditState(null);
      setActionError(null);
      invalidate();
    },
    onError: handleActionError,
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => dismissEmailDraft(id),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: handleActionError,
  });

  const markSentMutation = useMutation({
    mutationFn: (id: string) => markEmailDraftSent(id, "manual"),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: handleActionError,
  });

  const sendViaMutation = useMutation({
    mutationFn: (id: string) => sendEmailDraft(id),
    onSuccess: (result) => {
      setActionError(null);
      invalidate();
      // Toast handled by the card component
    },
    onError: handleActionError,
  });

  const filtered = useMemo(
    () =>
      filterScenario === "all"
        ? drafts
        : drafts.filter((d) => d.scenario === filterScenario),
    [drafts, filterScenario],
  );

  const scenarioCounts = useMemo(() => {
    const counts: Partial<Record<DraftScenario, number>> = {};
    for (const d of drafts) counts[d.scenario] = (counts[d.scenario] ?? 0) + 1;
    return counts;
  }, [drafts]);

  const urgentCount = drafts.filter((d) => (d.urgency_score ?? 0) >= 0.8).length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-qep-orange" aria-hidden />
            <h1 className="text-xl font-bold text-foreground">Email Draft Review</h1>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            AI-generated outreach drafts. Nothing sends automatically — review, edit, and mark sent when you use them.
          </p>
        </div>
      </div>

      {actionError && (
        <Card className="border-red-500/30 bg-red-500/5 p-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-red-400">{actionError}</p>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
        </Card>
      )}

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryTile label="Pending" value={drafts.length} color="text-blue-400" />
        <SummaryTile label="Urgent (≥80%)" value={urgentCount} color="text-red-400" icon={<AlertTriangle className="h-3 w-3" />} />
        <SummaryTile label="Scenarios" value={Object.keys(scenarioCounts).length} color="text-violet-400" />
        <SummaryTile label="Last refresh" value={new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} color="text-muted-foreground" />
      </div>

      {/* Scenario filter */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-3 w-3 text-muted-foreground" aria-hidden />
        {SCENARIOS.map((s) => {
          const count = s === "all" ? drafts.length : (scenarioCounts[s as DraftScenario] ?? 0);
          const label = s === "all" ? "All" : SCENARIO_LABELS[s as DraftScenario];
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilterScenario(s)}
              className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                filterScenario === s
                  ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
                  : "border-border text-muted-foreground hover:border-foreground/20"
              }`}
            >
              {label} ({count})
            </button>
          );
        })}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-32 animate-pulse" />)}
        </div>
      )}

      {/* Error */}
      {isError && (
        <Card className="border-red-500/20 p-6 text-center">
          <p className="text-sm text-red-400">Failed to load drafts.</p>
        </Card>
      )}

      {/* Empty */}
      {!isLoading && !isError && filtered.length === 0 && (
        <Card className="border-dashed p-8 text-center">
          <Mail className="mx-auto h-8 w-8 text-muted-foreground mb-2" aria-hidden />
          <p className="text-sm text-muted-foreground">
            No drafts waiting for review. New drafts appear here when the system detects a budget cycle, price increase, tariff, or trade-up opportunity.
          </p>
        </Card>
      )}

      {/* Draft list */}
      {!isLoading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((draft) => {
            const isExpanded = expandedId === draft.id;
            const isEditing = editState?.id === draft.id;
            return (
              <DraftCard
                key={draft.id}
                draft={draft}
                isExpanded={isExpanded}
                isEditing={isEditing}
                editState={isEditing ? editState : null}
                onToggle={() => {
                  if (isEditing) return;
                  setExpandedId(isExpanded ? null : draft.id);
                }}
                onStartEdit={() => {
                  setExpandedId(draft.id);
                  setEditState({ id: draft.id, subject: draft.subject, body: draft.body });
                }}
                onEditChange={(patch) => setEditState((s) => (s ? { ...s, ...patch } : s))}
                onCancelEdit={() => setEditState(null)}
                onSave={() => editState && saveMutation.mutate(editState)}
                onDismiss={() => dismissMutation.mutate(draft.id)}
                onMarkSent={() => markSentMutation.mutate(draft.id)}
                onSendEmail={() => sendViaMutation.mutate(draft.id)}
                isSaving={saveMutation.isPending}
                isDismissing={dismissMutation.isPending && dismissMutation.variables === draft.id}
                isSending={markSentMutation.isPending && markSentMutation.variables === draft.id}
                isEmailing={sendViaMutation.isPending && sendViaMutation.variables === draft.id}
                toEmail={draft.to_email}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Subcomponents ───────────────────────────────────────────────── */

function SummaryTile({ label, value, color, icon }: { label: string; value: string | number; color: string; icon?: React.ReactNode }) {
  return (
    <Card className="p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 flex items-center gap-1 text-lg font-bold ${color}`}>
        {icon}
        {value}
      </p>
    </Card>
  );
}

function DraftCard({
  draft, isExpanded, isEditing, editState,
  onToggle, onStartEdit, onEditChange, onCancelEdit, onSave, onDismiss, onMarkSent, onSendEmail,
  isSaving, isDismissing, isSending, isEmailing, toEmail,
}: {
  draft: EmailDraft;
  isExpanded: boolean;
  isEditing: boolean;
  editState: { id: string; subject: string; body: string } | null;
  onToggle: () => void;
  onStartEdit: () => void;
  onEditChange: (patch: Partial<{ subject: string; body: string }>) => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onDismiss: () => void;
  onMarkSent: () => void;
  onSendEmail: () => void;
  isSaving: boolean;
  isDismissing: boolean;
  isSending: boolean;
  isEmailing: boolean;
  toEmail: string | null;
}) {
  const urgency = draft.urgency_score ?? 0;
  const urgencyColor = urgency >= 0.8 ? "text-red-400" : urgency >= 0.5 ? "text-amber-400" : "text-muted-foreground";
  const scenarioColor = SCENARIO_COLORS[draft.scenario];
  const editedBadge = draft.status === "edited";

  const copyBody = () => {
    void navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
  };

  const openMailto = () => {
    const subject = encodeURIComponent(draft.subject);
    const body = encodeURIComponent(draft.body);
    window.open(`mailto:?subject=${subject}&body=${body}`, "_blank");
  };

  return (
    <Card className={`p-4 ${urgency >= 0.8 ? "border-red-500/30" : ""}`}>
      <button type="button" onClick={onToggle} className="w-full text-left" disabled={isEditing}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${scenarioColor}`}>
                {SCENARIO_LABELS[draft.scenario]}
              </span>
              {editedBadge && (
                <span className="rounded-full bg-qep-orange/10 px-1.5 py-0.5 text-[9px] font-semibold text-qep-orange">
                  Edited
                </span>
              )}
              <span className={`text-[10px] font-semibold ${urgencyColor}`}>
                {Math.round(urgency * 100)}% urgency
              </span>
              <span className="text-[10px] text-muted-foreground">
                {new Date(draft.created_at).toLocaleString()}
              </span>
            </div>
            <p className="mt-1 text-sm font-semibold text-foreground truncate">{draft.subject}</p>
            {draft.preview && !isExpanded && (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{draft.preview}</p>
            )}
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="mt-3 border-t border-border pt-3">
          {isEditing && editState ? (
            <div className="space-y-2">
              <div>
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Subject</label>
                <input
                  type="text"
                  value={editState.subject}
                  onChange={(e) => onEditChange({ subject: e.target.value })}
                  className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Body</label>
                <textarea
                  value={editState.body}
                  onChange={(e) => onEditChange({ body: e.target.value })}
                  rows={10}
                  className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={onCancelEdit} disabled={isSaving}>
                  <X className="mr-1 h-3 w-3" /> Cancel
                </Button>
                <Button size="sm" onClick={onSave} disabled={isSaving}>
                  <Save className="mr-1 h-3 w-3" />
                  {isSaving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-md bg-muted/30 p-3">
                <pre className="whitespace-pre-wrap break-words font-sans text-xs text-foreground">{draft.body}</pre>
              </div>

              {/* Context facts — audit trail */}
              {Object.keys(draft.context ?? {}).length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground">
                    Source facts ({Object.keys(draft.context).length})
                  </summary>
                  <pre className="mt-1 overflow-x-auto rounded-md bg-muted/20 p-2 text-[10px] text-muted-foreground">
                    {JSON.stringify(draft.context, null, 2)}
                  </pre>
                </details>
              )}

              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={onDismiss} disabled={isDismissing}>
                  <Trash2 className="mr-1 h-3 w-3" />
                  {isDismissing ? "Dismissing…" : "Dismiss"}
                </Button>
                <Button size="sm" variant="outline" onClick={onStartEdit}>
                  <Edit3 className="mr-1 h-3 w-3" /> Edit
                </Button>
                <Button size="sm" variant="outline" onClick={copyBody}>
                  <Copy className="mr-1 h-3 w-3" /> Copy
                </Button>
                <Button size="sm" variant="outline" onClick={openMailto}>
                  <ExternalLink className="mr-1 h-3 w-3" /> Open in mail
                </Button>
                {toEmail && (
                  <Button size="sm" onClick={onSendEmail} disabled={isEmailing || isSending}>
                    <Send className="mr-1 h-3 w-3" />
                    {isEmailing ? "Sending…" : `Send to ${toEmail}`}
                  </Button>
                )}
                <Button size="sm" variant={toEmail ? "outline" : "default"} onClick={onMarkSent} disabled={isSending || isEmailing}>
                  {isSending ? "Marking…" : "Mark sent"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
