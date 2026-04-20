/**
 * PulseSurface — the "what changed" surface in the 4-surface shell.
 *
 * Where Today is "what should I do next?", Pulse answers "what happened?".
 * It's the raw event stream of everything the system noticed: emails in,
 * faults on machines, SLA warnings, competitive mentions, news hits. Each
 * row links to the entity it belongs to so an operator can jump straight
 * into the Graph.
 *
 * This component is feature-flagged via shell_v2 and rendered on
 * /qrm/exceptions when the flag is on. Legacy ExceptionHandlingPage is
 * preserved behind the flag.
 *
 * Data contract:
 *   - Pulls signals from /qrm/signals (workspace-scoped via RLS).
 *   - Client-side severity / kind / entity-type filters.
 *   - Read-only surface; "act on this" is a one-click jump to the entity.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Radio,
  AlertTriangle,
  Mail,
  Newspaper,
  Phone,
  Wrench,
  Users,
  DollarSign,
  Clock,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listQrmSignals,
  type QrmSignal,
  type QrmSignalKind,
  type QrmSignalSeverity,
} from "../lib/qrm-router-api";
import {
  hrefForSignalEntity,
  labelForSignalKind,
  relativeTimeLabel,
  severityDotClass,
  severityTextClass,
} from "./signalCardHelpers";

interface PulseSurfaceProps {
  className?: string;
}

type SeverityFloor = "all" | QrmSignalSeverity;

const SEVERITY_ORDER: Record<QrmSignalSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const SEVERITY_CHIPS: Array<{ id: SeverityFloor; label: string }> = [
  { id: "all", label: "All" },
  { id: "medium", label: "Medium+" },
  { id: "high", label: "High+" },
  { id: "critical", label: "Critical" },
];

// Grouped kind families — each chip maps to a set of kinds. A single kind
// can belong to exactly one family so the filter stays disjoint.
const KIND_FAMILIES: Array<{
  id: string;
  label: string;
  kinds: QrmSignalKind[];
}> = [
  { id: "all", label: "All", kinds: [] }, // empty = don't filter
  {
    id: "ops",
    label: "Ops",
    kinds: ["sla_breach", "sla_warning", "stage_change", "deposit_received"],
  },
  {
    id: "inbound",
    label: "Inbound",
    kinds: ["inbound_email", "inbound_call", "inbound_sms"],
  },
  {
    id: "fleet",
    label: "Fleet",
    kinds: [
      "telematics_fault",
      "telematics_idle",
      "equipment_available",
      "equipment_returning",
      "service_due",
      "warranty_expiring",
    ],
  },
  {
    id: "quotes",
    label: "Quotes",
    kinds: [
      "quote_viewed",
      "quote_expiring",
      "credit_approved",
      "credit_declined",
    ],
  },
  {
    id: "market",
    label: "Market",
    kinds: [
      "permit_filed",
      "auction_listing",
      "competitor_mention",
      "news_mention",
    ],
  },
];

function iconForKind(kind: QrmSignalKind) {
  switch (kind) {
    case "sla_breach":
    case "sla_warning":
      return AlertTriangle;
    case "inbound_email":
      return Mail;
    case "inbound_call":
    case "inbound_sms":
      return Phone;
    case "telematics_fault":
    case "telematics_idle":
    case "service_due":
    case "warranty_expiring":
    case "equipment_available":
    case "equipment_returning":
      return Wrench;
    case "news_mention":
    case "competitor_mention":
    case "permit_filed":
    case "auction_listing":
      return Newspaper;
    case "quote_viewed":
    case "quote_expiring":
    case "deposit_received":
    case "credit_approved":
    case "credit_declined":
      return DollarSign;
    case "stage_change":
      return Zap;
    default:
      return Radio;
  }
}

export function PulseSurface({ className }: PulseSurfaceProps) {
  const [severityFloor, setSeverityFloor] = useState<SeverityFloor>("all");
  const [familyId, setFamilyId] = useState<string>("all");

  const signalsQuery = useQuery<QrmSignal[]>({
    queryKey: ["qrm", "pulse-signals"],
    queryFn: () =>
      listQrmSignals({
        // Pull broadly; we filter client-side so chip swaps are instant and
        // the back-end query stays cached by react-query.
        limit: 200,
      }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const signals = signalsQuery.data ?? [];

  const filtered = useMemo(() => {
    let next = signals;
    if (severityFloor !== "all") {
      const floor = SEVERITY_ORDER[severityFloor];
      next = next.filter((s) => SEVERITY_ORDER[s.severity] >= floor);
    }
    if (familyId !== "all") {
      const family = KIND_FAMILIES.find((f) => f.id === familyId);
      if (family && family.kinds.length > 0) {
        const set = new Set<QrmSignalKind>(family.kinds);
        next = next.filter((s) => set.has(s.kind));
      }
    }
    return next;
  }, [signals, severityFloor, familyId]);

  const nowMs = Date.now();

  return (
    <div
      className={cn("mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6", className)}
    >
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">Pulse</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Every event the system noticed — SLA, fleet, inbound, market, quote
          activity. Tap a row to jump to the entity.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-4">
        <ChipRow
          ariaLabel="Severity floor"
          items={SEVERITY_CHIPS}
          activeId={severityFloor}
          onSelect={(id) => setSeverityFloor(id as SeverityFloor)}
        />
        <div className="h-4 w-px bg-border" aria-hidden />
        <ChipRow
          ariaLabel="Signal family"
          items={KIND_FAMILIES.map(({ id, label }) => ({ id, label }))}
          activeId={familyId}
          onSelect={setFamilyId}
        />
        <div className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {signals.length} signals
        </div>
      </div>

      {signalsQuery.isLoading && (
        <EmptyState
          title="Loading your pulse…"
          body="Pulling the recent signal feed."
        />
      )}

      {signalsQuery.isError && (
        <EmptyState
          title="Couldn't load Pulse"
          body={
            signalsQuery.error instanceof Error
              ? signalsQuery.error.message
              : "Something went wrong reaching the signal feed."
          }
        />
      )}

      {!signalsQuery.isLoading && !signalsQuery.isError && filtered.length === 0 && (
        <EmptyState
          title="Nothing matches this filter."
          body={
            signals.length === 0
              ? "No signals have arrived yet. The ambient capture adapters will populate this once the cron ticks."
              : "Try widening the severity floor or switching the family chip to All."
          }
        />
      )}

      <ul className="flex flex-col divide-y rounded-lg border bg-card">
        {filtered.map((signal) => {
          const Icon = iconForKind(signal.kind);
          const href = hrefForSignalEntity(signal);
          const content = (
            <div className="flex flex-1 items-start gap-3 px-4 py-3">
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full",
                  severityDotClass(signal.severity),
                )}
              />
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      severityTextClass(signal.severity),
                    )}
                  >
                    {labelForSignalKind(signal.kind)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {signal.source}
                  </span>
                  <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {relativeTimeLabel(signal.occurred_at, nowMs)}
                  </span>
                </div>
                <span className="line-clamp-2 text-sm font-medium text-foreground">
                  {signal.title}
                </span>
                {signal.description && (
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {signal.description}
                  </span>
                )}
              </div>
              {href && (
                <ArrowRight
                  className="mt-2 h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              )}
            </div>
          );

          return (
            <li key={signal.id}>
              {href ? (
                <Link
                  to={href}
                  className="flex w-full items-stretch transition hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {content}
                </Link>
              ) : (
                <div className="flex w-full items-stretch">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ChipRow({
  ariaLabel,
  items,
  activeId,
  onSelect,
}: {
  ariaLabel: string;
  items: Array<{ id: string; label: string }>;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className="inline-flex flex-wrap items-center gap-1 rounded-full border bg-card p-0.5 text-xs"
    >
      {items.map(({ id, label }) => {
        const active = activeId === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(id)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs transition",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-lg border bg-card px-6 py-10 text-sm">
      <span className="flex items-center gap-2 font-medium">
        <Users className="h-4 w-4 text-muted-foreground" />
        {title}
      </span>
      <span className="text-muted-foreground">{body}</span>
    </div>
  );
}
