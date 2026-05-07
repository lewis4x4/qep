import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock3, Loader2, Search, ShieldAlert, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  assignQuoteAvailabilityRequest,
  getQuoteAvailabilitySummary,
  listQuoteAvailabilityQueue,
  overrideQuoteAvailabilityRequest,
  respondToQuoteAvailabilityRequest,
  type QuoteAvailabilityCandidate,
  type QuoteAvailabilityRequest,
} from "@/features/quote-builder/lib/quote-api";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  checking_internal_inventory: "Checking inventory",
  checking_vendor: "Checking vendor",
  available: "Available",
  available_with_conditions: "Available w/ conditions",
  alternative_recommended: "Alternative recommended",
  not_available: "Not available",
  cancelled: "Cancelled",
};

const RESPONSE_OPTIONS = [
  { value: "checking_internal_inventory", label: "Checking internal inventory" },
  { value: "checking_vendor", label: "Checking vendor" },
  { value: "available", label: "Confirm available" },
  { value: "available_with_conditions", label: "Available with conditions" },
  { value: "alternative_recommended", label: "Recommend alternative" },
  { value: "not_available", label: "Not available" },
];

function money(value: unknown): string {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? `$${amount.toLocaleString()}` : "$0";
}

function text(value: unknown, fallback = "—"): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function statusTone(status: string): string {
  if (status === "available" || status === "available_with_conditions") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (status === "not_available" || status === "alternative_recommended") return "border-red-500/30 bg-red-500/10 text-red-200";
  if (status === "checking_vendor" || status === "checking_internal_inventory") return "border-blue-500/30 bg-blue-500/10 text-blue-200";
  return "border-amber-500/30 bg-amber-500/10 text-amber-200";
}

function candidateLabel(candidate: QuoteAvailabilityCandidate): string {
  const model = candidate.model;
  const equipment = candidate.equipment;
  return text(
    candidate.customerSafeLabel
      ?? model?.name_display
      ?? model?.model_code
      ?? equipment?.name
      ?? [equipment?.make, equipment?.model].filter(Boolean).join(" "),
    candidate.candidateType.split("_").join(" "),
  );
}

function RequestCard({ request, selected, onSelect }: { request: QuoteAvailabilityRequest; selected: boolean; onSelect: () => void }) {
  const quote = request.quote ?? {};
  const overdue = request.slaDueAt ? Date.parse(request.slaDueAt) < Date.now() : false;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-2xl border p-4 text-left transition ${
        selected ? "border-qep-orange bg-qep-orange/10" : "border-white/10 bg-white/[0.03] hover:border-qep-orange/50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{request.requestedMachineLabel}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {text(quote.quote_number, "Unsaved quote")} · {text(quote.customer_company ?? quote.customer_name, "No customer")}
          </p>
        </div>
        <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${statusTone(request.status)}`}>
          {STATUS_LABELS[request.status] ?? request.status}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
        <span>Urgency: <b className="text-foreground">{request.urgency.split("_").join(" ")}</b></span>
        <span>Value: <b className="text-foreground">{money(quote.net_total ?? request.requestedBudget)}</b></span>
        <span className={overdue ? "text-red-300" : ""}>SLA: <b>{request.slaDueAt ? new Date(request.slaDueAt).toLocaleString() : "—"}</b></span>
      </div>
      <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{request.customerNeed ?? request.repVisibilityNote ?? "No customer need captured."}</p>
      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Owner: {request.assignedToName ?? "Unassigned"}</span>
        <span>{request.candidates.length} candidates · {request.events.length} events</span>
      </div>
    </button>
  );
}

function DecisionPanel({ request }: { request: QuoteAvailabilityRequest }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("checking_internal_inventory");
  const [note, setNote] = useState("");
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [eta, setEta] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["ops", "quote-availability"] }),
      queryClient.invalidateQueries({ queryKey: ["quote-builder", "availability-requests"] }),
    ]);
  };

  const assignMutation = useMutation({
    mutationFn: () => assignQuoteAvailabilityRequest(request.id, "me"),
    onSuccess: refresh,
  });
  const respondMutation = useMutation({
    mutationFn: () => respondToQuoteAvailabilityRequest({
      requestId: request.id,
      status,
      note,
      selectedCandidateId: selectedCandidateId || null,
      availabilityEta: eta || null,
      repVisibilityNote: note || null,
      customerSafeSummary: note || null,
    }),
    onSuccess: async () => {
      setNote("");
      setEta("");
      await refresh();
    },
  });
  const overrideMutation = useMutation({
    mutationFn: () => overrideQuoteAvailabilityRequest({ requestId: request.id, reason: overrideReason }),
    onSuccess: async () => {
      setOverrideReason("");
      await refresh();
    },
  });

  return (
    <Card className="rounded-2xl border-white/10 bg-black/10 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Decision controls</h2>
          <p className="text-xs text-muted-foreground">Every action writes an availability timeline event.</p>
        </div>
        <Button variant="outline" onClick={() => assignMutation.mutate()} disabled={assignMutation.isPending}>
          {assignMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserCheck className="mr-2 h-4 w-4" />}
          Assign to me
        </Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[220px_1fr]">
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-foreground">
          {RESPONSE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select value={selectedCandidateId} onChange={(event) => setSelectedCandidateId(event.target.value)} className="rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-foreground">
          <option value="">No candidate selected</option>
          {request.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidateLabel(candidate)}</option>)}
        </select>
      </div>
      <input
        value={eta}
        onChange={(event) => setEta(event.target.value)}
        placeholder="ETA, vendor promise, or condition (optional)"
        className="mt-3 w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
      />
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Decision note visible to the rep. Required for conditions, alternatives, or unavailable decisions."
        className="mt-3 min-h-24 w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
      />
      <Button className="mt-3" onClick={() => respondMutation.mutate()} disabled={respondMutation.isPending}>
        {respondMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
        Save decision
      </Button>

      <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/5 p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-red-200">
          <ShieldAlert className="h-4 w-4" /> Manager override
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Only use when the customer-facing quote must go out with availability risk recorded.</p>
        <textarea
          value={overrideReason}
          onChange={(event) => setOverrideReason(event.target.value)}
          placeholder="Required override reason"
          className="mt-3 min-h-20 w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
        <Button variant="destructive" className="mt-3" onClick={() => overrideMutation.mutate()} disabled={overrideMutation.isPending || !overrideReason.trim()}>
          {overrideMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <AlertTriangle className="mr-2 h-4 w-4" />}
          Record override
        </Button>
      </div>
    </Card>
  );
}

function RequestDetail({ request }: { request: QuoteAvailabilityRequest }) {
  return (
    <div className="space-y-4">
      <Card className="rounded-2xl border-white/10 bg-black/10 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-qep-orange">Availability request</p>
            <h1 className="mt-1 text-2xl font-semibold text-foreground">{request.requestedMachineLabel}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{request.customerNeed ?? "No need summary captured."}</p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(request.status)}`}>{STATUS_LABELS[request.status] ?? request.status}</span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm"><p className="text-xs text-muted-foreground">Budget</p><b>{money(request.requestedBudget)}</b></div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm"><p className="text-xs text-muted-foreground">Timeline</p><b>{request.requestedTimeline ?? "—"}</b></div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm"><p className="text-xs text-muted-foreground">Owner</p><b>{request.assignedToName ?? "Unassigned"}</b></div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm"><p className="text-xs text-muted-foreground">SLA</p><b>{request.slaDueAt ? new Date(request.slaDueAt).toLocaleString() : "—"}</b></div>
        </div>
        {request.managerOverrideAt && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
            Override recorded: {request.managerOverrideReason ?? "No reason captured"}
          </div>
        )}
      </Card>

      <DecisionPanel request={request} />

      <Card className="rounded-2xl border-white/10 bg-black/10 p-4">
        <h2 className="text-base font-semibold text-foreground">Candidates</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {request.candidates.length === 0 && <p className="text-sm text-muted-foreground">No candidates yet.</p>}
          {request.candidates.map((candidate) => (
            <div key={candidate.id} className={`rounded-xl border p-3 ${candidate.selectedAt ? "border-emerald-500/40 bg-emerald-500/10" : "border-white/10 bg-white/[0.03]"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{candidateLabel(candidate)}</p>
                  <p className="text-xs text-muted-foreground">{candidate.candidateType.split("_").join(" ")} · score {candidate.score}</p>
                </div>
                {candidate.selectedAt && <span className="rounded-full bg-emerald-500/20 px-2 py-1 text-[10px] text-emerald-200">Selected</span>}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{candidate.reason ?? "No reason captured."}</p>
              <p className="mt-2 text-xs text-muted-foreground">ETA: {candidate.etaDays != null ? `${candidate.etaDays} days` : "—"} · Cost: {money(candidate.estimatedCost)}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="rounded-2xl border-white/10 bg-black/10 p-4">
        <h2 className="text-base font-semibold text-foreground">Timeline</h2>
        <div className="mt-3 space-y-3">
          {request.events.length === 0 && <p className="text-sm text-muted-foreground">No events recorded yet.</p>}
          {request.events.map((event) => (
            <div key={event.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="font-semibold uppercase tracking-[0.16em] text-qep-orange">{event.eventType.split("_").join(" ")}</span>
                <span>{event.createdAt ? new Date(event.createdAt).toLocaleString() : "—"}</span>
              </div>
              <p className="mt-2 text-sm text-foreground">{event.note ?? `${event.fromStatus ?? ""} → ${event.toStatus ?? ""}`}</p>
              <p className="mt-1 text-xs text-muted-foreground">{event.actorName ?? "System"}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function QuoteAvailabilityQueuePage() {
  const [status, setStatus] = useState("open");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const queueQuery = useQuery({
    queryKey: ["ops", "quote-availability", { status, search }],
    queryFn: () => listQuoteAvailabilityQueue({ status, search }),
    staleTime: 15_000,
  });
  const summaryQuery = useQuery({
    queryKey: ["ops", "quote-availability", "summary"],
    queryFn: getQuoteAvailabilitySummary,
    staleTime: 30_000,
  });

  const requests = queueQuery.data ?? [];
  const selected = useMemo(
    () => requests.find((request) => request.id === selectedId) ?? requests[0] ?? null,
    [requests, selectedId],
  );

  return (
    <div className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-qep-orange">Sales ops</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">Quote Availability Queue</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Resolve sourcing requests before quotes promise equipment that has not been confirmed.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="rounded-2xl border-white/10 bg-white/[0.03] p-4"><p className="text-xs text-muted-foreground">Open</p><b className="text-2xl">{summaryQuery.data?.openCount ?? "—"}</b></Card>
            <Card className="rounded-2xl border-white/10 bg-white/[0.03] p-4"><p className="text-xs text-muted-foreground">Overdue</p><b className="text-2xl text-red-300">{summaryQuery.data?.overdueCount ?? "—"}</b></Card>
            <Card className="rounded-2xl border-white/10 bg-white/[0.03] p-4"><p className="text-xs text-muted-foreground">Blocked value</p><b className="text-2xl">{money(summaryQuery.data?.blockedQuoteValue)}</b></Card>
          </div>
        </header>

        <Card className="rounded-2xl border-white/10 bg-black/10 p-4">
          <div className="flex flex-col gap-3 md:flex-row">
            <label className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search quote, customer, equipment, need..."
                className="w-full rounded-xl border border-white/10 bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
              />
            </label>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-foreground">
              <option value="open">Open blockers</option>
              <option value="all">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </Card>

        {queueQuery.isLoading && (
          <Card className="rounded-2xl border-white/10 bg-black/10 p-8 text-center text-muted-foreground">
            <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" /> Loading availability requests...
          </Card>
        )}
        {queueQuery.isError && (
          <Card className="rounded-2xl border-red-500/30 bg-red-500/10 p-4 text-red-100">
            Failed to load availability queue: {queueQuery.error instanceof Error ? queueQuery.error.message : "Unknown error"}
          </Card>
        )}
        {!queueQuery.isLoading && requests.length === 0 && (
          <Card className="rounded-2xl border-white/10 bg-black/10 p-8 text-center text-muted-foreground">
            <Clock3 className="mx-auto mb-3 h-6 w-6" /> No availability requests match this view.
          </Card>
        )}

        {requests.length > 0 && (
          <div className="grid gap-6 lg:grid-cols-[460px_1fr]">
            <div className="space-y-3">
              {requests.map((request) => (
                <RequestCard key={request.id} request={request} selected={selected?.id === request.id} onSelect={() => setSelectedId(request.id)} />
              ))}
            </div>
            {selected && <RequestDetail request={selected} />}
          </div>
        )}
      </div>
    </div>
  );
}
