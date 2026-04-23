import type { QuotePDFData } from "../components/QuotePDFDocument";

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatCurrencyCompact(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// Non-cash-placeholder financing options only. Cash-with-zero data is a UI
// artifact from scenario prefill; excluding it keeps the proposal honest.
function printableFinancingOptions(data: QuotePDFData): QuotePDFData["financing"] {
  return data.financing.filter((option) =>
    option.type !== "cash" ||
    (option.monthlyPayment ?? null) != null ||
    (option.termMonths ?? 0) > 0 ||
    ((option.rate ?? 0) > 0),
  );
}

// Short, human-readable reference code for the footer. We don't want the
// raw deal UUID shouted on page 1 — it's noise. If the quote has a real
// quote number, use it; otherwise derive an 8-char token from the deal id.
function buildReferenceBadge(data: QuotePDFData): string {
  if (data.quoteNumber && data.quoteNumber.trim()) return data.quoteNumber.trim();
  const source = data.dealName || "";
  const compact = source.replace(/-/g, "").slice(0, 8).toUpperCase();
  return compact ? `QEP-${compact}` : "QEP Proposal";
}

export function buildPrintableQuoteHtml(data: QuotePDFData): string {
  const address = [data.branch.address, data.branch.city, data.branch.state, data.branch.postalCode]
    .filter(Boolean)
    .join(", ");
  const financingOptions = printableFinancingOptions(data);
  const selectedFinancing = financingOptions.find((o) => data.selectedFinancingLabel && o.label === data.selectedFinancingLabel)
    ?? financingOptions[0]
    ?? null;
  const otherFinancing = financingOptions.filter((o) => o !== selectedFinancing).slice(0, 2);
  const referenceBadge = buildReferenceBadge(data);
  // The primary equipment line is the "hero" of the proposal — shown
  // large with price front and center. Anything beyond the first row is
  // rendered as secondary line items. Empty / zero-priced lines still
  // render so the customer sees exactly what the rep sent.
  const [hero, ...additionalEquipment] = data.equipment;

  const additionalEquipmentRows = [
    ...additionalEquipment.map((item) => ({
      label: `${item.make} ${item.model}`.trim() || "Equipment",
      detail: item.year ? `Model year ${item.year}` : null,
      amount: item.price,
    })),
    ...data.attachments.map((item) => ({
      label: item.name,
      detail: "Attachment",
      amount: item.price,
    })),
  ];

  const additionalRowsHtml = additionalEquipmentRows.map((row) => `
    <tr>
      <td>
        <div class="line-label">${escapeHtml(row.label)}</div>
        ${row.detail ? `<div class="line-detail">${escapeHtml(row.detail)}</div>` : ""}
      </td>
      <td class="amount">${escapeHtml(formatCurrency(row.amount))}</td>
    </tr>
  `).join("");

  const selectedFinancingHtml = selectedFinancing ? `
    <div class="hero-finance">
      <div class="hero-finance-label">${escapeHtml(selectedFinancing.label ?? selectedFinancing.type)}</div>
      <div class="hero-finance-payment">
        ${escapeHtml(formatCurrency(selectedFinancing.monthlyPayment ?? 0))}
        <span class="hero-finance-period">/mo</span>
      </div>
      <div class="hero-finance-meta">
        ${escapeHtml(selectedFinancing.termMonths ?? 0)} months
        · ${escapeHtml((selectedFinancing.rate ?? 0).toFixed(2))}% APR
        · Total ${escapeHtml(formatCurrency(selectedFinancing.totalCost ?? 0))}
      </div>
      ${selectedFinancing.lender ? `<div class="hero-finance-lender">via ${escapeHtml(selectedFinancing.lender)}</div>` : ""}
    </div>
  ` : "";

  const otherFinancingHtml = otherFinancing.length > 0 ? `
    <div class="alt-finance">
      <div class="section-label">Also available</div>
      ${otherFinancing.map((option) => `
        <div class="alt-finance-row">
          <div>
            <div class="alt-finance-label">${escapeHtml(option.label ?? option.type)}</div>
            <div class="alt-finance-meta">
              ${escapeHtml(option.termMonths ?? 0)} mo
              · ${escapeHtml((option.rate ?? 0).toFixed(2))}% APR
              ${option.lender ? `· ${escapeHtml(option.lender)}` : ""}
            </div>
          </div>
          <div class="alt-finance-amount">${escapeHtml(formatCurrency(option.monthlyPayment ?? 0))}<span class="alt-finance-period">/mo</span></div>
        </div>
      `).join("")}
    </div>
  ` : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(`Proposal for ${data.customerName}`)}</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        margin: 0;
        color: #0f172a;
        background: #fff;
        line-height: 1.5;
        -webkit-font-smoothing: antialiased;
      }
      .page { max-width: 820px; margin: 0 auto; padding: 48px 56px 72px; }

      /* ── Masthead ───────────────────────────────────────────────── */
      .masthead {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding-bottom: 20px;
        border-bottom: 3px solid #E87722;
      }
      .brand-mark {
        font-size: 22px;
        font-weight: 800;
        letter-spacing: -0.01em;
        color: #E87722;
        text-transform: none;
      }
      .brand-tagline {
        font-size: 11px;
        color: #64748b;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-top: 2px;
      }
      .brand-meta {
        font-size: 12px;
        color: #475569;
        text-align: right;
        line-height: 1.6;
      }
      .brand-meta strong { color: #0f172a; font-weight: 600; }

      /* ── Hero ───────────────────────────────────────────────────── */
      .hero {
        margin-top: 36px;
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        gap: 24px;
      }
      .hero h1 {
        font-size: 40px;
        font-weight: 800;
        letter-spacing: -0.02em;
        margin: 0 0 6px;
        color: #0f172a;
      }
      .hero-customer {
        font-size: 18px;
        color: #0f172a;
        margin: 0;
        font-weight: 500;
      }
      .hero-date {
        font-size: 13px;
        color: #64748b;
        margin: 2px 0 0;
      }
      .reference-badge {
        display: inline-flex;
        align-items: center;
        padding: 6px 12px;
        border: 1px solid #E87722;
        border-radius: 999px;
        color: #E87722;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        white-space: nowrap;
      }

      /* ── Hero machine card ─────────────────────────────────────── */
      .hero-machine {
        margin-top: 32px;
        padding: 28px;
        border-radius: 16px;
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
        color: #f8fafc;
        display: grid;
        grid-template-columns: 1.4fr 1fr;
        gap: 28px;
      }
      .hero-machine-meta {
        font-size: 11px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #E87722;
        margin-bottom: 6px;
      }
      .hero-machine-title {
        font-size: 28px;
        font-weight: 800;
        letter-spacing: -0.015em;
        margin: 0;
        line-height: 1.15;
      }
      .hero-machine-sub {
        font-size: 13px;
        color: #cbd5e1;
        margin-top: 6px;
      }
      .hero-machine-price {
        font-size: 32px;
        font-weight: 800;
        color: #E87722;
        margin-top: 18px;
        letter-spacing: -0.02em;
      }
      .hero-machine-ai {
        font-size: 13px;
        color: #cbd5e1;
        line-height: 1.55;
      }
      .hero-machine-ai-label {
        display: inline-block;
        font-size: 10px;
        font-weight: 700;
        color: #E87722;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        margin-bottom: 6px;
      }

      /* ── Section ───────────────────────────────────────────────── */
      .section-label {
        font-size: 11px;
        font-weight: 700;
        color: #64748b;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        margin: 0 0 12px;
      }
      .split { display: grid; grid-template-columns: 1.15fr 1fr; gap: 24px; margin-top: 36px; }
      .card {
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 22px 24px;
        background: #fff;
      }

      /* ── Line items (additional equipment) ─────────────────────── */
      .lines { margin-top: 24px; }
      .lines table { width: 100%; border-collapse: collapse; }
      .lines td {
        padding: 12px 0;
        border-bottom: 1px solid #f1f5f9;
        vertical-align: top;
      }
      .line-label { font-weight: 600; font-size: 14px; color: #0f172a; }
      .line-detail { font-size: 12px; color: #64748b; margin-top: 2px; }
      .amount {
        text-align: right;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
        font-weight: 600;
      }

      /* ── Pricing card ──────────────────────────────────────────── */
      .pricing-row {
        display: flex;
        justify-content: space-between;
        padding: 6px 0;
        font-size: 13px;
        color: #475569;
        font-variant-numeric: tabular-nums;
      }
      .pricing-row span:last-child { color: #0f172a; }
      .pricing-row.net,
      .pricing-row.total {
        border-top: 1px solid #e2e8f0;
        margin-top: 10px;
        padding-top: 12px;
        font-size: 16px;
        font-weight: 700;
      }
      .pricing-row.total span:last-child { color: #E87722; font-size: 20px; }
      .pricing-row.credit span:last-child { color: #059669; }

      /* ── Financing ─────────────────────────────────────────────── */
      .hero-finance {
        border-radius: 12px;
        background: #fff7ed;
        border: 2px solid #E87722;
        padding: 20px 22px;
      }
      .hero-finance-label {
        font-size: 11px;
        font-weight: 700;
        color: #E87722;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        margin-bottom: 6px;
      }
      .hero-finance-payment {
        font-size: 36px;
        font-weight: 800;
        color: #0f172a;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
      }
      .hero-finance-period {
        font-size: 16px;
        font-weight: 500;
        color: #64748b;
      }
      .hero-finance-meta {
        font-size: 12px;
        color: #475569;
        margin-top: 4px;
      }
      .hero-finance-lender {
        font-size: 11px;
        color: #94a3b8;
        margin-top: 2px;
        font-style: italic;
      }
      .alt-finance { margin-top: 18px; }
      .alt-finance-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 0;
        border-bottom: 1px solid #f1f5f9;
      }
      .alt-finance-label { font-size: 13px; font-weight: 600; }
      .alt-finance-meta { font-size: 11px; color: #64748b; margin-top: 2px; }
      .alt-finance-amount {
        font-size: 16px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .alt-finance-period { font-size: 11px; font-weight: 500; color: #64748b; }

      /* ── Rep contact ───────────────────────────────────────────── */
      .contact {
        margin-top: 36px;
        padding: 20px 24px;
        border-radius: 12px;
        background: #f8fafc;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 24px;
      }
      .contact-name {
        font-size: 15px;
        font-weight: 700;
        color: #0f172a;
      }
      .contact-role {
        font-size: 12px;
        color: #64748b;
        margin-top: 2px;
      }
      .contact-meta {
        font-size: 12px;
        color: #475569;
        text-align: right;
        line-height: 1.6;
      }
      .contact-meta a { color: #E87722; text-decoration: none; }

      /* ── Footer ────────────────────────────────────────────────── */
      .footer {
        margin-top: 44px;
        padding-top: 20px;
        border-top: 1px solid #e2e8f0;
        font-size: 11px;
        color: #94a3b8;
        display: flex;
        justify-content: space-between;
        gap: 16px;
      }
      .footer-ref { letter-spacing: 0.04em; }

      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .page { padding: 28px 40px; max-width: none; }
        .hero { margin-top: 24px; }
        .hero-machine { margin-top: 22px; }
        .split { margin-top: 24px; page-break-inside: avoid; }
        .contact { page-break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <header class="masthead">
        <div>
          <div class="brand-mark">${escapeHtml(data.branch.name || "Quality Equipment & Parts")}</div>
          <div class="brand-tagline">Equipment · Parts · Rental · Service</div>
        </div>
        <div class="brand-meta">
          ${address ? `<div>${escapeHtml(address)}</div>` : ""}
          ${data.branch.phone ? `<div><strong>${escapeHtml(data.branch.phone)}</strong></div>` : ""}
          ${data.branch.email ? `<div>${escapeHtml(data.branch.email)}</div>` : ""}
          ${data.branch.website ? `<div>${escapeHtml(data.branch.website)}</div>` : ""}
        </div>
      </header>

      <section class="hero">
        <div>
          <h1>Equipment Proposal</h1>
          <p class="hero-customer">Prepared for ${escapeHtml(data.customerName)}</p>
          <p class="hero-date">${escapeHtml(data.preparedDate)} · Prepared by ${escapeHtml(data.preparedBy)}</p>
        </div>
        <span class="reference-badge">${escapeHtml(referenceBadge)}</span>
      </section>

      ${hero ? `
        <section class="hero-machine">
          <div>
            <div class="hero-machine-meta">Recommended configuration</div>
            <h2 class="hero-machine-title">${escapeHtml(`${hero.make} ${hero.model}`.trim() || "Equipment")}</h2>
            ${hero.year ? `<div class="hero-machine-sub">Model year ${escapeHtml(hero.year)}</div>` : ""}
            <div class="hero-machine-price">${escapeHtml(formatCurrency(hero.price))}</div>
          </div>
          ${data.aiRecommendationSummary ? `
            <div>
              <span class="hero-machine-ai-label">Why this machine</span>
              <div class="hero-machine-ai">${escapeHtml(data.aiRecommendationSummary)}</div>
            </div>
          ` : ""}
        </section>
      ` : ""}

      ${additionalRowsHtml ? `
        <section class="lines">
          <div class="section-label">Additional line items</div>
          <table><tbody>${additionalRowsHtml}</tbody></table>
        </section>
      ` : ""}

      <section class="split">
        <div class="card">
          <div class="section-label">Commercial summary</div>
          <div class="pricing-row"><span>Equipment total</span><span>${escapeHtml(formatCurrency(data.equipmentTotal))}</span></div>
          ${data.attachmentTotal > 0 ? `<div class="pricing-row"><span>Attachments</span><span>${escapeHtml(formatCurrency(data.attachmentTotal))}</span></div>` : ""}
          <div class="pricing-row"><span>Subtotal</span><span>${escapeHtml(formatCurrency(data.subtotal))}</span></div>
          ${data.discountTotal > 0 ? `<div class="pricing-row credit"><span>Commercial discount</span><span>-${escapeHtml(formatCurrency(data.discountTotal))}</span></div>` : ""}
          ${data.tradeAllowance > 0 ? `<div class="pricing-row credit"><span>Trade-in allowance</span><span>-${escapeHtml(formatCurrency(data.tradeAllowance))}</span></div>` : ""}
          <div class="pricing-row net"><span>Net before tax</span><span>${escapeHtml(formatCurrency(data.netTotal))}</span></div>
          <div class="pricing-row"><span>Estimated tax</span><span>${escapeHtml(formatCurrency(data.taxTotal))}</span></div>
          ${data.cashDown > 0 ? `<div class="pricing-row credit"><span>Cash down</span><span>-${escapeHtml(formatCurrency(data.cashDown))}</span></div>` : ""}
          <div class="pricing-row total"><span>${data.amountFinanced > 0 ? "Amount financed" : "Customer total"}</span><span>${escapeHtml(formatCurrency(data.amountFinanced > 0 ? data.amountFinanced : data.customerTotal))}</span></div>
        </div>

        <div>
          <div class="section-label">Recommended payment</div>
          ${selectedFinancingHtml || `
            <div class="card" style="padding:20px;color:#64748b;font-size:13px;">
              No financing option selected. Contact your rep to structure payment terms.
            </div>
          `}
          ${otherFinancingHtml}
        </div>
      </section>

      <section class="contact">
        <div>
          <div class="contact-name">${escapeHtml(data.preparedBy)}</div>
          <div class="contact-role">Your ${escapeHtml(data.branch.name || "QEP")} sales representative</div>
        </div>
        <div class="contact-meta">
          ${data.branch.phone ? `<div><a href="tel:${escapeHtml(data.branch.phone)}">${escapeHtml(data.branch.phone)}</a></div>` : ""}
          ${data.branch.email ? `<div><a href="mailto:${escapeHtml(data.branch.email)}">${escapeHtml(data.branch.email)}</a></div>` : ""}
        </div>
      </section>

      <footer class="footer">
        <div>
          ${escapeHtml(data.branch.footerText || "Valid 30 days from preparation. Prices subject to change; all equipment subject to prior sale.")}
        </div>
        <div class="footer-ref">Ref ${escapeHtml(referenceBadge)}</div>
      </footer>
    </div>
  </body>
</html>`;
}

export async function openPrintableQuoteSheet(data: QuotePDFData): Promise<void> {
  if (typeof document === "undefined") {
    throw new Error("Printable quote is only available in the browser.");
  }

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) {
      throw new Error("Could not open a printable quote preview.");
    }

    doc.open();
    doc.write(buildPrintableQuoteHtml(data));
    doc.close();

    await new Promise((resolve) => window.setTimeout(resolve, 150));
    win.focus();
    win.print();
  } finally {
    window.setTimeout(() => {
      iframe.remove();
    }, 1_000);
  }
}
