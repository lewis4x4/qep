import { Link } from "react-router-dom";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Wrench, Package, FileText, Receipt, AlertCircle, TrendingUp, Calendar, ArrowRight, Mail, Shield, Loader2,
  Database, Users, CreditCard, BarChart3, Target,
} from "lucide-react";
import { StatusChipStack } from "@/components/primitives";
import { supabase } from "@/lib/supabase";
import type {
  Account360Response,
  Account360FleetItem,
  Account360OpenQuote,
  Account360ServiceJob,
  Account360Invoice,
  FleetRadarLensItem,
  IntelliDealerAccountSummary,
} from "../lib/account-360-api";
import { fetchFleetRadar, fetchIntelliDealerAccountSummary } from "../lib/account-360-api";
import { fetchCompanyEquipment } from "../lib/qrm-router-api";
import type { QrmEquipment } from "../lib/types";

const DRAFT_EMAIL_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/draft-email`;

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
              <div className="flex items-start gap-2">
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
                <div className="flex shrink-0 flex-col gap-2">
                  <Button asChild size="sm" variant="outline" className="h-8 px-2 text-xs">
                    <Link to={`/quote-v2?package_id=${encodeURIComponent(q.id)}&crm_deal_id=${encodeURIComponent(q.deal_id)}`}>
                      Resume
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="ghost" className="h-8 px-2 text-xs">
                    <Link to="/quote">All Quotes</Link>
                  </Button>
                </div>
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

export function AccountIntelliDealerTab({ companyId }: { companyId: string }) {
  const [showAllAgencies, setShowAllAgencies] = useState(false);
  const [showProfitabilityDetail, setShowProfitabilityDetail] = useState(false);
  const [showAllMemos, setShowAllMemos] = useState(false);
  const importQuery = useQuery({
    queryKey: ["intellidealer-account-summary", companyId],
    queryFn: () => fetchIntelliDealerAccountSummary(companyId),
    staleTime: 60_000,
  });

  if (importQuery.isLoading) {
    return <Card className="h-32 animate-pulse bg-muted/30" />;
  }

  if (importQuery.isError) {
    return (
      <Card className="border-red-500/30 bg-red-500/5 p-4">
        <p className="text-xs text-red-400">Imported IntelliDealer data is unavailable right now.</p>
      </Card>
    );
  }

  const data = importQuery.data;
  if (!data) {
    return <Card className="p-4"><p className="text-xs text-muted-foreground">No IntelliDealer import facts are linked to this account.</p></Card>;
  }

  if (!data.company?.legacy_customer_number && data.contacts.length === 0 && data.arAgencies.length === 0 && data.profitability.length === 0 && data.memos.length === 0) {
    return <Card className="p-4"><p className="text-xs text-muted-foreground">No IntelliDealer import facts are linked to this account.</p></Card>;
  }

  const total = pickProfitabilityTotal(data);
  const metadata = data.company?.metadata ?? {};
  const sourceCode = [
    textMeta(metadata, "source_company_code"),
    textMeta(metadata, "source_division_code"),
    data.company?.legacy_customer_number,
  ].filter(Boolean).join(" / ");
  const activeAgencies = data.arAgencies.filter((agency) => agency.active);
  const defaultAgency = data.arAgencies.find((agency) => agency.is_default_agency) ?? null;
  const creditLimitTotal = sumCents(activeAgencies.map((agency) => agency.credit_limit_cents));
  const transactionLimitMax = maxCents(activeAgencies.map((agency) => agency.transaction_limit_cents));
  const contactsWithEmail = data.contacts.filter((contact) => Boolean(contact.email)).length;
  const contactsWithPhone = data.contacts.filter((contact) => Boolean(contact.cell ?? contact.direct_phone ?? contact.phone)).length;
  const primaryContact = data.contacts[0] ?? null;
  const nextAction = buildIntelliDealerNextAction(data, total, activeAgencies, defaultAgency);
  const visibleAgencies = showAllAgencies ? data.arAgencies : data.arAgencies.slice(0, 12);
  const sortedProfitability = sortProfitability(data.profitability);
  const visibleMemos = showAllMemos ? data.memos : data.memos.slice(0, 5);

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden border-sky-500/20 bg-sky-500/[0.04]">
        <div className="flex items-start gap-3 border-b border-sky-500/15 p-4">
          <div className="rounded-lg bg-sky-500/10 p-2 text-sky-300">
            <Database className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">IntelliDealer source identity</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {sourceCode || "Source key unavailable"} · {data.company?.status ?? "unknown"} account
            </p>
          </div>
        </div>
        <div className="grid gap-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Legacy customer #" value={data.company?.legacy_customer_number} />
          <Fact label="A/R type" value={formatCode(data.company?.ar_type)} />
          <Fact label="Terms" value={data.company?.terms_code ?? data.company?.payment_terms_code} />
          <Fact label="Pricing level" value={data.company?.pricing_level != null ? String(data.company.pricing_level) : null} />
          <Fact label="Territory" value={data.company?.territory_code ?? textMeta(metadata, "territory_code")} />
          <Fact label="Branch" value={textMeta(metadata, "branch_code")} />
          <Fact label="Salesperson" value={textMeta(metadata, "salesperson_code")} />
          <Fact label="Business class" value={textMeta(metadata, "business_class_code")} />
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SignalCard
          label="A/R exposure"
          value={formatCents(creditLimitTotal)}
          detail={`${activeAgencies.length.toLocaleString()} active agencies · max transaction ${formatCents(transactionLimitMax)}`}
          icon={<CreditCard className="h-4 w-4" />}
          tone={activeAgencies.length > 0 ? "sky" : "neutral"}
        />
        <SignalCard
          label="Profitability posture"
          value={formatPercent(total?.ytd_margin_pct)}
          detail={`YTD margin ${formatCents(total?.ytd_margin_cents)} · current ${formatCents(total?.current_month_margin_cents)}`}
          icon={<BarChart3 className="h-4 w-4" />}
          tone={profitabilityTone(total?.ytd_margin_pct)}
        />
        <SignalCard
          label="Contact coverage"
          value={`${data.contacts.length.toLocaleString()} contacts`}
          detail={`${contactsWithEmail.toLocaleString()} email · ${contactsWithPhone.toLocaleString()} phone/mobile`}
          icon={<Users className="h-4 w-4" />}
          tone={data.contacts.length > 0 ? "emerald" : "amber"}
        />
        <SignalCard
          label="Next best action"
          value={nextAction.title}
          detail={nextAction.detail}
          icon={<Target className="h-4 w-4" />}
          tone={nextAction.tone}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">A/R agency assignments</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{data.arAgencies.length.toLocaleString()} imported rows</p>
            </div>
            {data.arAgencies.length > 12 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-[11px]"
                onClick={() => setShowAllAgencies((value) => !value)}
              >
                {showAllAgencies ? "Show summary" : "Show all"}
              </Button>
            ) : null}
          </div>
          {data.arAgencies.length === 0 ? (
            <p className="text-xs text-muted-foreground">No A/R agency assignments imported.</p>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {visibleAgencies.map((agency) => (
                <div key={agency.id} className="rounded-md border border-border/70 bg-background/50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-foreground">
                        Agency {agency.agency_code}
                        {agency.is_default_agency ? <span className="ml-2 rounded-full bg-qep-orange/10 px-1.5 py-0.5 text-[9px] uppercase text-qep-orange">default</span> : null}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Card redacted · rating {agency.credit_rating || "—"}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {agency.active ? "Active" : "Inactive"} · expires {formatYearMonth(agency.expiration_year_month)} · promo {agency.default_promotion_code || "—"}
                      </p>
                    </div>
                    <div className="text-right text-xs">
                      <p className="font-semibold text-foreground">{formatCents(agency.credit_limit_cents)}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">Txn {formatCents(agency.transaction_limit_cents)}</p>
                    </div>
                  </div>
                </div>
              ))}
              {data.arAgencies.length > 12 && !showAllAgencies ? (
                <p className="text-[11px] text-muted-foreground">Showing 12 of {data.arAgencies.length.toLocaleString()} assignments.</p>
              ) : null}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Contact coverage</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {primaryContact ? contactDisplayName(primaryContact) : "No imported contacts"}
              </p>
            </div>
            <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
          </div>
          {data.contacts.length === 0 ? (
            <p className="text-xs text-muted-foreground">No imported contacts are linked to this account.</p>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {data.contacts.map((contact) => (
                <div key={contact.id} className="rounded-md border border-border/70 bg-background/50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-foreground">{contactDisplayName(contact)}</p>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">{contact.title || "Title unavailable"}</p>
                    </div>
                    <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                      <p>{contact.email || "No email"}</p>
                      <p>{contact.cell ?? contact.direct_phone ?? contact.phone ?? "No phone"}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Memo history</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{data.memos.length.toLocaleString()} imported memos</p>
          </div>
          {data.memos.length > 5 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-[11px]"
              onClick={() => setShowAllMemos((value) => !value)}
            >
              {showAllMemos ? "Show summary" : "Show all"}
            </Button>
          ) : null}
        </div>
        {data.memos.length === 0 ? (
          <p className="text-xs text-muted-foreground">No imported memo history is linked to this account.</p>
        ) : (
          <div className="space-y-2">
            {visibleMemos.map((memo) => (
              <div key={memo.id} className="rounded-md border border-border/70 bg-background/50 p-3">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {memo.pinned ? "Pinned memo" : "Imported memo"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{formatDate(memo.updated_at ?? memo.created_at)}</p>
                </div>
                <p className="whitespace-pre-wrap text-xs leading-5 text-foreground">{memo.body}</p>
              </div>
            ))}
            {data.memos.length > 5 && !showAllMemos ? (
              <p className="text-[11px] text-muted-foreground">Showing 5 of {data.memos.length.toLocaleString()} memos.</p>
            ) : null}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Imported profitability</p>
          {data.profitability.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-[11px]"
              onClick={() => setShowProfitabilityDetail((value) => !value)}
            >
              {showProfitabilityDetail ? "Hide detail" : "Show period detail"}
            </Button>
          ) : null}
        </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Metric label="YTD sales" value={formatCents(total?.ytd_sales_last_month_end_cents)} />
            <Metric label="YTD margin" value={formatCents(total?.ytd_margin_cents)} detail={formatPercent(total?.ytd_margin_pct)} />
            <Metric label="Current month" value={formatCents(total?.current_month_sales_cents)} detail={formatCents(total?.current_month_margin_cents)} />
          </div>
          <div className="mt-4 space-y-2">
            {sortedProfitability.map((fact) => (
              <div key={fact.id} className="rounded-md border border-border/70 bg-background/50 px-3 py-2 text-xs">
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{fact.area_code} · {fact.area_label ?? "Unknown area"}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">YTD sales {formatCents(fact.ytd_sales_last_month_end_cents)}</p>
                  </div>
                  <span className="font-semibold tabular-nums text-foreground">{formatCents(fact.ytd_margin_cents)}</span>
                  <span className={marginTone(fact.ytd_margin_pct)}>{formatPercent(fact.ytd_margin_pct)}</span>
                </div>
                {showProfitabilityDetail ? (
                  <div className="mt-3 grid gap-2 border-t border-border/60 pt-3 text-[11px] sm:grid-cols-3">
                    <MiniMetric label="Current month sales" value={formatCents(fact.current_month_sales_cents)} detail={`Margin ${formatCents(fact.current_month_margin_cents)} · ${formatPercent(fact.current_month_margin_pct)}`} />
                    <MiniMetric label="Last 12 margin" value={formatCents(fact.last_12_margin_cents)} detail={formatPercent(fact.last_12_margin_pct)} />
                    <MiniMetric label="Fiscal LY sales" value={formatCents(fact.fiscal_last_year_sales_cents)} detail={`Margin ${formatCents(fact.fiscal_last_year_margin_cents)}`} />
                    <MiniMetric label="Territory" value={fact.territory_code || "—"} detail={`Salesperson ${fact.salesperson_code || "—"}`} />
                    <MiniMetric label="County / class" value={fact.county_code || "—"} detail={fact.business_class_code || "No class"} />
                    <MiniMetric label="As of" value={formatDate(fact.as_of_date)} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
      </Card>
    </div>
  );
}

function formatCents(value: number | null | undefined): string {
  if (value == null) return "—";
  return `$${Math.round(value / 100).toLocaleString()}`;
}

function formatPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${Number(value).toFixed(1)}%`;
}

function formatCode(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/_/g, " ");
}

function formatYearMonth(value: string | null | undefined): string {
  if (!value || value.length !== 6) return "—";
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function textMeta(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function sortProfitability(facts: IntelliDealerAccountSummary["profitability"]): IntelliDealerAccountSummary["profitability"] {
  const priority = new Map([["T", 0], ["P", 1], ["S", 2], ["L", 3], ["E", 4], ["R", 5]]);
  return [...facts].sort((a, b) => (priority.get(a.area_code) ?? 99) - (priority.get(b.area_code) ?? 99));
}

function pickProfitabilityTotal(data: IntelliDealerAccountSummary): IntelliDealerAccountSummary["profitability"][number] | null {
  return data.profitability.find((fact) => fact.area_code === "T") ?? data.profitability[0] ?? null;
}

function marginTone(value: number | null | undefined): string {
  if (value == null) return "text-[11px] text-muted-foreground tabular-nums";
  if (value < 0) return "text-[11px] text-red-400 tabular-nums";
  if (value < 10) return "text-[11px] text-amber-400 tabular-nums";
  return "text-[11px] text-emerald-400 tabular-nums";
}

type SignalTone = "neutral" | "sky" | "emerald" | "amber" | "red";

function SignalCard({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  tone: SignalTone;
}) {
  const toneClass: Record<SignalTone, string> = {
    neutral: "border-border/70 bg-background/50 text-muted-foreground",
    sky: "border-sky-500/20 bg-sky-500/[0.04] text-sky-300",
    emerald: "border-emerald-500/20 bg-emerald-500/[0.04] text-emerald-300",
    amber: "border-amber-500/20 bg-amber-500/[0.04] text-amber-300",
    red: "border-red-500/20 bg-red-500/[0.04] text-red-300",
  };

  return (
    <Card className={`p-4 ${toneClass[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-lg font-bold text-foreground tabular-nums">{value}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
        </div>
        <span className="shrink-0">{icon}</span>
      </div>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold capitalize text-foreground">{value ?? "—"}</p>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-background/50 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold text-foreground tabular-nums">{value}</p>
      {detail ? <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{detail}</p> : null}
    </div>
  );
}

function MiniMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-semibold text-foreground tabular-nums">{value}</p>
      {detail ? <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">{detail}</p> : null}
    </div>
  );
}

function sumCents(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => typeof value === "number");
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0);
}

function maxCents(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => typeof value === "number");
  if (present.length === 0) return null;
  return Math.max(...present);
}

function profitabilityTone(value: number | null | undefined): SignalTone {
  if (value == null) return "neutral";
  if (value < 0) return "red";
  if (value < 10) return "amber";
  return "emerald";
}

function contactDisplayName(contact: IntelliDealerAccountSummary["contacts"][number]): string {
  return [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.email || contact.cell || contact.direct_phone || contact.phone || "Unnamed contact";
}

function buildIntelliDealerNextAction(
  data: IntelliDealerAccountSummary,
  total: IntelliDealerAccountSummary["profitability"][number] | null,
  activeAgencies: IntelliDealerAccountSummary["arAgencies"],
  defaultAgency: IntelliDealerAccountSummary["arAgencies"][number] | null,
): { title: string; detail: string; tone: SignalTone } {
  if (data.company?.do_not_contact) {
    return {
      title: "Respect contact hold",
      detail: "Source account is marked do not contact.",
      tone: "red",
    };
  }

  if (total?.ytd_margin_pct != null && total.ytd_margin_pct < 10) {
    return {
      title: "Review margin",
      detail: "Margin is below the operating threshold before quote follow-up.",
      tone: total.ytd_margin_pct < 0 ? "red" : "amber",
    };
  }

  if (data.contacts.length === 0 || data.contacts.every((contact) => !contact.email && !contact.cell && !contact.direct_phone && !contact.phone)) {
    return {
      title: "Clean contact data",
      detail: "Imported account has weak reachable-contact coverage.",
      tone: "amber",
    };
  }

  if (!defaultAgency || activeAgencies.length > 10) {
    return {
      title: "Validate A/R setup",
      detail: "Confirm default agency and active agency count before account activity.",
      tone: "sky",
    };
  }

  return {
    title: "Run account review",
    detail: "Use imported profitability, contacts, and credit signals together.",
    tone: "emerald",
  };
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "—";
  return `$${Math.round(value).toLocaleString()}`;
}

function formatShortDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function monthLabel(month: number | null | undefined): string | null {
  if (!month || month < 1 || month > 12) return null;
  return new Date(2026, month - 1, 1).toLocaleString("en-US", { month: "long" });
}

async function createCommercialDraft(input: {
  scenario: "trade_up" | "custom";
  companyId: string;
  equipmentId?: string;
  context: Record<string, unknown>;
  tone?: "urgent" | "consultative" | "friendly";
}) {
  const session = (await supabase.auth.getSession()).data.session;
  const res = await fetch(`${DRAFT_EMAIL_URL}/draft`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session?.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      scenario: input.scenario,
      company_id: input.companyId,
      equipment_id: input.equipmentId,
      context: input.context,
      tone: input.tone ?? "consultative",
      persist: true,
    }),
  });
  if (!res.ok) throw new Error("Draft failed");
  return res.json();
}

export function AccountCommercialTab({
  data,
  companyId,
}: {
  data: Account360Response;
  companyId: string;
}) {
  const fleetRadarQuery = useQuery({
    queryKey: ["fleet-radar", companyId, "commercial-tab"],
    queryFn: () => fetchFleetRadar(companyId),
    staleTime: 60_000,
  });

  const equipmentQuery = useQuery({
    queryKey: ["qrm", "company-equipment", companyId, "commercial-tab"],
    queryFn: () => fetchCompanyEquipment(companyId),
    staleTime: 60_000,
  });

  const draftMutation = useMutation({
    mutationFn: (input: Parameters<typeof createCommercialDraft>[0]) => createCommercialDraft(input),
  });

  const tradeUpTarget: FleetRadarLensItem | null =
    fleetRadarQuery.data?.trade_up?.[0]
    ?? fleetRadarQuery.data?.aging?.[0]
    ?? null;

  const openServiceJobs = data.service.filter((sj) => !["closed", "invoiced", "cancelled"].includes(sj.current_stage));
  const serviceRisk = openServiceJobs.length > 0
    ? `${openServiceJobs.length} open service job${openServiceJobs.length === 1 ? "" : "s"}`
    : "No active service risk";

  const companyEquipment = (equipmentQuery.data ?? []) as QrmEquipment[];
  const warrantyTarget = companyEquipment.find((item) => {
    if (!item.warrantyExpiresOn) return false;
    const expiry = new Date(item.warrantyExpiresOn);
    if (Number.isNaN(expiry.getTime())) return false;
    return expiry.getTime() <= Date.now() + 90 * 86_400_000;
  }) ?? null;

  const recentPartOrder = data.parts.recent[0] ?? null;
  const lastRepTouch = formatShortDate(data.profile?.last_interaction_at);
  const budgetCycle = monthLabel(data.profile?.budget_cycle_month);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card className="p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Budget cycle</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{budgetCycle ?? "Not captured"}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Last rep touch</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{lastRepTouch ?? "No recent touch logged"}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Open quotes</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{data.open_quotes.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Service / downtime risk</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{serviceRisk}</p>
        </Card>
      </div>

      <Card className="p-4 space-y-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Trade-up score reason</p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {tradeUpTarget
              ? `${tradeUpTarget.name} · ${tradeUpTarget.reason}`
              : "No high-priority trade-up signal yet"}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            size="sm"
            variant="outline"
            disabled={draftMutation.isPending || !tradeUpTarget}
            onClick={() =>
              tradeUpTarget && draftMutation.mutate({
                scenario: "trade_up",
                companyId,
                equipmentId: tradeUpTarget.id,
                context: {
                  equipment_name: tradeUpTarget.name,
                  make: tradeUpTarget.make,
                  model: tradeUpTarget.model,
                  year: tradeUpTarget.year,
                  engine_hours: tradeUpTarget.engine_hours,
                  reason: tradeUpTarget.reason,
                  trade_up_score: tradeUpTarget.trade_up_score,
                  budget_cycle_month: data.profile?.budget_cycle_month ?? null,
                },
                tone: "consultative",
              })}
          >
            {draftMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Mail className="mr-1 h-3 w-3" />}
            Draft trade-up
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={draftMutation.isPending || openServiceJobs.length === 0}
            onClick={() =>
              openServiceJobs[0] && draftMutation.mutate({
                scenario: "custom",
                companyId,
                context: {
                  category: "service_follow_up",
                  service_job_summary: openServiceJobs[0].customer_problem_summary,
                  current_stage: openServiceJobs[0].current_stage,
                  scheduled_end_at: openServiceJobs[0].scheduled_end_at,
                  service_job_count: openServiceJobs.length,
                },
                tone: "consultative",
              })}
          >
            {draftMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Mail className="mr-1 h-3 w-3" />}
            Draft service follow-up
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={draftMutation.isPending || !recentPartOrder}
            onClick={() =>
              recentPartOrder && draftMutation.mutate({
                scenario: "custom",
                companyId,
                context: {
                  category: "parts_reorder",
                  last_parts_order_id: recentPartOrder.id,
                  last_parts_order_total: recentPartOrder.total,
                  lifetime_parts_spend: data.parts.lifetime_total,
                  parts_order_count: data.parts.order_count,
                },
                tone: "friendly",
              })}
          >
            {draftMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Mail className="mr-1 h-3 w-3" />}
            Draft parts reorder
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={draftMutation.isPending || !warrantyTarget}
            onClick={() =>
              warrantyTarget && draftMutation.mutate({
                scenario: "custom",
                companyId,
                equipmentId: warrantyTarget.id,
                context: {
                  category: "warranty_follow_up",
                  equipment_name: warrantyTarget.name,
                  make: warrantyTarget.make,
                  model: warrantyTarget.model,
                  warranty_expires_on: warrantyTarget.warrantyExpiresOn,
                  next_service_due_at: warrantyTarget.nextServiceDueAt,
                },
                tone: "friendly",
              })}
          >
            {draftMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Shield className="mr-1 h-3 w-3" />}
            Draft warranty follow-up
          </Button>
        </div>
        {draftMutation.isSuccess && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs text-emerald-400">
            Draft created. Review it in <Link to="/email-drafts" className="underline">Email Drafts</Link>.
          </div>
        )}
        {draftMutation.isError && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-400">
            {(draftMutation.error as Error).message}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Commercial context</p>
        <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div>
            <span className="text-foreground font-medium">Lifetime value:</span> {formatCurrency(data.profile?.lifetime_value ?? null)}
          </div>
          <div>
            <span className="text-foreground font-medium">Total deals:</span> {data.profile?.total_deals ?? "—"}
          </div>
          <div>
            <span className="text-foreground font-medium">Top quote:</span> {data.open_quotes[0] ? `${data.open_quotes[0].deal_name ?? "Untitled"} · ${formatCurrency(data.open_quotes[0].net_total)}` : "No open quote"}
          </div>
          <div>
            <span className="text-foreground font-medium">Parts trend:</span> {data.parts.order_count > 0 ? `${data.parts.order_count} orders / ${formatCurrency(data.parts.lifetime_total)}` : "No parts activity"}
          </div>
        </div>
      </Card>
    </div>
  );
}
