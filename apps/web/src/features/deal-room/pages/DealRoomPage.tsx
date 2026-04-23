import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  fetchPublicDealRoom,
  type DealRoomBranch,
  type DealRoomFinanceScenario,
  type DealRoomPayload,
  type DealRoomQuote,
} from "../lib/deal-room-api";
import {
  computePaymentFor,
  filterDisplayableScenarios,
  scenarioKey,
  type ComputedPayment,
} from "../lib/financing-math";

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

export function DealRoomPage() {
  const { token = "" } = useParams<{ token: string }>();
  const { data, isLoading, isError, error } = useQuery<DealRoomPayload>({
    queryKey: ["deal-room", token],
    queryFn: () => fetchPublicDealRoom(token),
    enabled: token.length > 0,
    staleTime: 30_000,
    retry: false,
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

function DealRoomView({ payload }: { payload: DealRoomPayload }) {
  const { quote, branch } = payload;
  const [hero, ...rest] = quote.equipment ?? [];
  const attachments = quote.attachments_included ?? [];
  const displayableScenarios = useMemo(
    () => filterDisplayableScenarios(quote.financing_scenarios ?? []),
    [quote.financing_scenarios],
  );
  const initialScenario = useMemo(() => pickSelectedFinance(quote), [quote]);

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

  const computed = useMemo<ComputedPayment | null>(() => {
    if (!activeScenario) return null;
    return computePaymentFor(quote, activeScenario, {
      cashDown,
      termMonths,
      scenarioKey: selectedKey,
    });
  }, [quote, activeScenario, cashDown, termMonths, selectedKey]);

  const refBadge = referenceBadge(quote);
  const preparedDate = formatDate(quote.created_at) || formatDate(quote.updated_at);
  const displayCustomer = quote.customer_name?.trim() || quote.customer_company?.trim() || "Customer";
  const customerTotal = quote.customer_total ?? 0;

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
            reasoning={quote.ai_recommendation?.reasoning ?? null}
          />
        )}
        {rest.length + attachments.length > 0 && (
          <AdditionalItems equipment={rest} attachments={attachments} />
        )}
        <div className="mt-9 grid gap-5 sm:grid-cols-[1.15fr_1fr]">
          <PricingSummary quote={quote} cashDownOverride={cashDown} computed={computed} />
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

function HeroMachine({ line, reasoning }: {
  line: DealRoomQuote["equipment"][number];
  reasoning: string | null;
}) {
  const title = [line.make, line.model].filter(Boolean).join(" ") || line.title || "Equipment";
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
            Why this machine
          </span>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{reasoning}</p>
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
