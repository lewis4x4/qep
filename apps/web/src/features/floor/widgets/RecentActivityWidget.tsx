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

      const activityItems = normalizeActivityRows(activityRes.data ?? []);
      const viewedItems = normalizeQuoteViewedRows(viewedRes.data ?? []);

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

function normalizeActivityRows(rows: unknown[]): ActivityItem[] {
  return rows.map(normalizeActivityRow).filter((row): row is ActivityItem => row !== null);
}

function normalizeActivityRow(row: unknown): ActivityItem | null {
  if (!isRecord(row)) return null;
  const id = nullableString(row.id);
  const occurredAt = nullableString(row.occurred_at);
  if (!id || !occurredAt) return null;
  const company = firstRecord(row.company);
  const deal = firstRecord(row.deal);
  const customer = nullableString(company?.dba) ?? nullableString(company?.name);
  const dealName = nullableString(deal?.name);
  const kindKey = (nullableString(row.activity_type) ?? "other").toLowerCase();
  const kind: ActivityKind = ACTIVITY_KIND_MAP[kindKey] ?? "other";
  const labelCustomer = customer ?? dealName ?? "Internal";
  const body = nullableString(row.body)?.trim() ?? null;
  const dealId = nullableString(row.deal_id);
  return {
    id: `activity-${id}`,
    kind,
    occurredAt,
    label: `${kindLabel(kind)} · ${labelCustomer}`,
    detail: body && body.length > 0 ? body.slice(0, 120) : null,
    href: dealId ? `/qrm/deals/${dealId}` : null,
    tone: "default",
  };
}

function normalizeQuoteViewedRows(rows: unknown[]): ActivityItem[] {
  return rows.map(normalizeQuoteViewedRow).filter((row): row is ActivityItem => row !== null);
}

function normalizeQuoteViewedRow(row: unknown): ActivityItem | null {
  if (!isRecord(row)) return null;
  const id = nullableString(row.id);
  const viewedAt = nullableString(row.viewed_at);
  if (!id || !viewedAt) return null;
  const dealId = nullableString(row.deal_id);
  const customer = nullableString(row.customer_company) ?? nullableString(row.customer_name) ?? "Customer";
  const quoteNumber = nullableString(row.quote_number);
  const label = quoteNumber ? `Quote ${quoteNumber} opened` : "Quote opened";
  return {
    id: `viewed-${id}`,
    kind: "quote_viewed",
    occurredAt: viewedAt,
    label: `${label} · ${customer}`,
    detail: "Buying signal — follow up now",
    href: `/quote-v2?package_id=${encodeURIComponent(id)}${dealId ? `&crm_deal_id=${encodeURIComponent(dealId)}` : ""}`,
    tone: "buying_signal",
  };
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value.find(isRecord) ?? null;
  return isRecord(value) ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
