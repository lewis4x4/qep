import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Wrench, Package, FileText, Receipt, AlertCircle, TrendingUp, Calendar, ArrowRight,
} from "lucide-react";
import { StatusChipStack } from "@/components/primitives";
import type {
  Account360Response,
  Account360FleetItem,
  Account360OpenQuote,
  Account360ServiceJob,
  Account360Invoice,
} from "../lib/account-360-api";

/* ── Recommended Next Best Actions composite ─────────────────────── */

interface NbaItem {
  title: string;
  detail: string;
  href?: string;
  tone: "red" | "orange" | "blue" | "green" | "violet";
  icon: React.ReactNode;
}

export function AccountNextBestActions({ data }: { data: Account360Response }) {
  const items: NbaItem[] = [];

  // Active AR block — top priority
  if (data.ar_block && data.ar_block.status === "active") {
    items.push({
      title: "Resolve AR credit block",
      detail: `${data.ar_block.block_reason}. ${data.ar_block.current_max_aging_days ?? "—"} days max aging.`,
      tone: "red",
      icon: <AlertCircle className="h-4 w-4" />,
    });
  }

  // Quotes expiring within 14 days
  const expiringSoon = data.open_quotes.filter((q) => {
    if (!q.expires_at) return false;
    const days = (new Date(q.expires_at).getTime() - Date.now()) / 86_400_000;
    return days >= 0 && days <= 14;
  });
  if (expiringSoon.length > 0) {
    items.push({
      title: `${expiringSoon.length} quote${expiringSoon.length > 1 ? "s" : ""} expiring soon`,
      detail: `Top: ${expiringSoon[0].deal_name ?? "Untitled deal"} — $${(expiringSoon[0].net_total ?? 0).toLocaleString()}`,
      href: `/qrm/deals/${expiringSoon[0].deal_id}`,
      tone: "orange",
      icon: <FileText className="h-4 w-4" />,
    });
  }

  // Health score declining or low
  if (data.health?.current_score != null && data.health.current_score < 50) {
    items.push({
      title: "Health score below 50",
      detail: `Currently ${Math.round(Number(data.health.current_score))}/100. Open the explainer for top negative factors.`,
      tone: "orange",
      icon: <TrendingUp className="h-4 w-4" />,
    });
  }

  // Budget cycle approaching (within next 60 days)
  const cycleMonth = data.profile?.budget_cycle_month;
  if (cycleMonth) {
    const now = new Date();
    const nextCycle = new Date(now.getFullYear(), cycleMonth - 1, 1);
    if (nextCycle < now) nextCycle.setFullYear(now.getFullYear() + 1);
    const days = (nextCycle.getTime() - now.getTime()) / 86_400_000;
    if (days <= 60) {
      items.push({
        title: `Budget cycle opens in ${Math.round(days)} days`,
        detail: `Customer budget month is ${nextCycle.toLocaleString("en-US", { month: "long" })}. Time to surface options.`,
        tone: "blue",
        icon: <Calendar className="h-4 w-4" />,
      });
    }
  }

  // Active service jobs as a positive engagement signal
  const openSj = data.service.filter((sj) => !["closed", "invoiced", "cancelled"].includes(sj.current_stage));
  if (openSj.length > 0 && items.length < 3) {
    items.push({
      title: `${openSj.length} open service job${openSj.length > 1 ? "s" : ""}`,
      detail: "Customer is actively engaged. Consider trade-up conversation while iron is in the shop.",
      tone: "violet",
      icon: <Wrench className="h-4 w-4" />,
    });
  }

  if (items.length === 0) {
    return (
      <Card className="p-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Recommended next actions</p>
        <p className="mt-1 text-xs text-muted-foreground">No urgent flags. Routine cadence.</p>
      </Card>
    );
  }

  const TONE: Record<NbaItem["tone"], string> = {
    red:    "border-red-500/30",
    orange: "border-qep-orange/30",
    blue:   "border-blue-500/30",
    green:  "border-emerald-500/30",
    violet: "border-violet-500/30",
  };

  return (
    <Card className="p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
        Recommended next actions
      </p>
      <div className="space-y-2">
        {items.slice(0, 3).map((item, i) => (
          <div key={i} className={`rounded-md border bg-muted/20 p-2 ${TONE[item.tone]}`}>
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground">{item.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground">{item.title}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{item.detail}</p>
              </div>
              {item.href && (
                <Link to={item.href} className="text-xs text-qep-orange hover:underline">
                  <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── Fleet tab ──────────────────────────────────────────────────── */

export function AccountFleetTab({ fleet, companyId }: { fleet: Account360FleetItem[]; companyId: string }) {
  if (fleet.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-xs text-muted-foreground">No equipment on file for this company.</p>
      </Card>
    );
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground">{fleet.length} machines</p>
        <Button asChild size="sm" variant="outline" className="h-7 text-[10px]">
          <Link to={`/qrm/companies/${companyId}/fleet-radar`}>
            Open Fleet Radar →
          </Link>
        </Button>
      </div>
      <div className="space-y-2">
        {fleet.map((m) => {
          const titleParts = [m.year, m.make, m.model].filter(Boolean);
          const chips: Array<{ label: string; tone: "blue" | "orange" | "neutral" | "yellow" }> = [];
          if (m.engine_hours != null) chips.push({ label: `${Math.round(m.engine_hours)}h`, tone: "orange" });
          if (m.stage_label && m.stage_label !== "Operational") {
            chips.push({ label: m.stage_label, tone: "yellow" });
          }
          return (
            <Card key={m.id} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <Link to={`/equipment/${m.id}`} className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate hover:text-qep-orange">
                    {titleParts.length > 0 ? titleParts.join(" ") : m.name}
                  </p>
                  {m.serial_number && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground">S/N {m.serial_number}</p>
                  )}
                  <div className="mt-1">
                    <StatusChipStack chips={chips} />
                  </div>
                </Link>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ── Open quotes tab ────────────────────────────────────────────── */

export function AccountQuotesTab({ quotes }: { quotes: Account360OpenQuote[] }) {
  if (quotes.length === 0) {
    return <Card className="p-4"><p className="text-xs text-muted-foreground">No open quotes.</p></Card>;
  }
  return (
    <div className="space-y-2">
      {quotes.map((q) => {
        const expiresInDays = q.expires_at
          ? Math.round((new Date(q.expires_at).getTime() - Date.now()) / 86_400_000)
          : null;
        return (
          <Card key={q.id} className="p-3">
            <div className="flex items-start justify-between gap-3">
              <Link to={`/qrm/deals/${q.deal_id}`} className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate hover:text-qep-orange">
                  {q.deal_name ?? "Untitled deal"}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground capitalize">{q.status}</p>
              </Link>
              <div className="text-right">
                <p className="text-sm font-bold text-foreground tabular-nums">
                  ${(q.net_total ?? 0).toLocaleString()}
                </p>
                {expiresInDays != null && (
                  <p className={`text-[10px] tabular-nums ${
                    expiresInDays < 0 ? "text-red-400" :
                    expiresInDays <= 7 ? "text-amber-400" : "text-muted-foreground"
                  }`}>
                    {expiresInDays < 0 ? `Expired ${-expiresInDays}d ago` : `${expiresInDays}d to expire`}
                  </p>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ── Service tab ────────────────────────────────────────────────── */

export function AccountServiceTab({ service }: { service: Account360ServiceJob[] }) {
  if (service.length === 0) {
    return <Card className="p-4"><p className="text-xs text-muted-foreground">No service jobs on file.</p></Card>;
  }
  return (
    <div className="space-y-2">
      {service.map((sj) => {
        const isOpen = !["closed", "invoiced", "cancelled"].includes(sj.current_stage);
        return (
          <Card key={sj.id} className="p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">
                  {sj.customer_problem_summary ?? "Service job"}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {sj.scheduled_start_at && `Scheduled ${new Date(sj.scheduled_start_at).toLocaleDateString()}`}
                  {sj.completed_at && ` · Completed ${new Date(sj.completed_at).toLocaleDateString()}`}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                isOpen ? "bg-qep-orange/10 text-qep-orange" : "bg-muted text-muted-foreground"
              }`}>
                {sj.current_stage.replace(/_/g, " ")}
              </span>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ── Parts tab ──────────────────────────────────────────────────── */

export function AccountPartsTab({ parts }: { parts: Account360Response["parts"] }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Lifetime parts spend</p>
          <p className="mt-1 text-2xl font-bold text-violet-400 tabular-nums">
            ${(parts.lifetime_total ?? 0).toLocaleString()}
          </p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Order count</p>
          <p className="mt-1 text-2xl font-bold text-foreground tabular-nums">{parts.order_count}</p>
        </Card>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Recent orders</p>
        {parts.recent.length === 0 ? (
          <Card className="p-3"><p className="text-xs text-muted-foreground">No parts orders yet.</p></Card>
        ) : (
          <div className="space-y-1.5">
            {parts.recent.map((po) => (
              <Card key={po.id} className="p-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-foreground capitalize">{po.status.replace(/_/g, " ")}</span>
                  <span className="font-bold text-foreground tabular-nums">${po.total.toLocaleString()}</span>
                </div>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {new Date(po.created_at).toLocaleDateString()}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Invoices / AR tab ──────────────────────────────────────────── */

export function AccountARTab({ invoices, arBlock }: { invoices: Account360Invoice[]; arBlock: Account360Response["ar_block"] }) {
  return (
    <div className="space-y-3">
      {arBlock && arBlock.status === "active" && (
        <Card className="border-red-500/30 bg-red-500/5 p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-400 shrink-0" aria-hidden />
            <div>
              <p className="text-xs font-semibold text-red-400">AR credit block active</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {arBlock.block_reason} · {arBlock.current_max_aging_days ?? "—"} days max aging
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Order progression blocked. Quotes still allowed. Manager override required.
              </p>
            </div>
          </div>
        </Card>
      )}

      {invoices.length === 0 ? (
        <Card className="p-4"><p className="text-xs text-muted-foreground">No open invoices.</p></Card>
      ) : (
        <div className="space-y-2">
          {invoices.map((ci) => {
            const overdue = new Date(ci.due_date) < new Date();
            return (
              <Card key={ci.id} className={`p-3 ${overdue ? "border-red-500/30" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      <Receipt className="inline h-3 w-3 mr-1 text-muted-foreground" />
                      {ci.invoice_number}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      Due {new Date(ci.due_date).toLocaleDateString()}
                      {overdue && " · OVERDUE"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-foreground tabular-nums">
                      ${ci.balance_due.toLocaleString()}
                    </p>
                    <p className="text-[10px] text-muted-foreground capitalize">{ci.status}</p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
