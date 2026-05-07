import type { QuotePDFData, QuoteProposalLine } from "../components/QuotePDFDocument";
import { isDisplayableProposalFinanceScenario } from "./quote-proposal-data";

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCurrency(amount: number | null | undefined): string {
  const safe = Number.isFinite(amount ?? NaN) ? Number(amount) : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

function printableFinancingOptions(data: QuotePDFData): QuotePDFData["financing"] {
  return data.financing.filter(isDisplayableProposalFinanceScenario).slice(0, 3);
}

function buildReferenceBadge(data: QuotePDFData): string {
  if (data.quoteNumber && data.quoteNumber.trim()) return data.quoteNumber.trim();
  const source = data.dealName || "";
  const compact = source.replace(/-/g, "").slice(0, 8).toUpperCase();
  return compact ? `QEP-${compact}` : "QEP Proposal";
}

function selectedTotal(data: QuotePDFData): number {
  return data.compliance.primaryTotalLabel === "Amount financed" ? data.amountFinanced : data.customerTotal;
}

function renderLineAmount(line: QuoteProposalLine): string {
  const amount = formatCurrency(line.displayAmount);
  return line.tone === "credit" ? `-${amount}` : amount;
}

function buildLineRows(lines: QuoteProposalLine[]): string {
  return lines.map((line) => `
    <tr>
      <td>
        <div class="line-label">${escapeHtml(line.description)}</div>
        <div class="line-detail">${escapeHtml(line.lineType.replace(/_/g, " "))}${line.reasonCode ? ` · ${escapeHtml(line.reasonCode.replace(/_/g, " "))}` : ""}</div>
      </td>
      <td class="qty">${escapeHtml(line.quantity)}</td>
      <td class="amount">${escapeHtml(formatCurrency(line.unitPrice))}</td>
      <td class="amount">${escapeHtml(formatCurrency(line.extendedPrice))}</td>
      <td class="amount ${line.tone === "credit" ? "credit" : ""}">${escapeHtml(renderLineAmount(line))}</td>
    </tr>
  `).join("");
}

function buildSelectedFinancingHtml(option: QuotePDFData["financing"][number] | null): string {
  if (!option) {
    return `
      <div class="card muted-card">
        No payment scenario selected. Contact your QEP representative to structure cash, finance, or lease terms.
      </div>
    `;
  }
  const isCash = option.type === "cash" || option.kind === "cash";
  const payment = isCash
    ? (option.totalCost != null ? formatCurrency(option.totalCost) : "Cash purchase")
    : option.monthlyPayment != null ? `${formatCurrency(option.monthlyPayment)}<span>/mo</span>` : "Estimate pending";
  return `
    <div class="hero-finance">
      <div class="hero-finance-label">${escapeHtml(option.label ?? option.type)} · selected</div>
      <div class="hero-finance-payment">${payment}</div>
      <div class="hero-finance-meta">
        Term: ${escapeHtml(option.termMonths != null ? `${option.termMonths} months` : "TBD")}
        · Rate/APR: ${escapeHtml(option.rate != null ? `${option.rate.toFixed(2)}%` : "subject to approval")}
        ${option.totalCost != null ? `· Est. total ${escapeHtml(formatCurrency(option.totalCost))}` : ""}
      </div>
      ${option.downPayment != null ? `<div class="hero-finance-lender">Down payment ${escapeHtml(formatCurrency(option.downPayment))}</div>` : ""}
      ${option.lender ? `<div class="hero-finance-lender">via ${escapeHtml(option.lender)}</div>` : ""}
    </div>
  `;
}

function buildOtherFinancingHtml(options: QuotePDFData["financing"]): string {
  if (options.length === 0) return "";
  return `
    <div class="alt-finance">
      <div class="section-label">Additional payment scenarios</div>
      ${options.map((option) => `
        <div class="alt-finance-row">
          <div>
            <div class="alt-finance-label">${escapeHtml(option.label ?? option.type)}</div>
            <div class="alt-finance-meta">
              ${escapeHtml(option.termMonths != null ? `${option.termMonths} mo` : "Term TBD")}
              · ${escapeHtml(option.rate != null ? `${option.rate.toFixed(2)}% APR` : "rate subject to approval")}
              ${option.lender ? `· ${escapeHtml(option.lender)}` : ""}
            </div>
          </div>
          <div class="alt-finance-amount">${option.monthlyPayment != null ? `${escapeHtml(formatCurrency(option.monthlyPayment))}<span>/mo</span>` : escapeHtml(option.totalCost != null ? formatCurrency(option.totalCost) : "TBD")}</div>
        </div>
      `).join("")}
    </div>
  `;
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
  const heroTitle = data.primaryMachineTitle || (data.equipment[0] ? `${data.equipment[0].make ?? ""} ${data.equipment[0].model ?? ""}`.trim() : "Equipment configuration");
  const lineRowsHtml = buildLineRows(data.lineItems);
  const factsHtml = data.narrative.confirmed && data.narrative.facts.length > 0 ? `
    <div class="supporting-card">
      <div class="section-label">Intake facts</div>
      ${data.narrative.facts.slice(0, 4).map((fact) => `<p><strong>${escapeHtml(fact.label)}:</strong> ${escapeHtml(fact.value)}</p>`).join("")}
    </div>
  ` : "";
  const highlightsHtml = data.narrative.confirmed && data.narrative.highlights.length > 0 ? `
    <div class="supporting-card">
      <div class="section-label">Customer signals</div>
      ${data.narrative.highlights.slice(0, 2).map((item) => `<p>${escapeHtml(item.supports)}</p>`).join("")}
    </div>
  ` : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(`${referenceBadge} proposal for ${data.customerName}`)}</title>
    <style>
      :root {
        color-scheme: light;
        --orange: #F28A07;
        --charcoal: #111111;
        --surface: #1a1a1a;
        --surface-2: #242424;
        --gear-gray: #BFBFBF;
        --muted: #707070;
        --paper: #f7f4ef;
        --green: #0f7a3a;
      }
      * { box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        margin: 0;
        color: var(--surface);
        background: #fff;
        line-height: 1.5;
        -webkit-font-smoothing: antialiased;
      }
      .page { max-width: 920px; margin: 0 auto; padding: 44px 56px 72px; }
      .masthead {
        background: var(--charcoal);
        color: white;
        border-bottom: 5px solid var(--orange);
        margin: -44px -56px 40px;
        padding: 30px 56px;
        display: flex;
        justify-content: space-between;
        gap: 28px;
      }
      .brand-mark { font-size: 24px; font-weight: 850; letter-spacing: -0.01em; }
      .brand-rule { width: 64px; height: 3px; background: var(--orange); margin: 10px 0; }
      .brand-tagline { color: var(--gear-gray); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; }
      .brand-meta { color: var(--gear-gray); font-size: 12px; text-align: right; line-height: 1.6; }
      .brand-meta strong { color: #fff; }
      .hero { display: grid; grid-template-columns: 1.4fr 0.85fr; gap: 32px; align-items: stretch; }
      .kicker { color: var(--orange); font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; font-size: 11px; }
      h1 { color: var(--charcoal); font-size: 44px; line-height: 1.02; letter-spacing: -0.035em; margin: 10px 0 18px; }
      .hero p { margin: 5px 0; color: var(--muted); }
      .reference-badge { display: inline-flex; color: var(--orange); border: 1px solid var(--orange); border-radius: 999px; padding: 7px 12px; font-size: 11px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; margin-top: 14px; }
      .metric-card { background: var(--charcoal); color: white; padding: 24px; border-radius: 2px; }
      .metric-label { color: var(--gear-gray); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; }
      .metric-value { color: var(--orange); font-size: 34px; font-weight: 850; letter-spacing: -0.03em; margin-top: 8px; }
      .metric-sub { color: var(--gear-gray); font-size: 12px; margin-top: 8px; }
      .narrative { margin-top: 32px; background: var(--charcoal); color: white; border-left: 6px solid var(--orange); padding: 24px; border-radius: 2px; }
      .narrative-label { color: var(--orange); font-size: 11px; font-weight: 850; letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 8px; }
      .narrative-text { color: #f5f5f5; font-size: 15px; line-height: 1.65; }
      .section { margin-top: 36px; }
      .section-label { color: var(--muted); font-size: 11px; font-weight: 850; letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 12px; }
      .section h2 { color: var(--charcoal); font-size: 22px; margin: 0 0 8px; }
      .deck { color: var(--muted); font-size: 13px; margin: 0 0 18px; }
      .lines table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
      .lines th { background: var(--charcoal); color: white; font-size: 11px; padding: 10px; text-transform: uppercase; letter-spacing: 0.08em; text-align: right; }
      .lines th:first-child { text-align: left; }
      .lines td { border-bottom: 1px solid #e6e2db; padding: 12px 10px; vertical-align: top; }
      .line-label { color: var(--charcoal); font-size: 14px; font-weight: 750; }
      .line-detail { color: var(--muted); font-size: 12px; margin-top: 2px; text-transform: capitalize; }
      .qty { text-align: center; }
      .amount { text-align: right; white-space: nowrap; font-weight: 700; }
      .credit { color: var(--green); }
      .split { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; margin-top: 36px; }
      .card { border: 1px solid #e6e2db; border-radius: 2px; padding: 22px; background: white; }
      .summary { background: var(--paper); border-top: 5px solid var(--orange); }
      .pricing-row { display: flex; justify-content: space-between; gap: 16px; padding: 6px 0; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
      .pricing-row span:last-child { color: var(--surface); font-weight: 700; }
      .pricing-row.net, .pricing-row.total { border-top: 1px solid #d7d0c5; margin-top: 10px; padding-top: 13px; font-size: 16px; font-weight: 850; color: var(--charcoal); }
      .pricing-row.total span:last-child { color: var(--orange); font-size: 22px; }
      .pricing-note { color: var(--muted); font-size: 11px; margin: 8px 0 0; }
      .hero-finance { border: 2px solid var(--orange); background: #fff7ec; padding: 22px; border-radius: 2px; }
      .hero-finance-label { color: var(--orange); font-size: 11px; font-weight: 850; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 8px; }
      .hero-finance-payment { color: var(--charcoal); font-size: 34px; line-height: 1; font-weight: 850; letter-spacing: -0.03em; }
      .hero-finance-payment span { font-size: 15px; color: var(--muted); font-weight: 600; }
      .hero-finance-meta { color: var(--muted); font-size: 12px; margin-top: 8px; }
      .hero-finance-lender { color: var(--muted); font-size: 11px; margin-top: 3px; font-style: italic; }
      .alt-finance { margin-top: 18px; }
      .alt-finance-row { display: flex; justify-content: space-between; gap: 16px; padding: 11px 0; border-bottom: 1px solid #eee9e1; }
      .alt-finance-label { font-size: 13px; font-weight: 750; }
      .alt-finance-meta { font-size: 11px; color: var(--muted); margin-top: 2px; }
      .alt-finance-amount { font-size: 16px; font-weight: 800; white-space: nowrap; }
      .alt-finance-amount span { color: var(--muted); font-size: 11px; }
      .supporting { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
      .supporting-card { border-left: 4px solid var(--orange); background: var(--paper); padding: 16px; }
      .supporting-card p { margin: 0 0 8px; color: var(--surface); font-size: 13px; }
      .qep-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
      .qep-card { background: var(--charcoal); color: var(--gear-gray); border-left: 4px solid var(--orange); padding: 18px; }
      .qep-card strong { color: white; display: block; margin-bottom: 8px; }
      .terms { background: var(--paper); border: 1px solid #e6e2db; padding: 22px; }
      .terms p { margin: 6px 0; color: var(--surface); font-size: 13px; }
      .disclaimer { margin-top: 18px; color: var(--muted); font-size: 11px; line-height: 1.55; }
      .contact { margin-top: 36px; background: var(--charcoal); color: white; display: flex; justify-content: space-between; gap: 24px; padding: 22px; border-bottom: 4px solid var(--orange); }
      .contact a { color: var(--orange); text-decoration: none; }
      .footer { margin-top: 36px; border-top: 1px solid #e6e2db; padding-top: 18px; color: var(--muted); font-size: 11px; display: flex; justify-content: space-between; gap: 16px; }
      .muted-card { color: var(--muted); font-size: 13px; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .page { max-width: none; padding: 28px 40px; }
        .masthead { margin: -28px -40px 28px; padding: 24px 40px; }
        .section, .split { page-break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <header class="masthead">
        <div>
          <div class="brand-mark">${escapeHtml(data.branch.name || "Quality Equipment & Parts")}</div>
          <div class="brand-rule"></div>
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
          <div class="kicker">Customer equipment proposal</div>
          <h1>Built for the job. Backed by QEP.</h1>
          <p><strong>Prepared for:</strong> ${escapeHtml(data.customerName)}</p>
          <p><strong>Recommended machine:</strong> ${escapeHtml(heroTitle || "Equipment configuration")}</p>
          <p><strong>Prepared by:</strong> ${escapeHtml(data.preparedBy)} · ${escapeHtml(data.preparedDate)}</p>
          <span class="reference-badge">${escapeHtml(referenceBadge)}</span>
        </div>
        <aside class="metric-card">
          <div class="metric-label">${escapeHtml(data.compliance.primaryTotalLabel)}</div>
          <div class="metric-value">${escapeHtml(formatCurrency(selectedTotal(data)))}</div>
          <div class="metric-sub">Customer total: ${escapeHtml(formatCurrency(data.customerTotal))}</div>
          ${data.compliance.primaryTotalLabel === "Amount financed" ? `<div class="metric-sub">After cash down: ${escapeHtml(formatCurrency(data.amountFinanced))}</div>` : ""}
          ${data.validUntil ? `<div class="metric-sub">Valid until ${escapeHtml(data.validUntil)}</div>` : ""}
        </aside>
      </section>

      ${data.narrative.text ? `
        <section class="narrative">
          <div class="narrative-label">Why this machine</div>
          <div class="narrative-text">${escapeHtml(data.narrative.text)}</div>
        </section>
      ` : ""}

      <section class="section lines">
        <div class="section-label">Configuration waterfall</div>
        <h2>Customer-visible line items</h2>
        <p class="deck">Charges and credits are rendered from the same canonical proposal data used by the PDF. Internal dealer cost, margin, source IDs, metadata, and approval fields are excluded.</p>
        <table>
          <thead>
            <tr><th>Line item</th><th>Qty</th><th>Unit</th><th>Extended</th><th>Impact</th></tr>
          </thead>
          <tbody>${lineRowsHtml}</tbody>
        </table>
      </section>

      ${(factsHtml || highlightsHtml) ? `<section class="section supporting">${factsHtml}${highlightsHtml}</section>` : ""}

      <section class="split">
        <div class="card summary">
          <div class="section-label">Commercial summary</div>
          <div class="pricing-row"><span>Equipment total</span><span>${escapeHtml(formatCurrency(data.equipmentTotal))}</span></div>
          ${data.attachmentTotal > 0 ? `<div class="pricing-row"><span>Attachments/options</span><span>${escapeHtml(formatCurrency(data.attachmentTotal))}</span></div>` : ""}
          ${data.pricingLineTotal > 0 ? `<div class="pricing-row"><span>Fees/adders</span><span>${escapeHtml(formatCurrency(data.pricingLineTotal))}</span></div>` : ""}
          <div class="pricing-row"><span>Subtotal</span><span>${escapeHtml(formatCurrency(data.subtotal))}</span></div>
          ${data.discountTotal > 0 ? `<div class="pricing-row"><span>Commercial discounts/rebates</span><span class="credit">-${escapeHtml(formatCurrency(data.discountTotal))}</span></div>` : ""}
          ${data.tradeAllowance > 0 ? `<div class="pricing-row"><span>Trade-in allowance</span><span class="credit">-${escapeHtml(formatCurrency(data.tradeAllowance))}</span></div>` : ""}
          <div class="pricing-row net"><span>Net before tax</span><span>${escapeHtml(formatCurrency(data.netTotal))}</span></div>
          <div class="pricing-row"><span>${escapeHtml(data.compliance.taxLabel)}</span><span>${escapeHtml(formatCurrency(data.taxTotal))}</span></div>
          ${data.compliance.taxDetail ? `<p class="pricing-note">${escapeHtml(data.compliance.taxDetail)}</p>` : ""}
          <div class="pricing-row"><span>Customer total</span><span>${escapeHtml(formatCurrency(data.customerTotal))}</span></div>
          ${data.cashDown > 0 ? `<div class="pricing-row"><span>Cash down / deposit credit</span><span class="credit">-${escapeHtml(formatCurrency(data.cashDown))}</span></div>` : ""}
          <div class="pricing-row total"><span>${escapeHtml(data.compliance.primaryTotalLabel)}</span><span>${escapeHtml(formatCurrency(selectedTotal(data)))}</span></div>
        </div>

        <div>
          <div class="section-label">Payment scenarios</div>
          ${buildSelectedFinancingHtml(selectedFinancing)}
          ${buildOtherFinancingHtml(otherFinancing)}
          <p class="disclaimer">${escapeHtml(data.compliance.financingDisclaimer)}</p>
        </div>
      </section>

      <section class="section qep-cards">
        <div class="qep-card"><strong>Lifecycle support</strong>Sales, rental, parts, and service teams coordinate around the equipment you are buying.</div>
        <div class="qep-card"><strong>Downtime-aware branch</strong>QEP branch support can coordinate delivery, warranty, field service, and urgent parts needs.</div>
        <div class="qep-card"><strong>Clear handoff</strong>Line items, tax, payments, special terms, and next steps are visible before signature.</div>
      </section>

      <section class="section terms">
        <div class="section-label">Tax, compliance, and proposal terms</div>
        <p><strong>Quote:</strong> ${escapeHtml(referenceBadge)}</p>
        <p><strong>Valid until:</strong> ${escapeHtml(data.validUntil ?? data.compliance.validUntil ?? "TBD")}</p>
        <p><strong>Delivery ETA:</strong> ${escapeHtml(data.deliveryEta ?? "TBD")}</p>
        <p><strong>Deposit required:</strong> ${escapeHtml(data.depositRequiredAmount != null ? formatCurrency(data.depositRequiredAmount) : "Not required unless specified by your QEP representative.")}</p>
        <p><strong>Special terms:</strong> ${escapeHtml(data.specialTerms || "Standard QEP proposal terms apply; final terms confirmed at signature.")}</p>
        ${data.compliance.taxDetail ? `<p><strong>Tax detail:</strong> ${escapeHtml(data.compliance.taxDetail)}</p>` : ""}
        <p class="disclaimer">${escapeHtml(data.compliance.proposalDisclaimer)}</p>
      </section>

      <section class="contact">
        <div>
          <strong>${escapeHtml(data.preparedBy)}</strong>
          <div>Your ${escapeHtml(data.branch.name || "QEP")} sales representative</div>
        </div>
        <div>
          ${data.branch.phone ? `<div><a href="tel:${escapeHtml(data.branch.phone)}">${escapeHtml(data.branch.phone)}</a></div>` : ""}
          ${data.branch.email ? `<div><a href="mailto:${escapeHtml(data.branch.email)}">${escapeHtml(data.branch.email)}</a></div>` : ""}
        </div>
      </section>

      <footer class="footer">
        <div>${escapeHtml(data.branch.footerText || "Prices subject to change; all equipment subject to prior sale.")}</div>
        <div>Ref ${escapeHtml(referenceBadge)}</div>
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
