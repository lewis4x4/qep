import type { QuotePDFData, QuoteProposalAsset, QuoteProposalLine } from "../components/QuotePDFDocument";
import { formatAprSourceAttribution } from "./finance-apr-source";
import { isDisplayableProposalFinanceScenario } from "./quote-proposal-data";

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value: string | number | null | undefined): string {
  return escapeHtml(value);
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
  return data.financing.filter(isDisplayableProposalFinanceScenario).slice(0, 4);
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

function lineTitle(line: QuoteProposalLine): string {
  return [line.condition, line.year, line.make, line.model].filter(Boolean).join(" ").trim() || line.description;
}

function lineMeta(line: QuoteProposalLine): string {
  return [line.stockNumber ? `Stock #: ${line.stockNumber}` : null, line.serialNumber ? `Serial #: ${line.serialNumber}` : null]
    .filter(Boolean)
    .join(" · ");
}

function renderLineAmount(line: QuoteProposalLine): string {
  const amount = formatCurrency(line.displayAmount);
  return line.tone === "credit" ? `-${amount}` : amount;
}

function image(asset: QuoteProposalAsset | null | undefined, className: string): string {
  return asset?.src ? `<img class="${className}" src="${escapeAttr(asset.src)}" alt="${escapeAttr(asset.alt)}" />` : "";
}

function buildCoverGallery(data: QuotePDFData, fallbackLine: QuoteProposalLine | null): string {
  const units = data.coverGalleryUnits.slice(0, 3);
  if (units.length === 0) {
    return fallbackLine?.media?.primaryPhoto
      ? image(fallbackLine.media.primaryPhoto, "hero-photo")
      : `<div class="hero-fallback">${escapeHtml(data.primaryMachineTitle || "Equipment configuration")}</div>`;
  }

  const cards = units.map((unit) => {
    const [primaryPhoto, ...thumbs] = unit.photos.slice(0, 5);
    return `
      <article class="cover-gallery-card">
        ${primaryPhoto ? image(primaryPhoto, "cover-gallery-main") : ""}
        <div class="cover-gallery-title">${escapeHtml(unit.title)}</div>
        ${unit.meta ? `<div class="cover-gallery-meta">${escapeHtml(unit.meta)}</div>` : ""}
        ${thumbs.length > 0 ? `<div class="cover-gallery-thumbs">${thumbs.map((photo) => image(photo, "cover-gallery-thumb")).join("")}</div>` : ""}
      </article>
    `;
  }).join("");

  return `
    <section class="cover-gallery" aria-label="Equipment photo gallery">
      ${cards}
      ${data.coverGalleryUnits.length > units.length ? `<p class="cover-gallery-more-note">Additional equipment appears in the configuration summary.</p>` : ""}
    </section>
  `;
}

function buildHeader(data: QuotePDFData, page: number, totalPages: number): string {
  const address = [data.branch.address, data.branch.city, data.branch.state, data.branch.postalCode].filter(Boolean).join(", ");
  const vendorLogos = data.brandAssets.vendorLogos
    .slice(0, 5)
    .map((asset) => image(asset, "vendor-logo"))
    .join("");
  return `
    <header class="masthead">
      <div>
        ${image(data.brandAssets.qepLogo, "qep-logo") || `<div class="brand-mark">${escapeHtml(data.branch.name || "Quality Equipment & Parts")}</div>`}
        <div class="brand-meta-line">${escapeHtml(address)}</div>
        <div class="brand-meta-line">${escapeHtml([data.branch.phone, data.branch.email, data.branch.website].filter(Boolean).join(" · "))}</div>
        <div class="vendor-strip">${vendorLogos}</div>
      </div>
      <div class="meta-box">
        <div class="meta-branch">${escapeHtml(data.branch.name || "QEP")}</div>
        <div class="meta-grid">
          <span>Date</span><strong>${escapeHtml(data.preparedDate)}</strong>
          <span>Page</span><strong>${page} of ${totalPages}</strong>
          <span>Quote No</span><strong>${escapeHtml(buildReferenceBadge(data))}</strong>
          <span>Prepared for</span><strong>${escapeHtml(data.customerName)}</strong>
          <span>Salesperson</span><strong>${escapeHtml(data.preparedBy)}</strong>
        </div>
      </div>
    </header>
    <section class="document-banner"><span>EQUIPMENT ESTIMATE - NOT AN INVOICE</span><small>Valid until ${escapeHtml(data.validUntil ?? data.compliance.validUntil ?? "TBD")}</small></section>
  `;
}

function buildAddressBlocks(data: QuotePDFData): string {
  return `
    <section class="address-grid">
      <div class="address-card"><div class="eyebrow">Prepared for</div><strong>${escapeHtml(data.customerName)}</strong><span>${escapeHtml(data.dealName)}</span></div>
      <div class="address-card"><div class="eyebrow">Prepared by</div><strong>${escapeHtml(data.preparedBy)}</strong><span>${escapeHtml(data.branch.phone ?? "")}</span></div>
      <div class="address-card"><div class="eyebrow">Quote reference</div><strong>${escapeHtml(buildReferenceBadge(data))}</strong><span>Delivery: ${escapeHtml(data.deliveryEta ?? "TBD")}</span></div>
    </section>
  `;
}

function buildUnitCard(line: QuoteProposalLine): string {
  const specHtml = (line.specBullets ?? []).slice(0, 8).map((spec) => `<li>${escapeHtml(spec)}</li>`).join("");
  const photoHtml = image(line.media?.primaryPhoto, "unit-photo") || `<div class="unit-photo unit-photo-placeholder">${escapeHtml(line.make || "QEP")}</div>`;
  return `
    <article class="unit-card">
      ${photoHtml}
      <div class="unit-copy">
        <div class="unit-topline"><strong>${escapeHtml(lineMeta(line) || line.lineType.replace(/_/g, " "))}</strong><strong class="unit-amount ${line.tone === "credit" ? "credit" : ""}">${escapeHtml(renderLineAmount(line))}</strong></div>
        <h2>${escapeHtml(lineTitle(line))}</h2>
        <p>${escapeHtml(line.longDescription || line.description)}</p>
        ${line.warrantyText ? `<div class="warranty">${escapeHtml(line.warrantyText)}</div>` : ""}
        ${specHtml ? `<ul>${specHtml}</ul>` : ""}
      </div>
    </article>
  `;
}

function buildLineDetail(line: QuoteProposalLine): string {
  const machine = [line.year, line.make, line.model].filter(Boolean).join(" ").trim();
  return [
    line.lineType.replace(/_/g, " "),
    machine || null,
    lineMeta(line) || null,
    line.condition || null,
    line.reasonCode ? line.reasonCode.replace(/_/g, " ") : null,
  ].filter(Boolean).join(" · ");
}

function buildTradeLineEvidence(line: QuoteProposalLine): string {
  if (line.lineType !== "trade_allowance") return "";
  const photo = image(line.media?.primaryPhoto, "trade-line-photo");
  const bullets = (line.specBullets ?? [])
    .slice(0, 4)
    .map((spec) => `<li>${escapeHtml(spec)}</li>`)
    .join("");
  const details = [
    line.longDescription ? `<p>${escapeHtml(line.longDescription)}</p>` : "",
    bullets ? `<ul>${bullets}</ul>` : "",
  ].join("");
  return photo || details ? `<div class="trade-line-evidence">${photo}<div>${details}</div></div>` : "";
}

function buildLineRows(lines: QuoteProposalLine[]): string {
  return lines.map((line) => `
    <tr>
      <td>
        <div class="line-label">${escapeHtml(line.description)}</div>
        <div class="line-detail">${escapeHtml(buildLineDetail(line))}</div>
        ${buildTradeLineEvidence(line)}
      </td>
      <td class="qty">${escapeHtml(line.quantity)}</td>
      <td class="amount ${line.tone === "credit" ? "credit" : ""}">${escapeHtml(renderLineAmount(line))}</td>
    </tr>
  `).join("");
}

function buildFinanceGrid(data: QuotePDFData, options: QuotePDFData["financing"]): string {
  if (options.length === 0) return "";
  const selected = options.find((option) => data.selectedFinancingLabel && option.label === data.selectedFinancingLabel) ?? options[0];
  const hasLease = options.some((option) => option.type === "lease" || option.kind === "lease_fmv" || option.kind === "lease_fppo");
  const title = data.financeComparisonEnabled
    ? hasLease ? "Cash / finance / lease comparison" : "Cash / finance comparison"
    : "Selected payment scenario";
  return `
    <section class="finance-panel">
      <h3>${escapeHtml(title)}</h3>
      <div class="finance-grid">
        ${options.map((option) => {
          const isSelected = option === selected;
          const payment = option.type === "cash"
            ? (option.totalCost != null ? formatCurrency(option.totalCost) : "Cash purchase")
            : option.monthlyPayment != null ? `${formatCurrency(option.monthlyPayment)}<span>/mo</span>` : "Estimate pending";
          const aprSource = formatAprSourceAttribution(option);
          return `
            <div class="finance-card ${isSelected ? "selected" : ""}">
              <div class="finance-label">${escapeHtml(option.label ?? option.type)}${isSelected ? " · Selected" : ""}</div>
              <div class="finance-payment">${payment}</div>
              <div class="finance-meta">${escapeHtml(option.termMonths != null ? `${option.termMonths} months` : "Term TBD")} · ${escapeHtml(option.rate != null ? `${option.rate.toFixed(2)}% APR` : "rate subject to approval")}</div>
              ${aprSource ? `<div class="finance-source">${escapeHtml(aprSource)}</div>` : ""}
              ${option.lender ? `<div class="finance-meta">via ${escapeHtml(option.lender)}</div>` : ""}
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function buildTotals(data: QuotePDFData): string {
  return `
    <section class="totals-box">
      <div><span>Equipment total</span><strong>${escapeHtml(formatCurrency(data.equipmentTotal))}</strong></div>
      ${data.attachmentTotal > 0 ? `<div><span>Attachments/options</span><strong>${escapeHtml(formatCurrency(data.attachmentTotal))}</strong></div>` : ""}
      ${data.pricingLineTotal > 0 ? `<div><span>Fees/adders</span><strong>${escapeHtml(formatCurrency(data.pricingLineTotal))}</strong></div>` : ""}
      <div><span>Subtotal</span><strong>${escapeHtml(formatCurrency(data.subtotal))}</strong></div>
      ${data.discountTotal > 0 ? `<div><span>Commercial discounts/rebates</span><strong class="credit">-${escapeHtml(formatCurrency(data.discountTotal))}</strong></div>` : ""}
      ${data.tradeAllowance > 0 ? `<div><span>Trade-in allowance</span><strong class="credit">-${escapeHtml(formatCurrency(data.tradeAllowance))}</strong></div>` : ""}
      <div><span>Net before tax</span><strong>${escapeHtml(formatCurrency(data.netTotal))}</strong></div>
      <div><span>${escapeHtml(data.compliance.taxLabel)}</span><strong>${escapeHtml(formatCurrency(data.taxTotal))}</strong></div>
      ${data.compliance.taxDetail ? `<small>${escapeHtml(data.compliance.taxDetail)}</small>` : ""}
      <div><span>Customer total</span><strong>${escapeHtml(formatCurrency(data.customerTotal))}</strong></div>
      ${data.cashDown > 0 ? `<div><span>Cash down applied</span><strong class="credit">-${escapeHtml(formatCurrency(data.cashDown))}</strong></div>` : ""}
      <div class="grand-total"><span>Authorization: _________________________</span><strong>${escapeHtml(data.compliance.primaryTotalLabel)}: ${escapeHtml(formatCurrency(selectedTotal(data)))}</strong></div>
    </section>
  `;
}

function buildFooter(data: QuotePDFData): string {
  return `
    <footer class="page-footer">
      <div>${escapeHtml(data.compliance.proposalDisclaimer)}</div>
      <div class="qr-wrap">${image(data.brandAssets.qrCode, "qr-code")}<span>Scan to visit QEP online</span></div>
    </footer>
  `;
}

function hasOverflow(data: QuotePDFData): boolean {
  const equipmentLines = data.lineItems.filter((line) => line.lineType === "equipment" || line.lineType === "attachment");
  const specCount = equipmentLines.reduce((sum, line) => sum + (line.specBullets?.length ?? 0), 0);
  const commercialRows = data.lineItems.length - equipmentLines.length;
  const financeRows = data.financing.filter(isDisplayableProposalFinanceScenario).length;
  return equipmentLines.length > 3 || specCount > 18 || commercialRows > 12 || financeRows > 4;
}

export function buildPrintableQuoteHtml(data: QuotePDFData): string {
  const referenceBadge = buildReferenceBadge(data);
  const equipmentLines = data.lineItems.filter((line) => line.lineType === "equipment" || line.lineType === "attachment");
  const commercialLines = data.lineItems.filter((line) => line.lineType !== "equipment" && line.lineType !== "attachment");
  const primaryLine = equipmentLines.find((line) => line.media?.primaryPhoto?.src) ?? equipmentLines[0] ?? null;
  const financingOptions = printableFinancingOptions(data);
  const overflow = hasOverflow(data);
  const totalPages = overflow ? 3 : 2;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(`${referenceBadge} proposal for ${data.customerName}`)}</title>
    <style>
      :root { color-scheme: light; --orange:#F28A07; --charcoal:#111111; --surface:#1a1a1a; --gear-gray:#BFBFBF; --muted:#707070; --paper:#f7f4ef; --green:#0f7a3a; --line:#e6e2db; }
      * { box-sizing:border-box; }
      body { margin:0; color:var(--surface); background:#fff; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; line-height:1.32; -webkit-font-smoothing:antialiased; }
      .page { position:relative; width:8.5in; min-height:11in; margin:0 auto; padding:.36in .44in .72in; page-break-after:always; overflow:hidden; }
      .page:last-child { page-break-after:auto; }
      .masthead { display:grid; grid-template-columns:1fr 2.6in; gap:.22in; border-bottom:5px solid var(--orange); padding-bottom:.1in; margin-bottom:.1in; }
      .qep-logo { width:2in; max-height:.62in; object-fit:contain; object-position:left center; display:block; }
      .brand-mark { font-size:.18in; font-weight:900; text-transform:uppercase; }
      .brand-meta-line { color:var(--muted); font-size:.073in; font-weight:700; margin-top:.025in; }
      .vendor-strip { display:flex; gap:.06in; align-items:center; height:.32in; margin-top:.055in; }
      .vendor-logo { max-width:.58in; max-height:.24in; object-fit:contain; filter:grayscale(1); }
      .meta-box { border:1px solid var(--charcoal); background:var(--paper); font-size:.068in; }
      .meta-branch { padding:.045in .07in; color:white; background:var(--charcoal); font-weight:900; text-align:center; letter-spacing:.012in; }
      .meta-grid { display:grid; grid-template-columns:.74in 1fr; gap:1px; padding:.045in .055in; }
      .meta-grid span { color:var(--muted); text-transform:uppercase; }
      .meta-grid strong { text-align:right; font-variant-numeric:tabular-nums; }
      .document-banner { display:flex; justify-content:space-between; align-items:center; gap:.12in; margin-bottom:.1in; padding:.07in .1in; color:white; background:var(--charcoal); border-left:.07in solid var(--orange); }
      .document-banner span { font-size:.16in; font-weight:900; letter-spacing:.013in; }
      .document-banner small { color:#ddd; font-size:.067in; text-align:right; }
      .address-grid { display:grid; grid-template-columns:1fr 1fr 1.25in; gap:.09in; margin-bottom:.1in; }
      .address-card { padding:.075in; border:1px solid var(--line); background:var(--paper); font-size:.076in; font-weight:750; min-height:.55in; }
      .address-card span { display:block; color:var(--muted); margin-top:.025in; }
      .eyebrow { margin-bottom:.035in; color:var(--orange); font-size:.061in; font-weight:900; letter-spacing:.018in; text-transform:uppercase; }
      .hero { display:grid; grid-template-columns:3.55in 1fr; gap:.14in; margin-bottom:.1in; }
      .hero-photo { width:100%; height:2.05in; object-fit:cover; border:1px solid var(--line); border-bottom:.06in solid var(--orange); }
      .hero-fallback,.total-callout { min-height:2.05in; }
      .hero-fallback { display:grid; place-items:center; background:var(--paper); border-bottom:.06in solid var(--orange); color:var(--muted); font-weight:900; }
      .cover-gallery { min-height:2.05in; display:grid; grid-template-columns:repeat(3,1fr); gap:.055in; align-content:start; }
      .cover-gallery-card { min-width:0; border:1px solid var(--line); border-bottom:.05in solid var(--orange); background:var(--paper); padding:.045in; page-break-inside:avoid; }
      .cover-gallery-main { width:100%; height:.78in; object-fit:cover; display:block; margin-bottom:.035in; }
      .cover-gallery-title { color:var(--charcoal); font-size:.067in; font-weight:900; line-height:1.15; text-transform:uppercase; }
      .cover-gallery-meta { color:var(--muted); font-size:.056in; font-weight:750; line-height:1.2; margin-top:.02in; }
      .cover-gallery-thumbs { display:grid; grid-template-columns:repeat(4,1fr); gap:.02in; margin-top:.035in; }
      .cover-gallery-thumb { width:100%; height:.34in; object-fit:cover; border:1px solid #fff; }
      .cover-gallery-more-note { grid-column:1/-1; margin:.02in 0 0; color:var(--muted); font-size:.058in; font-weight:750; }
      .total-callout { display:flex; flex-direction:column; justify-content:center; color:white; background:linear-gradient(135deg,var(--charcoal),#343434); padding:.14in; text-align:right; border-bottom:.07in solid var(--orange); }
      .total-callout small { color:#cfcfcf; font-size:.075in; font-weight:900; letter-spacing:.018in; text-transform:uppercase; }
      .total-callout strong { color:var(--orange); font-size:.28in; font-weight:900; }
      .narrative { margin-bottom:.1in; padding:.1in .12in; color:white; background:var(--charcoal); border-left:.055in solid var(--orange); font-size:.082in; line-height:1.4; }
      .narrative-label,.section-label { color:var(--orange); font-size:.064in; font-weight:900; letter-spacing:.018in; text-transform:uppercase; margin-bottom:.035in; }
      .unit-grid { display:grid; grid-template-columns:1fr 1fr; gap:.1in; }
      .unit-card { display:grid; grid-template-columns:1.12in 1fr; gap:.08in; border:1px solid var(--line); background:white; padding:.07in; page-break-inside:avoid; }
      .unit-photo { width:1.12in; height:1.02in; object-fit:cover; border-bottom:.04in solid var(--orange); }
      .unit-photo-placeholder { display:grid; place-items:center; background:var(--paper); color:var(--muted); font-size:.065in; font-weight:900; text-transform:uppercase; }
      .unit-topline { display:flex; justify-content:space-between; gap:.04in; color:var(--charcoal); font-size:.063in; font-variant-numeric:tabular-nums; }
      .unit-amount { color:var(--orange); white-space:nowrap; }
      h2 { margin:.035in 0 .02in; color:var(--charcoal); font-size:.105in; text-transform:uppercase; }
      .unit-card p { margin:.018in 0; color:var(--muted); font-size:.066in; font-weight:700; }
      .warranty { display:inline-block; margin:.035in 0; padding:.025in .045in; color:var(--charcoal); background:#fff7ec; border:1px solid var(--orange); font-size:.063in; font-weight:900; }
      ul { columns:2; margin:.025in 0 0; padding-left:.1in; font-size:.061in; line-height:1.25; }
      li { break-inside:avoid; margin-bottom:.014in; }
      .commercial-grid { display:grid; grid-template-columns:1fr 2.55in; gap:.11in; align-items:start; }
      .section-title { margin:0 0 .06in; color:var(--charcoal); font-size:.087in; text-transform:uppercase; letter-spacing:.012in; border-bottom:2px solid var(--orange); padding-bottom:.025in; }
      .lines-table { width:100%; border-collapse:collapse; border:1px solid var(--line); margin-bottom:.1in; font-variant-numeric:tabular-nums; }
      .lines-table th { color:white; background:var(--charcoal); padding:.042in .05in; font-size:.06in; text-align:left; text-transform:uppercase; }
      .lines-table th:not(:first-child),.lines-table td:not(:first-child) { text-align:right; }
      .lines-table td { border-bottom:1px solid var(--line); padding:.045in .05in; font-size:.069in; vertical-align:top; }
      .line-label { font-weight:800; color:var(--charcoal); }
      .line-detail { color:var(--muted); font-size:.06in; margin-top:.012in; text-transform:capitalize; }
      .trade-line-evidence { display:grid; grid-template-columns:.82in 1fr; gap:.06in; align-items:start; margin-top:.04in; text-transform:none; }
      .trade-line-photo { width:.82in; height:.62in; object-fit:cover; border:1px solid var(--line); border-bottom:.035in solid var(--orange); }
      .trade-line-evidence p { margin:0 0 .025in; color:var(--muted); font-size:.061in; font-weight:700; }
      .trade-line-evidence ul { columns:1; margin:0; padding-left:.09in; font-size:.058in; line-height:1.22; }
      .credit { color:var(--green) !important; }
      .totals-box,.finance-panel,.terms-box { border:1px solid var(--line); background:var(--paper); padding:.085in; page-break-inside:avoid; }
      .totals-box { border-top:.055in solid var(--orange); font-variant-numeric:tabular-nums; margin-bottom:.1in; }
      .totals-box div { display:flex; justify-content:space-between; gap:.08in; padding:.035in 0; border-bottom:1px solid var(--line); font-size:.077in; }
      .totals-box small { display:block; margin:.045in 0; color:var(--muted); font-size:.061in; }
      .grand-total { margin-top:.04in; color:white; background:var(--charcoal); border:0 !important; padding:.07in !important; align-items:baseline; }
      .grand-total strong { color:var(--orange); font-size:.1in; text-align:right; }
      .finance-panel { color:white; background:var(--charcoal); border-bottom:.06in solid var(--orange); }
      .finance-panel h3 { margin:0 0 .06in; color:var(--orange); font-size:.087in; text-transform:uppercase; }
      .finance-grid { display:grid; grid-template-columns:1fr 1fr; gap:.055in; }
      .finance-card { border:1px solid #555; padding:.06in; background:#1f1f1f; }
      .finance-card.selected { border-color:var(--orange); background:#fff7ec; color:var(--surface); }
      .finance-label { color:var(--orange); font-size:.058in; font-weight:900; text-transform:uppercase; }
      .finance-payment { font-size:.13in; font-weight:900; margin:.03in 0; }
      .finance-payment span { font-size:.065in; color:var(--muted); }
      .finance-meta { font-size:.061in; color:inherit; opacity:.78; }
      .finance-source { margin-top:.025in; font-size:.058in; color:inherit; opacity:.72; line-height:1.25; }
      .terms-box { margin-top:.1in; font-size:.07in; }
      .terms-box p { margin:.035in 0; }
      .disclaimer { margin-top:.07in; color:var(--muted); font-size:.063in; line-height:1.42; }
      .page-footer { position:absolute; left:.44in; right:.44in; bottom:.22in; display:flex; justify-content:space-between; align-items:end; gap:.16in; border-top:1px solid var(--line); padding-top:.06in; color:var(--muted); font-size:.061in; font-weight:700; text-align:center; }
      .qr-wrap { display:flex; align-items:center; gap:.05in; color:var(--charcoal); text-transform:uppercase; text-align:left; }
      .qr-code { width:.52in; height:.52in; object-fit:contain; border:1px solid var(--line); }
      @media screen { body { background:#2a2a2a; } .page { background:white; margin:24px auto; box-shadow:0 18px 50px rgba(0,0,0,.28); } }
      @media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
    </style>
  </head>
  <body>
    <main>
      <article class="page">
        ${buildHeader(data, 1, totalPages)}
        ${buildAddressBlocks(data)}
        <section class="hero">
          ${buildCoverGallery(data, primaryLine)}
          <aside class="total-callout"><small>${escapeHtml(data.compliance.primaryTotalLabel)}</small><strong>${escapeHtml(formatCurrency(selectedTotal(data)))}</strong><small>Customer total: ${escapeHtml(formatCurrency(data.customerTotal))}</small><small>${escapeHtml(referenceBadge)}</small></aside>
        </section>
        ${data.narrative.text ? `<section class="narrative"><div class="narrative-label">Why this machine</div>${escapeHtml(data.narrative.text)}</section>` : ""}
        <section class="unit-grid">${equipmentLines.slice(0, 3).map(buildUnitCard).join("")}</section>
        ${buildFooter(data)}
      </article>

      <article class="page">
        ${buildHeader(data, 2, totalPages)}
        <section class="commercial-grid">
          <div>
            <h3 class="section-title">Configuration waterfall</h3>
            <table class="lines-table"><thead><tr><th>Trade, parts, charges, credits</th><th>Qty</th><th>Impact</th></tr></thead><tbody>${buildLineRows(commercialLines)}</tbody></table>
            ${buildFinanceGrid(data, financingOptions)}
            <p class="disclaimer">${escapeHtml(data.compliance.financingDisclaimer)}</p>
          </div>
          <div>
            <h3 class="section-title">Totals & signature</h3>
            ${buildTotals(data)}
            <section class="terms-box">
              <div class="section-label">Comments and terms</div>
              <p><strong>Special terms:</strong> ${escapeHtml(data.specialTerms || data.compliance.specialTerms || "Standard QEP proposal terms apply; final terms confirmed at signature.")}</p>
              <p><strong>Delivery ETA:</strong> ${escapeHtml(data.deliveryEta ?? "TBD")}</p>
              <p><strong>Good-faith deposit required:</strong> ${escapeHtml(data.depositRequiredAmount != null ? formatCurrency(data.depositRequiredAmount) : "Not required unless specified by QEP.")}</p>
              <p class="disclaimer">${escapeHtml(data.compliance.proposalDisclaimer)}</p>
            </section>
          </div>
        </section>
        ${buildFooter(data)}
      </article>

      ${overflow ? `<article class="page">${buildHeader(data, 3, totalPages)}<h3 class="section-title">Customer-safe equipment appendix</h3>${equipmentLines.map(buildUnitCard).join("")}<p class="disclaimer">Appendix appears only when the two-page proposal would otherwise compress customer-safe specifications or commercial rows below readable limits.</p>${buildFooter(data)}</article>` : ""}
    </main>
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
