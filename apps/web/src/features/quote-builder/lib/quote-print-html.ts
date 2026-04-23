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

function printableFinancingOptions(data: QuotePDFData): QuotePDFData["financing"] {
  return data.financing.filter((option) =>
    option.type !== "cash" ||
    (option.monthlyPayment ?? null) != null ||
    (option.termMonths ?? 0) > 0 ||
    ((option.rate ?? 0) > 0),
  );
}

export function buildPrintableQuoteHtml(data: QuotePDFData): string {
  const address = [data.branch.address, data.branch.city, data.branch.state, data.branch.postalCode]
    .filter(Boolean)
    .join(", ");
  const financingOptions = printableFinancingOptions(data).slice(0, 3);

  const equipmentRows = data.equipment.map((item) => `
    <tr>
      <td>${escapeHtml(`${item.make} ${item.model}`.trim())}</td>
      <td>${escapeHtml(item.year ?? "—")}</td>
      <td class="amount">${escapeHtml(formatCurrency(item.price))}</td>
    </tr>
  `).join("");

  const attachmentRows = data.attachments.map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td>—</td>
      <td class="amount">${escapeHtml(formatCurrency(item.price))}</td>
    </tr>
  `).join("");

  const financingCards = financingOptions.map((option) => `
    <div class="finance-card">
      <div class="finance-head">
        <span>${escapeHtml(option.label ?? option.type)}</span>
        ${data.selectedFinancingLabel === option.label ? '<span class="pill">Selected</span>' : ""}
      </div>
      <div class="finance-line"><strong>Term:</strong> ${escapeHtml(option.termMonths ?? "—")} months</div>
      <div class="finance-line"><strong>Rate:</strong> ${escapeHtml(option.rate ?? 0)}%</div>
      <div class="finance-line"><strong>Monthly:</strong> ${escapeHtml(formatCurrency(option.monthlyPayment ?? 0))}</div>
      <div class="finance-line"><strong>Total:</strong> ${escapeHtml(formatCurrency(option.totalCost ?? 0))}</div>
      ${option.lender ? `<div class="finance-line muted">via ${escapeHtml(option.lender)}</div>` : ""}
    </div>
  `).join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(data.dealName || "Quote")}</title>
    <style>
      :root { color-scheme: light; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; color: #111827; background: #fff; }
      .page { max-width: 900px; margin: 0 auto; padding: 40px; }
      .header { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 18px; border-bottom: 2px solid #E87722; }
      .brand { font-size: 28px; font-weight: 700; color: #E87722; }
      .meta { font-size: 12px; color: #4b5563; line-height: 1.6; text-align: right; }
      h1 { font-size: 34px; margin: 40px 0 8px; }
      .subtitle { color: #4b5563; margin: 0 0 28px; }
      .grid { display: grid; gap: 20px; }
      .grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .card { border: 1px solid #d1d5db; border-radius: 12px; padding: 20px; }
      .section-title { margin: 0 0 12px; font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: #4b5563; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 10px 0; border-bottom: 1px solid #e5e7eb; font-size: 14px; text-align: left; }
      th { color: #6b7280; text-transform: uppercase; font-size: 11px; letter-spacing: 0.08em; }
      .amount { text-align: right; white-space: nowrap; }
      .summary-row { display: flex; justify-content: space-between; gap: 16px; padding: 6px 0; font-size: 14px; }
      .summary-row strong { font-size: 18px; color: #E87722; }
      .financing-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
      .finance-card { border: 1px solid #d1d5db; border-radius: 12px; padding: 16px; }
      .finance-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 10px; font-weight: 700; color: #E87722; text-transform: uppercase; font-size: 12px; letter-spacing: 0.12em; }
      .finance-line { font-size: 13px; margin: 4px 0; }
      .muted { color: #6b7280; }
      .pill { border: 1px solid #E87722; border-radius: 999px; padding: 3px 8px; font-size: 10px; letter-spacing: 0.08em; }
      .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .page { padding: 24px; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="header">
        <div>
          <div class="brand">${escapeHtml(data.branch.name || "Quality Equipment & Parts")}</div>
          ${address ? `<div class="subtitle">${escapeHtml(address)}</div>` : ""}
        </div>
        <div class="meta">
          ${data.branch.phone ? `<div>Phone: ${escapeHtml(data.branch.phone)}</div>` : ""}
          ${data.branch.email ? `<div>Email: ${escapeHtml(data.branch.email)}</div>` : ""}
          ${data.branch.website ? `<div>${escapeHtml(data.branch.website)}</div>` : ""}
        </div>
      </div>

      <h1>Equipment Proposal</h1>
      <p class="subtitle">Prepared for ${escapeHtml(data.customerName)} on ${escapeHtml(data.preparedDate)}</p>

      <div class="grid two">
        <div class="card">
          <p class="section-title">Quote</p>
          <div class="summary-row"><span>Reference</span><span>${escapeHtml(data.dealName || "Quote")}</span></div>
          <div class="summary-row"><span>Prepared by</span><span>${escapeHtml(data.preparedBy)}</span></div>
          ${data.quoteNumber ? `<div class="summary-row"><span>Quote number</span><span>${escapeHtml(data.quoteNumber)}</span></div>` : ""}
        </div>
        ${data.aiRecommendationSummary ? `
          <div class="card">
            <p class="section-title">AI Recommendation</p>
            <div>${escapeHtml(data.aiRecommendationSummary)}</div>
          </div>
        ` : `<div class="card"><p class="section-title">Summary</p><div>Commercial quote prepared for customer review.</div></div>`}
      </div>

      <div class="card" style="margin-top: 20px;">
        <p class="section-title">Equipment</p>
        <table>
          <thead>
            <tr><th>Description</th><th>Year</th><th class="amount">Price</th></tr>
          </thead>
          <tbody>
            ${equipmentRows}
            ${attachmentRows}
          </tbody>
        </table>
      </div>

      <div class="grid two" style="margin-top: 20px;">
        <div class="card">
          <p class="section-title">Commercial Summary</p>
          <div class="summary-row"><span>Equipment total</span><span>${escapeHtml(formatCurrency(data.equipmentTotal))}</span></div>
          ${data.attachmentTotal > 0 ? `<div class="summary-row"><span>Attachments</span><span>${escapeHtml(formatCurrency(data.attachmentTotal))}</span></div>` : ""}
          <div class="summary-row"><span>Subtotal</span><span>${escapeHtml(formatCurrency(data.subtotal))}</span></div>
          ${data.discountTotal > 0 ? `<div class="summary-row"><span>Discount</span><span>(${escapeHtml(formatCurrency(data.discountTotal))})</span></div>` : ""}
          ${data.tradeAllowance > 0 ? `<div class="summary-row"><span>Trade allowance</span><span>(${escapeHtml(formatCurrency(data.tradeAllowance))})</span></div>` : ""}
          <div class="summary-row"><span>Net before tax</span><strong>${escapeHtml(formatCurrency(data.netTotal))}</strong></div>
          <div class="summary-row"><span>Tax</span><span>${escapeHtml(formatCurrency(data.taxTotal))}</span></div>
          <div class="summary-row"><span>Customer total</span><strong>${escapeHtml(formatCurrency(data.customerTotal))}</strong></div>
          ${data.cashDown > 0 ? `<div class="summary-row"><span>Cash down</span><span>(${escapeHtml(formatCurrency(data.cashDown))})</span></div>` : ""}
          <div class="summary-row"><span>Amount financed</span><strong>${escapeHtml(formatCurrency(data.amountFinanced))}</strong></div>
        </div>

        ${financingOptions.length > 0 ? `
          <div class="card">
            <p class="section-title">Financing Options</p>
            <div class="financing-grid">${financingCards}</div>
          </div>
        ` : `
          <div class="card">
            <p class="section-title">Next Step</p>
            <div>Review quote totals, confirm any trade and tax assumptions, and finalize customer-facing terms.</div>
          </div>
        `}
      </div>

      <div class="footer">
        ${escapeHtml(data.branch.footerText || "This proposal is valid for 30 days from the date of preparation. Prices are subject to change and all equipment is subject to prior sale.")}
      </div>
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
