import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  fetchPublicDealRoom,
  type DealRoomBranch,
  type DealRoomFinanceScenario,
  type DealRoomPayload,
  type DealRoomQuote,
} from "../lib/deal-room-api";

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
  const scenarios = (quote.financing_scenarios ?? []).filter((s) =>
    s.type !== "cash"
    || (s.monthly_payment ?? null) != null
    || (s.term_months ?? 0) > 0
    || ((s.rate ?? s.apr ?? 0) > 0),
  );
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
  const selectedFinance = useMemo(() => pickSelectedFinance(quote), [quote]);
  const otherFinance = (quote.financing_scenarios ?? [])
    .filter((s) => s !== selectedFinance)
    .filter((s) =>
      s.type !== "cash"
      || (s.monthly_payment ?? null) != null
      || (s.term_months ?? 0) > 0
      || ((s.rate ?? s.apr ?? 0) > 0),
    )
    .slice(0, 2);
  const refBadge = referenceBadge(quote);
  const preparedDate = formatDate(quote.created_at) || formatDate(quote.updated_at);
  const displayCustomer = quote.customer_name?.trim() || quote.customer_company?.trim() || "Customer";

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
          <PricingSummary quote={quote} />
          <FinancingPanel selected={selectedFinance} others={otherFinance} />
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

function PricingSummary({ quote }: { quote: DealRoomQuote }) {
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
  const amountFinancedLabel = (quote.amount_financed ?? 0) > 0 ? "Amount financed" : "Customer total";
  const amountFinancedValue = (quote.amount_financed ?? 0) > 0
    ? quote.amount_financed ?? 0
    : quote.customer_total ?? 0;
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
        {(quote.cash_down ?? 0) > 0 && (
          <Row label="Cash down" value={`-${formatCurrency(quote.cash_down ?? 0)}`} tone="credit" />
        )}
        <Row label={amountFinancedLabel} value={formatCurrency(amountFinancedValue)} tone="total" />
      </div>
    </div>
  );
}

function FinancingPanel({
  selected, others,
}: {
  selected: DealRoomFinanceScenario | null;
  others: DealRoomFinanceScenario[];
}) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
        Recommended payment
      </div>
      {selected ? (
        <div className="mt-3 rounded-xl border-2 border-[#E87722] bg-[#fff7ed] px-6 py-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#E87722]">
            {selected.label ?? selected.type}
          </div>
          <div className="mt-1.5 flex items-baseline gap-1 text-4xl font-extrabold tracking-tight tabular-nums text-slate-900">
            {formatCurrency(selected.monthly_payment ?? 0)}
            <span className="text-base font-medium text-slate-500">/mo</span>
          </div>
          <div className="mt-1 text-xs text-slate-600">
            {selected.term_months ?? 0} months
            {" · "}
            {((selected.rate ?? selected.apr ?? 0)).toFixed(2)}% APR
            {" · Total "}
            {formatCurrency(selected.total_cost ?? 0)}
          </div>
          {selected.lender && (
            <div className="mt-0.5 text-[11px] italic text-slate-400">via {selected.lender}</div>
          )}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-[13px] text-slate-500">
          No financing option selected. Contact your rep to structure payment terms.
        </div>
      )}
      {others.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            Also available
          </div>
          {others.map((s, i) => (
            <div key={i} className="flex items-center justify-between border-b border-slate-100 py-2.5 last:border-0">
              <div>
                <div className="text-[13px] font-semibold text-slate-900">{s.label ?? s.type}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {s.term_months ?? 0} mo
                  {" · "}{((s.rate ?? s.apr ?? 0)).toFixed(2)}% APR
                  {s.lender ? ` · ${s.lender}` : ""}
                </div>
              </div>
              <div className="text-base font-bold tabular-nums">
                {formatCurrency(s.monthly_payment ?? 0)}
                <span className="ml-0.5 text-[11px] font-medium text-slate-500">/mo</span>
              </div>
            </div>
          ))}
        </div>
      )}
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
