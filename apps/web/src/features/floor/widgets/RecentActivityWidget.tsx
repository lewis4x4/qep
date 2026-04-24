/**
 * RecentActivityWidget — sales rep's latest touches + buying signals.
 *
 * Two streams merged into one top-5:
 *   1. Touches this rep logged (qrm_activities WHERE created_by = me)
 *   2. Customers who opened a quote this rep sent (quote_packages
 *      WHERE created_by = me AND viewed_at within the last 7 days)
 *
 * The second stream is the moonshot — the moment a prospect opens a
 * sent quote is the highest-intent signal a rep gets all day. The
 * widget pins these rows in emerald so they read at a glance.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Eye,
  FileText,
  Mail,
  MessageSquare,
  Mic,
  Phone,
  StickyNote,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import {
  EmptyState,
  ErrorLine,
  FloorWidgetShell,
  LoadingLine,
} from "./DirectWrapWidgets";

type ActivityKind =
  | "call"
  | "email"
  | "meeting"
  | "note"
  | "task"
  | "voice"
  | "visit"
  | "text"
  | "other";

interface ActivityItem {
  id: string;
  kind: ActivityKind | "quote_viewed";
  occurredAt: string;
  label: string;
  detail: string | null;
  href: string | null;
  tone: "default" | "buying_signal";
}

const ACTIVITY_KIND_MAP: Record<string, ActivityKind> = {
  call: "call",
  phone_call: "call",
  email: "email",
  meeting: "meeting",
  note: "note",
  task: "task",
  voice_note: "voice",
  voice_memo: "voice",
  visit: "visit",
  text: "text",
  sms: "text",
};

function kindIcon(kind: ActivityItem["kind"]) {
  switch (kind) {
    case "call":
      return <Phone className="h-3.5 w-3.5" aria-hidden="true" />;
    case "email":
      return <Mail className="h-3.5 w-3.5" aria-hidden="true" />;
    case "meeting":
      return <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />;
    case "note":
      return <StickyNote className="h-3.5 w-3.5" aria-hidden="true" />;
    case "voice":
      return <Mic className="h-3.5 w-3.5" aria-hidden="true" />;
    case "quote_viewed":
      return <Eye className="h-3.5 w-3.5" aria-hidden="true" />;
    default:
      return <Activity className="h-3.5 w-3.5" aria-hidden="true" />;
  }
}

function kindLabel(kind: ActivityItem["kind"]): string {
  switch (kind) {
    case "quote_viewed":
      return "Quote viewed";
    case "call":
      return "Call";
    case "email":
      return "Email";
    case "meeting":
      return "Meeting";
    case "note":
      return "Note";
    case "task":
      return "Task";
    case "voice":
      return "Voice note";
    case "visit":
      return "Visit";
    case "text":
      return "Text";
    default:
      return "Activity";
  }
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

type ActivityRow = {
  id: string;
  activity_type: string | null;
  body: string | null;
  occurred_at: string;
  deal_id: string | null;
  company_id: string | null;
  company?: { name: string | null; dba: string | null } | { name: string | null; dba: string | null }[] | null;
  deal?: { name: string | null } | { name: string | null }[] | null;
};

type QuoteViewedRow = {
  id: string;
  deal_id: string | null;
  quote_number: string | null;
  customer_company: string | null;
  customer_name: string | null;
  viewed_at: string | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function RecentActivityWidget() {
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const query = useQuery({
    queryKey: ["floor", "sales", "recent-activity", userId],
    enabled: !!userId,
    queryFn: async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

      const [activityRes, viewedRes] = await Promise.all([
        supabase
          .from("qrm_activities")
          .select(
            `id, activity_type, body, occurred_at, deal_id, company_id,
             company:qrm_companies ( name, dba ),
             deal:qrm_deals ( name )`,
          )
          .eq("created_by", userId)
          .is("deleted_at", null)
          .order("occurred_at", { ascending: false })
          .limit(10),
        supabase
          .from("quote_packages")
          .select("id, deal_id, quote_number, customer_company, customer_name, viewed_at")
          .eq("created_by", userId)
          .not("viewed_at", "is", null)
          .gte("viewed_at", sevenDaysAgo)
          .order("viewed_at", { ascending: false })
          .limit(10),
      ]);

      if (activityRes.error) throw new Error(activityRes.error.message);
      if (viewedRes.error) throw new Error(viewedRes.error.message);

      const activityItems: ActivityItem[] = (activityRes.data ?? []).map(
        (raw) => {
          const row = raw as unknown as ActivityRow;
          const company = one(row.company);
          const deal = one(row.deal);
          const customer = company?.dba ?? company?.name ?? null;
          const kindKey = (row.activity_type ?? "other").toLowerCase();
          const kind: ActivityKind = ACTIVITY_KIND_MAP[kindKey] ?? "other";
          const labelCustomer = customer ?? deal?.name ?? "Internal";
          const body = row.body ? row.body.trim() : null;
          return {
            id: `activity-${row.id}`,
            kind,
            occurredAt: row.occurred_at,
            label: `${kindLabel(kind)} · ${labelCustomer}`,
            detail: body && body.length > 0 ? body.slice(0, 120) : null,
            href: row.deal_id ? `/qrm/deals/${row.deal_id}` : null,
            tone: "default",
          };
        },
      );

      const viewedItems: ActivityItem[] = (viewedRes.data ?? [])
        .filter((row) => Boolean((row as QuoteViewedRow).viewed_at))
        .map((raw) => {
          const row = raw as unknown as QuoteViewedRow;
          const customer = row.customer_company ?? row.customer_name ?? "Customer";
          const label = row.quote_number
            ? `Quote ${row.quote_number} opened`
            : "Quote opened";
          return {
            id: `viewed-${row.id}`,
            kind: "quote_viewed",
            occurredAt: row.viewed_at as string,
            label: `${label} · ${customer}`,
            detail: "Buying signal — follow up now",
            href: `/quote-v2?package_id=${encodeURIComponent(row.id)}${row.deal_id ? `&crm_deal_id=${encodeURIComponent(row.deal_id)}` : ""}`,
            tone: "buying_signal",
          };
        });

      return [...activityItems, ...viewedItems]
        .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
        .slice(0, 5);
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const items = query.data ?? [];
  const buyingSignalCount = useMemo(
    () => items.filter((item) => item.tone === "buying_signal").length,
    [items],
  );

  return (
    <FloorWidgetShell
      title="Recent activity"
      icon={<Activity className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/sales/today"
      linkLabel="Timeline"
      minHeight="min-h-[220px]"
    >
      {query.isLoading ? <LoadingLine /> : null}
      {query.isError ? <ErrorLine>Couldn't load recent activity.</ErrorLine> : null}
      {!query.isLoading && !query.isError ? (
        items.length > 0 ? (
          <div className="space-y-3">
            {buyingSignalCount > 0 ? (
              <div className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold text-emerald-200">
                {buyingSignalCount} quote{buyingSignalCount === 1 ? "" : "s"} opened this week —
                follow up while the room is warm.
              </div>
            ) : null}
            <ul className="space-y-1.5">
              {items.map((item) => {
                const tone =
                  item.tone === "buying_signal"
                    ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                    : "border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))]/45 text-muted-foreground";
                const content = (
                  <div
                    className={`flex items-start gap-2 rounded-lg border px-3 py-2 transition-colors hover:border-[hsl(var(--qep-orange))]/40 ${tone}`}
                  >
                    <span className="mt-0.5 shrink-0">{kindIcon(item.kind)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-foreground">
                        {item.label}
                      </p>
                      {item.detail ? (
                        <p
                          className={`truncate text-[11px] ${item.tone === "buying_signal" ? "text-emerald-200/90" : "text-muted-foreground"}`}
                        >
                          {item.detail}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 font-kpi text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      {timeAgo(item.occurredAt)}
                    </span>
                  </div>
                );
                return (
                  <li key={item.id}>
                    {item.href ? (
                      <Link to={item.href} className="block">
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <EmptyState
            icon={<FileText className="h-6 w-6" aria-hidden="true" />}
            title="No recent activity"
            body="Calls, emails, voice notes, and customer quote opens will stream here."
          />
        )
      ) : null}
    </FloorWidgetShell>
  );
}
