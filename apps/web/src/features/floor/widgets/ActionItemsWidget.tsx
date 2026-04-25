/**
 * ActionItemsWidget — David's daily priority list, deal-impact ordered.
 *
 * The default Iron Advisor follow-up queue sorts by date. A sales rep's
 * reality is different — the stale call on a $250K deal beats the stale
 * call on a $8K deal, every day. This widget resorts the same underlying
 * touchpoint feed by DEAL AMOUNT (descending), then date as tiebreaker,
 * then renders each row as a one-tap row with Call / Email / Mark-done
 * affordances.
 *
 * Moonshot:
 *   • Join-level ordering by deal.amount DESC — biggest stake first.
 *   • Per-row quick actions:
 *       - "tel:" / "mailto:" links honor the native phone app
 *       - "Mark done" performs an optimistic status update on the
 *         touchpoint row (pending → completed)
 *   • Cadence-day chip shows where in the day 0/2-3/7/14/30 arc this
 *     touchpoint sits — fast context at a glance.
 *   • Empty state is a positive: "You're caught up for today" vs. the
 *     commodity "No tasks" phrasing.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  Loader2,
  Mail,
  PhoneCall,
  ShieldCheck,
  Target,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface ActionRow {
  touchpointId: string;
  dealId: string | null;
  dealName: string;
  dealAmountCents: number | null;
  companyName: string | null;
  companyPhone: string | null;
  contactEmail: string | null;
  touchpointType: string;
  scheduledDate: string | null;
  cadenceStartedAt: string | null;
  purpose: string | null;
  status: string;
}

const RESULT_LIMIT = 5;

async function fetchActions(userId: string): Promise<ActionRow[]> {
  // Select pending/scheduled touchpoints assigned to this user.
  // Join: follow_up_cadences (for deal_id + assigned_to + started_at)
  //    → qrm_deals (for amount, name)
  //    → qrm_companies (for company phone)
  //    → crm_contacts (for contact email)
  const { data, error } = await supabase
    .from("follow_up_touchpoints")
    .select(
      `
      id, touchpoint_type, scheduled_date, purpose, status,
      cadence:follow_up_cadences!inner (
        deal_id, assigned_to, started_at, contact_id,
        deal:qrm_deals (
          id, name, amount,
          company:qrm_companies ( id, name, dba, phone )
        ),
        contact:crm_contacts ( email )
      )
    `,
    )
    .in("status", ["pending", "scheduled"])
    .eq("cadence.assigned_to", userId)
    .order("scheduled_date", { ascending: true })
    .limit(30);

  if (error) throw new Error(error.message);

  type RawRow = {
    id: string;
    touchpoint_type: string;
    scheduled_date: string | null;
    purpose: string | null;
    status: string;
    cadence:
      | {
          deal_id: string | null;
          assigned_to: string | null;
          started_at: string | null;
          contact_id: string | null;
          deal:
            | {
                id: string | null;
                name: string | null;
                amount: number | string | null;
                company:
                  | {
                      id: string | null;
                      name: string | null;
                      dba: string | null;
                      phone: string | null;
                    }
                  | Array<{
                      id: string | null;
                      name: string | null;
                      dba: string | null;
                      phone: string | null;
                    }>
                  | null;
              }
            | Array<{
                id: string | null;
                name: string | null;
                amount: number | string | null;
                company:
                  | {
                      id: string | null;
                      name: string | null;
                      dba: string | null;
                      phone: string | null;
                    }
                  | Array<{
                      id: string | null;
                      name: string | null;
                      dba: string | null;
                      phone: string | null;
                    }>
                  | null;
              }>
            | null;
          contact: { email: string | null } | Array<{ email: string | null }> | null;
        }
      | Array<{
          deal_id: string | null;
          assigned_to: string | null;
          started_at: string | null;
          contact_id: string | null;
          deal: unknown;
          contact: unknown;
        }>
      | null;
  };

  const rows = (data ?? []) as unknown as RawRow[];
  const mapped: ActionRow[] = rows.map((r) => {
    // PostgREST embeds can be array or single — flatten defensively.
    const cadence = Array.isArray(r.cadence) ? r.cadence[0] : r.cadence;
    const deal = cadence?.deal
      ? Array.isArray(cadence.deal)
        ? (cadence.deal as { name?: string | null; amount?: number | string | null; company?: unknown }[])[0]
        : (cadence.deal as { name?: string | null; amount?: number | string | null; company?: unknown })
      : null;
    const company = deal?.company
      ? Array.isArray(deal.company)
        ? (deal.company as { name?: string | null; dba?: string | null; phone?: string | null }[])[0]
        : (deal.company as { name?: string | null; dba?: string | null; phone?: string | null })
      : null;
    const contact = cadence?.contact
      ? Array.isArray(cadence.contact)
        ? (cadence.contact as { email?: string | null }[])[0]
        : (cadence.contact as { email?: string | null })
      : null;
    const amountRaw = deal?.amount;
    const amountCents =
      amountRaw == null
        ? null
        : typeof amountRaw === "number"
          ? Math.round(amountRaw * 100)
          : Math.round(Number(amountRaw) * 100);
    return {
      touchpointId: r.id,
      dealId: cadence?.deal_id ?? null,
      dealName: deal?.name ?? "—",
      dealAmountCents: Number.isFinite(amountCents) ? amountCents : null,
      companyName: company?.dba ?? company?.name ?? null,
      companyPhone: company?.phone ?? null,
      contactEmail: contact?.email ?? null,
      touchpointType: r.touchpoint_type ?? "follow_up",
      scheduledDate: r.scheduled_date,
      cadenceStartedAt: cadence?.started_at ?? null,
      purpose: r.purpose,
      status: r.status,
    };
  });

  // Deal-impact ordering: biggest deal value first; NULLS LAST so a
  // touchpoint without a linked deal goes below every dealed touchpoint.
  // Tiebreak by earliest scheduled_date.
  return mapped
    .sort((a, b) => {
      const aVal = a.dealAmountCents ?? -1;
      const bVal = b.dealAmountCents ?? -1;
      if (aVal !== bVal) return bVal - aVal;
      const aDate = a.scheduledDate ? new Date(a.scheduledDate).getTime() : Number.POSITIVE_INFINITY;
      const bDate = b.scheduledDate ? new Date(b.scheduledDate).getTime() : Number.POSITIVE_INFINITY;
      return aDate - bDate;
    })
    .slice(0, RESULT_LIMIT);
}

function cadenceDay(scheduled: string | null, started: string | null): string {
  if (!scheduled || !started) return "—";
  const days = Math.round(
    (new Date(scheduled).getTime() - new Date(started).getTime()) / 86_400_000,
  );
  if (!Number.isFinite(days) || days < 0) return "—";
  return `Day ${days}`;
}

function formatUsd(cents: number | null): string {
  if (cents == null) return "—";
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`;
  return `$${dollars.toFixed(0)}`;
}

function formatWhen(iso: string | null): { text: string; tone: "ok" | "today" | "overdue" } {
  if (!iso) return { text: "Unscheduled", tone: "ok" };
  const diffDays = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (diffDays > 0) return { text: `${diffDays}d overdue`, tone: "overdue" };
  if (diffDays === 0) return { text: "Today", tone: "today" };
  return { text: `In ${Math.abs(diffDays)}d`, tone: "ok" };
}

export function ActionItemsWidget() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["floor", "action-items", userId],
    queryFn: () => fetchActions(userId),
    enabled: !!userId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const completeMutation = useMutation({
    mutationFn: async (touchpointId: string) => {
      const { error } = await supabase
        .from("follow_up_touchpoints")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", touchpointId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["floor", "action-items", userId] });
      toast({ title: "Marked done" });
    },
    onError: (err) => {
      toast({
        title: "Couldn't update",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const totalValue = useMemo(() => {
    const rows = data ?? [];
    return rows.reduce((sum, r) => sum + (r.dealAmountCents ?? 0), 0);
  }, [data]);

  return (
    <div
      role="figure"
      aria-label="Action items — top 5 by deal impact"
      className="floor-widget-in relative flex h-full min-h-[240px] flex-col overflow-hidden rounded-xl border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))] p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] transition-all duration-150 ease-out hover:border-[hsl(var(--qep-orange))]/40"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[2px] bg-[hsl(var(--qep-orange))]/60"
      />

      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5 text-[hsl(var(--qep-gray))]" aria-hidden="true" />
          <h3 className="font-kpi text-[11px] font-extrabold uppercase tracking-[0.14em] text-[hsl(var(--qep-gray))]">
            Action items
          </h3>
          {totalValue > 0 && (
            <span className="rounded-full border border-[hsl(var(--qep-orange))]/40 bg-[hsl(var(--qep-orange))]/5 px-1.5 py-0.5 font-kpi text-[10px] font-extrabold tabular-nums text-[hsl(var(--qep-orange))]">
              {formatUsd(totalValue)} at stake
            </span>
          )}
        </div>
        <Link
          to="/qrm/my/reality"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:text-[hsl(var(--qep-orange))]"
        >
          All
        </Link>
      </div>

      {/* Body */}
      <div className="mt-3 flex-1">
        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading…
          </div>
        )}
        {isError && (
          <p className="text-xs text-rose-300">Couldn't load action items right now.</p>
        )}
        {!isLoading && !isError && (data?.length ?? 0) === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <ShieldCheck className="h-6 w-6 text-emerald-400/70" aria-hidden="true" />
            <p className="text-sm font-semibold text-foreground">You&rsquo;re caught up</p>
            <p className="max-w-[18rem] text-[11px] text-muted-foreground">
              No pending touchpoints on your cadences. Nudge the pipeline forward by voice or
              start a quote.
            </p>
          </div>
        )}
        {!isLoading && !isError && (data?.length ?? 0) > 0 && (
          <ul className="space-y-1.5">
            {data!.map((row) => (
              <ActionRowCard
                key={row.touchpointId}
                row={row}
                onComplete={() => completeMutation.mutate(row.touchpointId)}
                completing={completeMutation.isPending && completeMutation.variables === row.touchpointId}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ActionRowCard({
  row,
  onComplete,
  completing,
}: {
  row: ActionRow;
  onComplete: () => void;
  completing: boolean;
}) {
  const when = formatWhen(row.scheduledDate);
  const cadence = cadenceDay(row.scheduledDate, row.cadenceStartedAt);

  return (
    <li>
      <div className="group flex items-start gap-2 rounded-md border border-transparent px-2 py-2 transition-colors hover:border-[hsl(var(--qep-deck-rule))] hover:bg-[hsl(var(--qep-deck))]">
        {/* Value badge — biggest first, high-contrast */}
        <span
          className={
            row.dealAmountCents && row.dealAmountCents > 0
              ? "flex h-10 w-14 shrink-0 items-center justify-center rounded-md border border-[hsl(var(--qep-orange))]/40 bg-[hsl(var(--qep-orange))]/10 font-kpi text-xs font-extrabold tabular-nums text-[hsl(var(--qep-orange))]"
              : "flex h-10 w-14 shrink-0 items-center justify-center rounded-md border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))] font-kpi text-[10px] font-extrabold text-muted-foreground"
          }
          aria-label={`Deal value ${formatUsd(row.dealAmountCents)}`}
        >
          {formatUsd(row.dealAmountCents)}
        </span>

        {/* Middle — customer + purpose + when chips */}
        <div className="min-w-0 flex-1">
          {row.dealId ? (
            <Link
              to={`/qrm/deals/${row.dealId}`}
              className="block truncate text-sm font-semibold text-foreground hover:text-[hsl(var(--qep-orange))]"
            >
              {row.companyName || row.dealName}
            </Link>
          ) : (
            <span className="block truncate text-sm font-semibold text-foreground">
              {row.companyName || row.dealName}
            </span>
          )}
          <p className="truncate text-[11px] text-muted-foreground">
            {row.purpose || row.touchpointType.replace(/_/g, " ")}
          </p>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em]">
            <span
              className={
                when.tone === "overdue"
                  ? "font-semibold text-rose-400"
                  : when.tone === "today"
                    ? "font-semibold text-[hsl(var(--qep-orange))]"
                    : "text-muted-foreground"
              }
            >
              {when.text}
            </span>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-muted-foreground">{cadence}</span>
          </div>
        </div>

        {/* Quick actions — call / email / done. Hidden until hover on desktop. */}
        <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
          {row.companyPhone && (
            <a
              href={`tel:${row.companyPhone}`}
              aria-label={`Call ${row.companyName ?? "customer"}`}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-[hsl(var(--qep-orange))]/10 hover:text-[hsl(var(--qep-orange))]"
            >
              <PhoneCall className="h-3.5 w-3.5" />
            </a>
          )}
          {row.contactEmail && (
            <a
              href={`mailto:${row.contactEmail}`}
              aria-label={`Email ${row.companyName ?? "customer"}`}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-[hsl(var(--qep-orange))]/10 hover:text-[hsl(var(--qep-orange))]"
            >
              <Mail className="h-3.5 w-3.5" />
            </a>
          )}
          <button
            type="button"
            onClick={onComplete}
            disabled={completing}
            aria-label="Mark done"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-emerald-500/10 hover:text-emerald-400 disabled:opacity-40"
          >
            {completing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
          </button>
          {row.dealId && (
            <ChevronRight className="ml-0.5 h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </div>
      </div>
    </li>
  );
}
