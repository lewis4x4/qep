import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  acceptPublicQuote,
  fetchPublicDealRoom,
  fetchPublicDealRoomAttachments,
  fetchPublicSocialProof,
  fetchPublicTradeEstimate,
  type DealRoomBranch,
  type DealRoomCompatibleAttachment,
  type DealRoomFinanceScenario,
  type DealRoomPayload,
  type DealRoomQuote,
  type SocialProofPayload,
  type TradeEstimatePayload,
} from "../lib/deal-room-api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  computePaymentFor,
  filterDisplayableScenarios,
  scenarioKey,
  type ComputedPayment,
} from "../lib/financing-math";
import { ConciergeChat } from "../components/ConciergeChat";

function formatCurrency(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function referenceBadge(quote: DealRoomQuote): string {
  if (quote.quote_number?.trim()) return quote.quote_number.trim();
  const compact = (quote.id ?? "").replace(/-/g, "").slice(0, 8).toUpperCase();
  return compact ? `QEP-${compact}` : "QEP Proposal";
}

function pickSelectedFinance(quote: DealRoomQuote): DealRoomFinanceScenario | null {
  const scenarios = filterDisplayableScenarios(quote.financing_scenarios ?? []);
  if (scenarios.length === 0) return null;
  const selected = quote.selected_finance_scenario?.trim();
  return scenarios.find((s) => s.label === selected) ?? scenarios[0] ?? null;
}

// Statuses that indicate the rep / manager are mid-loop; polling on
// these auto-refreshes the deal room so the customer sees transitions
// (approval, changes_requested → sent) without manual reload. Terminal
// states (accepted, rejected, expired) stop polling to save cost.
const TRANSIENT_STATUSES = new Set([
  "pending_approval",
  "changes_requested",
  "approved_with_conditions",
]);

export function DealRoomPage() {
  const { token = "" } = useParams<{ token: string }>();
  const { data, isLoading, isError, error } = useQuery<DealRoomPayload>({
    queryKey: ["deal-room", token],
    queryFn: () => fetchPublicDealRoom(token),
    enabled: token.length > 0,
    staleTime: 30_000,
    retry: false,
    // Only poll while the rep-side approval loop is live. 15s keeps the
    // page feeling responsive without hammering the edge function.
    refetchInterval: (query) => {
      const status = (query.state.data?.quote?.status ?? "") as string;
      return TRANSIENT_STATUSES.has(status) ? 15_000 : false;
    },
    refetchIntervalInBackground: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white text-slate-900 flex items-center justify-center">
        <div className="text-sm text-slate-500">Loading proposal…</div>
      </div>
    );
  }

  if (isError || !data) {
    const msg = error instanceof Error ? error.message : "Proposal unavailable";
    return (
      <div className="min-h-screen bg-white text-slate-900 flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Proposal unavailable</h1>
          <p className="mt-2 text-sm text-slate-500">
            {msg === "Quote not found"
              ? "This link is no longer active. Please contact your sales representative for a new one."
              : msg}
          </p>
        </div>
      </div>
    );
  }

  return <DealRoomView payload={data} />;
}

interface ConfiguratorOption {
  key: string;
  name: string;
  price: number;
  source: "included" | "catalog";
  category: string | null;
  universal: boolean;
}

function DealRoomView({ payload }: { payload: DealRoomPayload }) {
  const { token = "" } = useParams<{ token: string }>();
  const { quote, branch } = payload;
  const [hero, ...rest] = quote.equipment ?? [];
  const includedAttachments = quote.attachments_included ?? [];
  const displayableScenarios = useMemo(
    () => filterDisplayableScenarios(quote.financing_scenarios ?? []),
    [quote.financing_scenarios],
  );
  const initialScenario = useMemo(() => pickSelectedFinance(quote), [quote]);

  // Compatible-attachments lookup. Fires in parallel with the main quote
  // fetch; silently no-ops when the quote's primary equipment is not a
  // catalog-matched model (rep typed a free-text machine), in which case
  // the configurator falls back to just the rep-included attachments.
  const attachmentsQuery = useQuery({
    queryKey: ["deal-room", token, "attachments"],
    queryFn: () => fetchPublicDealRoomAttachments(token),
    enabled: token.length > 0,
    staleTime: 60_000,
    retry: false,
  });
  const compatibleAttachments: DealRoomCompatibleAttachment[] = attachmentsQuery.data?.attachments ?? [];

  // Merge rep-included + catalog-compatible into a single option list,
  // deduped on name so a catalog match for an included attachment
  // collapses to one row (with price preferring the saved quote value).
  const configuratorOptions: ConfiguratorOption[] = useMemo(() => {
    const byKey = new Map<string, ConfiguratorOption>();
    for (const row of includedAttachments) {
      const name = (row.name ?? "").trim();
      if (!name) continue;
      const key = `inc:${name.toLowerCase()}`;
      byKey.set(key, {
        key,
        name,
        price: row.price ?? 0,
        source: "included",
        category: null,
        universal: false,
      });
    }
    for (const att of compatibleAttachments) {
      const name = (att.name ?? "").trim();
      if (!name) continue;
      const dedupeKey = `inc:${name.toLowerCase()}`;
      if (byKey.has(dedupeKey)) {
        // Already in — keep the included price and mark that the catalog
        // knows about it (no visible change, but future slices may want
        // the id for accept/save).
        continue;
      }
      const key = att.id ? `cat:${att.id}` : `catname:${name.toLowerCase()}`;
      byKey.set(key, {
        key,
        name,
        price: att.price ?? 0,
        source: "catalog",
        category: att.category,
        universal: att.universal,
      });
    }
    return Array.from(byKey.values());
  }, [includedAttachments, compatibleAttachments]);

  // Customer's selection — pre-check everything the rep already included,
  // leave catalog-only options unchecked. Re-seeds when the underlying
  // option list shifts (e.g. attachment fetch resolves after first render).
  const defaultSelected = useMemo(
    () => new Set(configuratorOptions.filter((o) => o.source === "included").map((o) => o.key)),
    [configuratorOptions],
  );
  const [selectedAttachments, setSelectedAttachments] = useState<Set<string>>(defaultSelected);
  useEffect(() => {
    setSelectedAttachments(defaultSelected);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote.id, attachmentsQuery.dataUpdatedAt]);

  const toggleAttachment = (key: string) => {
    setSelectedAttachments((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Running attachment total drives the Commercial Summary + Net + Total
  // below, so a toggle here lights up the numbers everywhere on the
  // page without touching the quote persistence layer.
  const chosenAttachmentTotal = useMemo(
    () => configuratorOptions
      .filter((o) => selectedAttachments.has(o.key))
      .reduce((sum, o) => sum + (o.price ?? 0), 0),
    [configuratorOptions, selectedAttachments],
  );

  // Customer-driven financing inputs — the deal room's decision rails.
  // Seeded from the saved quote so the first render matches the PDF,
  // then the customer can tweak in place without a round trip.
  const [selectedKey, setSelectedKey] = useState<string>(
    initialScenario ? scenarioKey(initialScenario) : (displayableScenarios[0] ? scenarioKey(displayableScenarios[0]) : ""),
  );
  const [cashDown, setCashDown] = useState<number>(quote.cash_down ?? 0);
  const [termMonths, setTermMonths] = useState<number>(
    initialScenario?.term_months ?? displayableScenarios[0]?.term_months ?? 60,
  );

  // If the fetched quote changes (e.g. react-query refetch), resync so
  // we don't strand stale state against a newer payload.
  useEffect(() => {
    if (!initialScenario) return;
    setSelectedKey(scenarioKey(initialScenario));
    setTermMonths(initialScenario.term_months ?? 60);
    setCashDown(quote.cash_down ?? 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote.id]);

  const activeScenario = displayableScenarios.find((s) => scenarioKey(s) === selectedKey)
    ?? initialScenario
    ?? displayableScenarios[0]
    ?? null;

  // Customer-applied trade credit. Seeds from whatever the rep included,
  // overrides on "Apply" from the trade estimator.
  const [tradeCredit, setTradeCredit] = useState<number>(quote.trade_credit ?? 0);
  useEffect(() => {
    setTradeCredit(quote.trade_credit ?? 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote.id]);

  // Adjusted quote reflects the customer's live choices: attachment
  // configurator flips attachment_total + the trade estimator flips
  // trade_credit, both rippling through subtotal / net_total /
  // customer_total so every downstream surface (pricing summary,
  // financing math, slider cap) sees the same number.
  const attachmentDelta = chosenAttachmentTotal - (quote.attachment_total ?? 0);
  const tradeDelta = tradeCredit - (quote.trade_credit ?? 0);
  const adjustedQuote = useMemo<DealRoomQuote>(() => {
    const subtotal = (quote.subtotal ?? 0) + attachmentDelta;
    // Trade credit reduces net_total + customer_total; the rep-side
    // math on quote_packages treats trade as a credit line, so we
    // subtract the delta on top of the attachment shift.
    const net = (quote.net_total ?? 0) + attachmentDelta - tradeDelta;
    const customerTotal = (quote.customer_total ?? 0) + attachmentDelta - tradeDelta;
    return {
      ...quote,
      attachment_total: chosenAttachmentTotal,
      trade_credit: tradeCredit,
      subtotal,
      net_total: net,
      customer_total: customerTotal,
      amount_financed: Math.max(0, customerTotal - cashDown),
    };
  }, [quote, chosenAttachmentTotal, attachmentDelta, tradeCredit, tradeDelta, cashDown]);

  const computed = useMemo<ComputedPayment | null>(() => {
    if (!activeScenario) return null;
    return computePaymentFor(adjustedQuote, activeScenario, {
      cashDown,
      termMonths,
      scenarioKey: selectedKey,
    });
  }, [adjustedQuote, activeScenario, cashDown, termMonths, selectedKey]);

  const refBadge = referenceBadge(quote);
  const preparedDate = formatDate(quote.created_at) || formatDate(quote.updated_at);
  const displayCustomer = quote.customer_name?.trim() || quote.customer_company?.trim() || "Customer";
  const customerTotal = adjustedQuote.customer_total ?? 0;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-4xl px-6 py-10 sm:px-10 sm:py-14">
        <BrandMasthead branch={branch} />
        <Hero
          customer={displayCustomer}
          preparedDate={preparedDate}
          refBadge={refBadge}
        />
        {hero && (
          <HeroMachine
            line={hero}
            recommendation={quote.ai_recommendation}
          />
        )}
        {quote.ai_recommendation && (
          <WhyThisMachine recommendation={quote.ai_recommendation} />
        )}
        <SocialProofPanel token={token} primaryPrice={hero?.price ?? null} />
        {rest.length + includedAttachments.length > 0 && (
          <AdditionalItems equipment={rest} attachments={includedAttachments} />
        )}
        {configuratorOptions.length > 0 && (
          <ConfiguratorPanel
            options={configuratorOptions}
            selected={selectedAttachments}
            onToggle={toggleAttachment}
            attachmentTotal={chosenAttachmentTotal}
          />
        )}
        <TradeEstimatorPanel
          token={token}
          currentCredit={tradeCredit}
          onApply={setTradeCredit}
        />
        <ApprovalStatusBanner status={quote.status} />
        <AcceptPanel
          token={token}
          quote={adjustedQuote}
          customerHint={displayCustomer}
          scenarioKey={selectedKey}
          computed={computed}
          cashDown={cashDown}
          termMonths={termMonths}
          tradeCredit={tradeCredit}
          configuratorSelections={configuratorOptions
            .filter((o) => selectedAttachments.has(o.key))
            .map((o) => ({ key: o.key, name: o.name, price: o.price }))}
        />
        <div className="mt-9 grid gap-5 sm:grid-cols-[1.15fr_1fr]">
          <PricingSummary quote={adjustedQuote} cashDownOverride={cashDown} computed={computed} />
          <FinancingPanel
            scenarios={displayableScenarios}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            termMonths={termMonths}
            onTermChange={setTermMonths}
            cashDown={cashDown}
            onCashDownChange={setCashDown}
            customerTotal={customerTotal}
            computed={computed}
          />
        </div>
        <RepContact branch={branch} />
        <Footer branch={branch} refBadge={refBadge} />
      </div>
      <ConciergeChat
        token={token}
        repName={branch?.name ?? null}
        repEmail={branch?.email ?? null}
        repPhone={branch?.phone ?? null}
      />
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function BrandMasthead({ branch }: { branch: DealRoomBranch | null }) {
  const b = branch ?? {};
  const address = [b.address_line1, b.city, b.state, b.postal_code].filter(Boolean).join(", ");
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b-4 border-[#E87722] pb-5">
      <div>
        <div className="text-[22px] font-extrabold leading-tight text-[#E87722]">
          {b.name || "Quality Equipment & Parts"}
        </div>
        <div className="mt-0.5 text-[11px] uppercase tracking-[0.08em] text-slate-500">
          Equipment · Parts · Rental · Service
        </div>
      </div>
      <div className="text-right text-xs leading-relaxed text-slate-600">
        {address && <div>{address}</div>}
        {b.phone && <div className="font-semibold text-slate-900">{b.phone}</div>}
        {b.email && <div>{b.email}</div>}
        {b.website && <div>{b.website}</div>}
      </div>
    </header>
  );
}

function Hero({ customer, preparedDate, refBadge }: {
  customer: string; preparedDate: string; refBadge: string;
}) {
  return (
    <section className="mt-9 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="m-0 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-[40px]">
          Equipment Proposal
        </h1>
        <p className="mt-1.5 text-lg font-medium text-slate-900">Prepared for {customer}</p>
        {preparedDate && <p className="mt-0.5 text-[13px] text-slate-500">{preparedDate}</p>}
      </div>
      <span className="inline-flex items-center rounded-full border border-[#E87722] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#E87722]">
        {refBadge}
      </span>
    </section>
  );
}

function HeroMachine({ line, recommendation }: {
  line: DealRoomQuote["equipment"][number];
  recommendation: DealRoomQuote["ai_recommendation"];
}) {
  const title = [line.make, line.model].filter(Boolean).join(" ") || line.title || "Equipment";
  const reasoning = recommendation?.reasoning ?? null;
  return (
    <section className="mt-8 grid gap-7 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 p-7 text-slate-100 sm:grid-cols-[1.4fr_1fr]">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#E87722]">
          Recommended configuration
        </div>
        <h2 className="mt-1.5 text-[28px] font-extrabold leading-tight tracking-tight text-white">
          {title}
        </h2>
        {line.year && (
          <div className="mt-1.5 text-sm text-slate-300">Model year {line.year}</div>
        )}
        <div className="mt-4 text-[32px] font-extrabold tracking-tight text-[#E87722]">
          {formatCurrency(line.price ?? 0)}
        </div>
      </div>
      {reasoning && (
        <div>
          <span className="inline-block text-[10px] font-bold uppercase tracking-[0.12em] text-[#E87722]">
            Why this machine for you
          </span>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{reasoning}</p>
        </div>
      )}
    </section>
  );
}

function WhyThisMachine({
  recommendation,
}: {
  recommendation: NonNullable<DealRoomQuote["ai_recommendation"]>;
}) {
  const facts = recommendation.jobFacts ?? [];
  const highlights = recommendation.transcriptHighlights ?? [];
  const considerations = recommendation.jobConsiderations ?? [];
  const alt = recommendation.alternative ?? null;
  const hasAnything = facts.length + highlights.length + considerations.length > 0 || alt;
  if (!hasAnything) return null;

  return (
    <section className="mt-8 grid gap-6 rounded-2xl border border-slate-200 p-6 sm:grid-cols-2 sm:p-7">
      {facts.length > 0 && (
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            Your job, as we heard it
          </div>
          <dl className="mt-3 space-y-2.5">
            {facts.map((fact, i) => (
              <div key={i} className="flex justify-between gap-4 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                <dt className="text-[13px] text-slate-500">{fact.label}</dt>
                <dd className="text-[13px] font-semibold text-slate-900 text-right">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {highlights.length > 0 && (
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            Grounded in your intake
          </div>
          <ul className="mt-3 space-y-3">
            {highlights.map((h, i) => (
              <li key={i} className="border-l-2 border-[#E87722] pl-3">
                <blockquote className="text-[13px] italic leading-relaxed text-slate-900">
                  “{h.quote}”
                </blockquote>
                <div className="mt-0.5 text-[11px] uppercase tracking-[0.08em] text-slate-500">
                  {h.supports}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {considerations.length > 0 && (
        <div className={facts.length + highlights.length === 0 ? "sm:col-span-2" : ""}>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            Worth knowing
          </div>
          <ul className="mt-3 space-y-2 text-[13px] text-slate-700">
            {considerations.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 rounded-full bg-[#E87722]" />
                <span className="flex-1 leading-relaxed">{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {alt?.machine && (
        <div className="sm:col-span-2 rounded-xl bg-slate-50 p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            Also considered
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-3">
            <h3 className="text-lg font-bold text-slate-900">{alt.machine}</h3>
            {alt.attachments && alt.attachments.length > 0 && (
              <span className="text-[12px] text-slate-500">
                {alt.attachments.filter((a): a is string => typeof a === "string").join(", ")}
              </span>
            )}
          </div>
          {alt.reasoning && (
            <p className="mt-2 text-[13px] leading-relaxed text-slate-700">{alt.reasoning}</p>
          )}
          {alt.whyNotChosen && (
            <div className="mt-3 border-t border-slate-200 pt-3">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                Why we led with the primary
              </span>
              <p className="mt-1 text-[13px] leading-relaxed text-slate-700">{alt.whyNotChosen}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function AdditionalItems({
  equipment, attachments,
}: {
  equipment: DealRoomQuote["equipment"];
  attachments: DealRoomQuote["attachments_included"];
}) {
  const rows: Array<{ label: string; detail: string | null; amount: number }> = [
    ...equipment.map((item) => ({
      label: [item.make, item.model].filter(Boolean).join(" ") || item.title || "Equipment",
      detail: item.year ? `Model year ${item.year}` : null,
      amount: item.price ?? 0,
    })),
    ...attachments.map((item) => ({
      label: item.name ?? "Attachment",
      detail: "Attachment",
      amount: item.price ?? 0,
    })),
  ];
  if (rows.length === 0) return null;
  return (
    <section className="mt-6">
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
        Additional line items
      </div>
      <table className="mt-3 w-full border-collapse">
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0">
              <td className="py-3">
                <div className="text-sm font-semibold text-slate-900">{row.label}</div>
                {row.detail && <div className="text-xs text-slate-500">{row.detail}</div>}
              </td>
              <td className="py-3 text-right text-sm font-semibold tabular-nums">
                {formatCurrency(row.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function PricingSummary({
  quote, cashDownOverride, computed,
}: {
  quote: DealRoomQuote;
  cashDownOverride: number;
  computed: ComputedPayment | null;
}) {
  const Row = ({ label, value, tone = "base" }: {
    label: string; value: string; tone?: "base" | "credit" | "net" | "total";
  }) => {
    const emphasis = tone === "net" || tone === "total";
    const orange = tone === "total";
    const green = tone === "credit";
    return (
      <div className={`flex justify-between tabular-nums ${emphasis ? "border-t border-slate-200 pt-3 mt-2.5 text-base font-bold" : "py-1.5 text-[13px] text-slate-600"}`}>
        <span>{label}</span>
        <span className={orange ? "text-[#E87722] text-xl font-extrabold" : green ? "text-emerald-600" : "text-slate-900"}>
          {value}
        </span>
      </div>
    );
  };
  // When the customer drags the cash-down slider, the row below reflects
  // their number, not the saved one. Likewise the financed total is the
  // live computed value from the scenario math.
  const cashDown = cashDownOverride;
  const amountFinanced = computed?.amountFinanced ?? (quote.amount_financed ?? 0);
  const amountFinancedLabel = amountFinanced > 0 ? "Amount financed" : "Customer total";
  const amountFinancedValue = amountFinanced > 0 ? amountFinanced : (quote.customer_total ?? 0);
  return (
    <div className="rounded-xl border border-slate-200 p-5 sm:p-6">
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
        Commercial summary
      </div>
      <div className="mt-3">
        <Row label="Equipment total" value={formatCurrency(quote.equipment_total ?? 0)} />
        {(quote.attachment_total ?? 0) > 0 && (
          <Row label="Attachments" value={formatCurrency(quote.attachment_total ?? 0)} />
        )}
        <Row label="Subtotal" value={formatCurrency(quote.subtotal ?? 0)} />
        {(quote.discount_total ?? 0) > 0 && (
          <Row label="Commercial discount" value={`-${formatCurrency(quote.discount_total ?? 0)}`} tone="credit" />
        )}
        {(quote.trade_credit ?? 0) > 0 && (
          <Row label="Trade-in allowance" value={`-${formatCurrency(quote.trade_credit ?? 0)}`} tone="credit" />
        )}
        <Row label="Net before tax" value={formatCurrency(quote.net_total ?? 0)} tone="net" />
        <Row label="Estimated tax" value={formatCurrency(quote.tax_total ?? 0)} />
        {cashDown > 0 && (
          <Row label="Cash down" value={`-${formatCurrency(cashDown)}`} tone="credit" />
        )}
        <Row label={amountFinancedLabel} value={formatCurrency(amountFinancedValue)} tone="total" />
      </div>
    </div>
  );
}

// Decision-rail term presets. Most equipment loans are 36/48/60/72/84; we
// surface a broad-but-finite list so the customer can see how the payment
// moves without typing a free number. When the selected scenario already
// sits on a term not in the preset list, we inject it so the dropdown
// always reflects the current selection.
const TERM_PRESETS = [24, 36, 48, 60, 72, 84];

function FinancingPanel({
  scenarios,
  selectedKey,
  onSelect,
  termMonths,
  onTermChange,
  cashDown,
  onCashDownChange,
  customerTotal,
  computed,
}: {
  scenarios: DealRoomFinanceScenario[];
  selectedKey: string;
  onSelect: (key: string) => void;
  termMonths: number;
  onTermChange: (value: number) => void;
  cashDown: number;
  onCashDownChange: (value: number) => void;
  customerTotal: number;
  computed: ComputedPayment | null;
}) {
  // Cap the slider at the customer total — down payment can never exceed
  // the amount due. Step in hundreds so the slider feels precise without
  // being twitchy for $50k+ deals.
  const cashMax = Math.max(0, Math.round(customerTotal));
  const cashStep = cashMax >= 50_000 ? 500 : cashMax >= 10_000 ? 100 : 50;
  const termOptions = Array.from(new Set([...TERM_PRESETS, termMonths])).sort((a, b) => a - b);
  const activeIsCash = computed?.isCash ?? false;

  if (scenarios.length === 0) {
    return (
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
          Recommended payment
        </div>
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-[13px] text-slate-500">
          No financing option selected. Contact your rep to structure payment terms.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
        Recommended payment
      </div>

      {/* Scenario tabs — one per financing option the rep attached. */}
      {scenarios.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Financing options">
          {scenarios.map((s) => {
            const key = scenarioKey(s);
            const active = key === selectedKey;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={active}
                onClick={() => onSelect(key)}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] transition ${
                  active
                    ? "border-[#E87722] bg-[#fff7ed] text-[#E87722]"
                    : "border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                {s.label ?? s.type}
              </button>
            );
          })}
        </div>
      )}

      {/* Live monthly-payment card — re-renders on every input change. */}
      <div className="mt-3 rounded-xl border-2 border-[#E87722] bg-[#fff7ed] px-6 py-5">
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#E87722]">
          {computed?.scenario.label ?? computed?.scenario.type ?? "Payment"}
        </div>
        {activeIsCash ? (
          <>
            <div className="mt-1.5 flex items-baseline gap-1 text-4xl font-extrabold tracking-tight tabular-nums text-slate-900">
              {formatCurrency(computed?.totalCost ?? 0)}
            </div>
            <div className="mt-1 text-xs text-slate-600">Paid at close</div>
          </>
        ) : (
          <>
            <div className="mt-1.5 flex items-baseline gap-1 text-4xl font-extrabold tracking-tight tabular-nums text-slate-900">
              {formatCurrency(computed?.monthlyPayment ?? 0)}
              <span className="text-base font-medium text-slate-500">/mo</span>
            </div>
            <div className="mt-1 text-xs text-slate-600">
              {termMonths} months
              {" · "}
              {((computed?.scenario.rate ?? computed?.scenario.apr ?? 0)).toFixed(2)}% APR
              {" · Total "}
              {formatCurrency(computed?.totalCost ?? 0)}
            </div>
            {computed?.scenario.lender && (
              <div className="mt-0.5 text-[11px] italic text-slate-400">via {computed.scenario.lender}</div>
            )}
          </>
        )}
      </div>

      {/* Decision rails — cash-down slider and term selector. */}
      <div className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
        <div>
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
            <span>Cash down</span>
            <span className="tabular-nums text-slate-900">{formatCurrency(cashDown, 0)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={cashMax}
            step={cashStep}
            value={Math.min(cashDown, cashMax)}
            onChange={(e) => onCashDownChange(Number(e.target.value))}
            aria-label="Cash down"
            className="mt-2 w-full accent-[#E87722]"
          />
          <div className="mt-1 flex justify-between text-[10px] text-slate-400">
            <span>$0</span>
            <span>{formatCurrency(cashMax, 0)}</span>
          </div>
        </div>
        {!activeIsCash && (
          <div>
            <label className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
              <span>Term length</span>
              <select
                value={termMonths}
                onChange={(e) => onTermChange(Number(e.target.value))}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[13px] font-medium normal-case text-slate-900 tracking-normal"
                aria-label="Term length in months"
              >
                {termOptions.map((n) => (
                  <option key={n} value={n}>{n} months</option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

function ConfiguratorPanel({
  options, selected, onToggle, attachmentTotal,
}: {
  options: ConfiguratorOption[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  attachmentTotal: number;
}) {
  // Group by category so the customer scans the configurator by job
  // function (buckets, mowers, grapples) instead of one long list.
  const grouped = useMemo(() => {
    const map = new Map<string, ConfiguratorOption[]>();
    for (const opt of options) {
      const group = opt.source === "included" ? "Included by your rep" : (opt.category?.trim() || "Other attachments");
      const bucket = map.get(group) ?? [];
      bucket.push(opt);
      map.set(group, bucket);
    }
    // "Included by your rep" first, then rest alphabetically.
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "Included by your rep") return -1;
      if (b === "Included by your rep") return 1;
      return a.localeCompare(b);
    });
  }, [options]);

  return (
    <section className="mt-9">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            Configure your package
          </div>
          <p className="mt-1 text-sm text-slate-700">
            Toggle attachments to see the price move in real time. Nothing is committed until you accept.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Attachments total</div>
          <div className="text-xl font-extrabold tabular-nums text-slate-900">
            {formatCurrency(attachmentTotal, 0)}
          </div>
        </div>
      </div>
      <div className="mt-4 space-y-5">
        {grouped.map(([group, items]) => (
          <div key={group}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
              {group}
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {items.map((opt) => {
                const active = selected.has(opt.key);
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => onToggle(opt.key)}
                    aria-pressed={active}
                    className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition ${
                      active
                        ? "border-[#E87722] bg-[#fff7ed]"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${
                          active ? "border-[#E87722] bg-[#E87722]" : "border-slate-300 bg-white"
                        }`}
                        aria-hidden
                      >
                        {active && (
                          <span className="block h-1.5 w-1.5 rounded-sm bg-white" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{opt.name}</div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {opt.universal ? "Universal mount" : opt.category ?? (opt.source === "included" ? "Included" : "Compatible")}
                        </div>
                      </div>
                    </div>
                    <div className="whitespace-nowrap text-sm font-bold tabular-nums text-slate-900">
                      {opt.price > 0 ? `+${formatCurrency(opt.price, 0)}` : "Included"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TradeEstimatorPanel({
  token, currentCredit, onApply,
}: {
  token: string;
  currentCredit: number;
  onApply: (credit: number) => void;
}) {
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState<string>("");
  const [hours, setHours] = useState<string>("");

  const mutation = useMutation<TradeEstimatePayload>({
    mutationFn: () => fetchPublicTradeEstimate(token, {
      make: make.trim(),
      model: model.trim(),
      year: year.trim() ? Number(year) : null,
      hours: hours.trim() ? Number(hours) : null,
    }),
  });

  const canSubmit = make.trim().length >= 2 && model.trim().length >= 1 && !mutation.isPending;
  const result = mutation.data ?? null;
  const errorMessage = mutation.isError
    ? (mutation.error instanceof Error ? mutation.error.message : "Estimate unavailable")
    : null;

  return (
    <section className="mt-9 rounded-2xl border border-slate-200 p-6 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            Have a trade?
          </div>
          <p className="mt-1 text-sm text-slate-700">
            Tell us what you're running now and we'll pull a live range from recent comps + auction data.
            Applying it updates your financed amount in real time.
          </p>
        </div>
        {currentCredit > 0 && (
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Applied credit</div>
            <div className="text-lg font-extrabold tabular-nums text-emerald-600">
              −{formatCurrency(currentCredit, 0)}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Make</span>
          <input
            type="text"
            value={make}
            onChange={(e) => setMake(e.target.value)}
            placeholder="e.g. Case"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Model</span>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. SR175"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Year</span>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            min={1990}
            max={new Date().getFullYear()}
            placeholder="2018"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Hours</span>
          <input
            type="number"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            min={0}
            placeholder="3200"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => mutation.mutate()}
          className="rounded-lg bg-[#E87722] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {mutation.isPending ? "Pulling comps…" : "Estimate trade value"}
        </button>
        {errorMessage && (
          <span className="text-xs text-rose-500">{errorMessage}</span>
        )}
      </div>

      {result && result.status === "no_data" && (
        <div className="mt-5 rounded-lg bg-slate-50 px-4 py-3 text-[13px] text-slate-600">
          {result.message}
        </div>
      )}

      {result && result.status === "ok" && (
        <div className="mt-5 rounded-xl bg-emerald-50 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-700">
                Estimated value range
              </div>
              <div className="mt-1 text-[13px] text-emerald-900">
                <span className="font-bold tabular-nums">{formatCurrency(result.range.low, 0)}</span>
                <span className="text-emerald-600"> — </span>
                <span className="font-bold tabular-nums">{formatCurrency(result.range.high, 0)}</span>
                <span className="ml-2 text-[11px] text-emerald-600">
                  {result.comps} comp source{result.comps === 1 ? "" : "s"}
                  {result.hoursAdjustment !== 0 && (
                    <> · hours adjustment {result.hoursAdjustment > 0 ? "+" : ""}{Math.round(result.hoursAdjustment * 100)}%</>
                  )}
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">
                Suggested credit
              </div>
              <div className="text-2xl font-extrabold tabular-nums text-emerald-900">
                {formatCurrency(result.suggestedCredit, 0)}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onApply(result.suggestedCredit)}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
            >
              Apply to this quote
            </button>
            {currentCredit > 0 && (
              <button
                type="button"
                onClick={() => onApply(0)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Clear
              </button>
            )}
            <div className="ml-auto text-[11px] italic text-emerald-700">
              Final credit is confirmed by your rep after in-person inspection.
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function SocialProofPanel({ token, primaryPrice }: { token: string; primaryPrice: number | null }) {
  // Social proof loads in parallel with the main quote fetch; silently
  // hides if neither dataset has enough comps to be meaningful.
  const { data } = useQuery<SocialProofPayload>({
    queryKey: ["deal-room", token, "social-proof"],
    queryFn: () => fetchPublicSocialProof(token),
    enabled: token.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  if (!data || (!data.deals && !data.resale)) return null;

  return (
    <section className="mt-8 grid gap-4 sm:grid-cols-2">
      {data.deals && (
        <div className="rounded-xl border border-slate-200 p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            Deal velocity
          </div>
          <div className="mt-2 text-3xl font-extrabold tabular-nums text-slate-900">
            {data.deals.count}
          </div>
          <div className="mt-1 text-[13px] text-slate-600">
            customers chose this model in the last {Math.round(data.deals.timespan_days / 30)} months
            {data.deals.median_customer_total != null && (
              <> · median deal {formatCurrency(data.deals.median_customer_total, 0)}</>
            )}
          </div>
        </div>
      )}
      {data.resale && (
        <div className="rounded-xl border border-slate-200 p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            Market resale
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <div className="text-3xl font-extrabold tabular-nums text-slate-900">
              {formatCurrency(data.resale.median_price, 0)}
            </div>
            {data.resale.retention_pct_vs_primary != null && primaryPrice && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                {data.resale.retention_pct_vs_primary}% retention
              </span>
            )}
          </div>
          <div className="mt-1 text-[13px] text-slate-600">
            median used auction price across {data.resale.count} recent sales
          </div>
        </div>
      )}
    </section>
  );
}

interface StatusDisplay {
  tone: "pending" | "caution" | "conditional" | "neutral" | "success";
  title: string;
  body: string;
}

function describeApprovalStatus(status: string): StatusDisplay | null {
  switch (status) {
    case "pending_approval":
      return {
        tone: "pending",
        title: "Waiting on manager approval",
        body: "Your rep submitted this proposal for manager sign-off. This page updates automatically the moment a decision lands — typically within 15 minutes during business hours.",
      };
    case "approved_with_conditions":
      return {
        tone: "conditional",
        title: "Approved with conditions",
        body: "Your rep's manager cleared this pricing with a few conditions attached. Contact your rep to review them before you sign.",
      };
    case "changes_requested":
      return {
        tone: "caution",
        title: "Changes requested",
        body: "Your rep's manager asked for adjustments before this can ship. Your rep will send an updated proposal shortly — this page will refresh automatically.",
      };
    case "rejected":
      return {
        tone: "caution",
        title: "Proposal paused",
        body: "This configuration wasn't approved. Reach out to your rep to rework the terms.",
      };
    case "expired":
      return {
        tone: "neutral",
        title: "This proposal has expired",
        body: "Prices and availability change — contact your rep for a fresh proposal.",
      };
    default:
      return null;
  }
}

function ApprovalStatusBanner({ status }: { status: string }) {
  const display = describeApprovalStatus(status);
  if (!display) return null;
  const toneClasses: Record<StatusDisplay["tone"], string> = {
    pending: "border-amber-300 bg-amber-50 text-amber-900",
    caution: "border-rose-300 bg-rose-50 text-rose-900",
    conditional: "border-blue-300 bg-blue-50 text-blue-900",
    neutral: "border-slate-200 bg-slate-50 text-slate-700",
    success: "border-emerald-300 bg-emerald-50 text-emerald-900",
  };
  const pulseDot: Record<StatusDisplay["tone"], string> = {
    pending: "bg-amber-500",
    caution: "bg-rose-500",
    conditional: "bg-blue-500",
    neutral: "bg-slate-400",
    success: "bg-emerald-500",
  };
  return (
    <section className={`mt-9 rounded-2xl border-2 p-6 ${toneClasses[display.tone]}`} aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="relative mt-1.5 flex h-2.5 w-2.5 shrink-0">
          {display.tone === "pending" && (
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${pulseDot[display.tone]}`} />
          )}
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${pulseDot[display.tone]}`} />
        </span>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.12em]">
            {display.title}
          </div>
          <p className="mt-1 text-sm leading-relaxed">{display.body}</p>
        </div>
      </div>
    </section>
  );
}

function AcceptPanel({
  token,
  quote,
  customerHint,
  scenarioKey: selectedScenarioKey,
  computed,
  cashDown,
  termMonths,
  tradeCredit,
  configuratorSelections,
}: {
  token: string;
  quote: DealRoomQuote;
  customerHint: string;
  scenarioKey: string;
  computed: ComputedPayment | null;
  cashDown: number;
  termMonths: number;
  tradeCredit: number;
  configuratorSelections: Array<{ key: string; name: string; price: number }>;
}) {
  const [signerName, setSignerName] = useState(customerHint === "Customer" ? "" : customerHint);
  const queryClient = useQueryClient();

  // Quote-status-based affordance: already-accepted quotes render the
  // confirmation state instead of the Accept button. Rep-driven flows
  // (pending_approval, changes_requested, rejected) lock out accept
  // so the customer can't commit against a stale price.
  const currentStatus = quote.status;
  const alreadyAccepted = ["accepted", "converted_to_deal"].includes(currentStatus);
  const lockedStatuses = new Set([
    "pending_approval",
    "changes_requested",
    "rejected",
    "expired",
    "archived",
  ]);
  const locked = lockedStatuses.has(currentStatus);

  const acceptMutation = useMutation({
    mutationFn: () => {
      const configuration: Record<string, unknown> = {
        quote_id: quote.id,
        customer_total: quote.customer_total ?? 0,
        amount_financed: computed?.amountFinanced ?? quote.amount_financed ?? 0,
        monthly_payment: computed?.monthlyPayment ?? 0,
        scenario_key: selectedScenarioKey,
        scenario_label: computed?.scenario.label ?? null,
        term_months: termMonths,
        cash_down: cashDown,
        trade_credit: tradeCredit,
        attachments: configuratorSelections,
      };
      // QEP's workflow doesn't require a customer signature — the
      // accept is a non-binding "yes, move forward" indication. The
      // binding paperwork happens offline with the rep. Server-side
      // still records signer_name + a blank signature_data_url so the
      // existing accept endpoint shape stays compatible.
      return acceptPublicQuote(token, {
        signerName: signerName.trim() || (customerHint === "Customer" ? "Customer" : customerHint),
        signerEmail: null,
        signatureDataUrl: "data:image/png;base64,",
        customerConfiguration: configuration,
      });
    },
    onSuccess: () => {
      // Invalidate the deal-room read so the page flips to the
      // accepted state without a manual refresh.
      queryClient.invalidateQueries({ queryKey: ["deal-room", token] });
    },
  });

  if (alreadyAccepted) {
    return (
      <section className="mt-9 rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">
              Proposal accepted
            </div>
            <p className="mt-1 text-sm text-emerald-900">
              Your rep has been notified. They'll reach out to confirm delivery, paperwork, and next steps.
            </p>
          </div>
          <div className="rounded-full bg-emerald-600 px-4 py-1 text-xs font-bold uppercase tracking-[0.08em] text-white">
            Accepted
          </div>
        </div>
      </section>
    );
  }

  if (locked) {
    return (
      <section className="mt-9 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
        This proposal is in <strong>{currentStatus.replace(/_/g, " ")}</strong> status. Contact your rep for next steps.
      </section>
    );
  }

  return (
    <section className="mt-9 rounded-2xl border-2 border-[#E87722] bg-[#fff7ed] p-6 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#E87722]">
            Ready to move forward?
          </div>
          <p className="mt-1 text-sm text-slate-800">
            Tap Accept to let your rep know you want to proceed. They'll reach out to finalize paperwork, delivery, and any remaining details.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm sm:max-w-xs"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => acceptMutation.mutate()}
          disabled={!signerName.trim() || acceptMutation.isPending}
          className="rounded-lg bg-[#E87722] px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-[#d06a1e] disabled:opacity-40"
        >
          {acceptMutation.isPending ? "Recording…" : "Accept this proposal"}
        </button>
      </div>
      {acceptMutation.isError && (
        <div className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
          {acceptMutation.error instanceof Error ? acceptMutation.error.message : "Couldn't record acceptance."}
        </div>
      )}
    </section>
  );
}

function RepContact({ branch }: { branch: DealRoomBranch | null }) {
  const b = branch ?? {};
  if (!b.phone && !b.email) return null;
  return (
    <section className="mt-9 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-slate-50 px-6 py-5">
      <div>
        <div className="text-sm font-bold text-slate-900">{b.name || "Your sales rep"}</div>
        <div className="mt-0.5 text-xs text-slate-500">
          Your {b.name ? `${b.name} ` : ""}sales representative
        </div>
      </div>
      <div className="text-right text-xs leading-relaxed text-slate-600">
        {b.phone && (
          <div><a className="text-[#E87722] no-underline" href={`tel:${b.phone}`}>{b.phone}</a></div>
        )}
        {b.email && (
          <div><a className="text-[#E87722] no-underline" href={`mailto:${b.email}`}>{b.email}</a></div>
        )}
      </div>
    </section>
  );
}

function Footer({ branch, refBadge }: { branch: DealRoomBranch | null; refBadge: string }) {
  const footerText = branch?.doc_footer_text
    || "Valid 30 days from preparation. Prices subject to change; all equipment subject to prior sale.";
  return (
    <footer className="mt-11 flex flex-wrap justify-between gap-4 border-t border-slate-200 pt-5 text-[11px] text-slate-400">
      <div>{footerText}</div>
      <div className="tracking-wide">Ref {refBadge}</div>
    </footer>
  );
}
