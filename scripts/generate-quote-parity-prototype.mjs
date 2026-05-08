#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "test-results/proposals");
const ASSET_SOURCE_DIR = "/Users/brianlewis/Downloads/reaiagent";
const ASSET_OUT_DIR = resolve(OUT_DIR, "assets");
const HTML_PATH = resolve(OUT_DIR, "QEP-2026-0001-owner-feedback-2page.html");
const PDF_PATH = resolve(OUT_DIR, "QEP-2026-0001-owner-feedback-2page.pdf");
const TXT_PATH = resolve(OUT_DIR, "QEP-2026-0001-owner-feedback-2page.txt");

const LEGACY_FINANCE_DISCLAIMER =
  "** FINANCING BASED ON CREDIT APPROVAL. INTEREST RATE MAY\nVARY. MONTHLY PAYMENTS ARE ESTIMATED **";

const STANDARD_FOOTER =
  "Good for thirty (30) days from date of quote.  This estimate is not a contract.  Estimate is based on initial inspection.\nDoes not cover any issues that came up when work started.  Prices not guaranteed.\n\nThank You For Your Business!";

const TILA_DISCLAIMER =
  "ADR-006 / Truth in Lending Act notice: This is a payment estimate, not a guaranteed rate. Subject to credit approval. Rates shown are manufacturer-published programs, subject to change. QEP is not a lender.";

const ASSETS = {
  qepLogo: { source: "ITS IN THE NAME Quality Logo- PNG.png", out: "qep-logo.png", label: "QEP logo" },
  asvLogo: { source: "ASVLogo_AllBlack_PNG.png", out: "vendor-asv.png", label: "ASV logo" },
  cmiLogo: { source: "CMI_LogoENG-Couleur.png", out: "vendor-cmi.png", label: "CMI logo" },
  develonLogo: { source: "Develon-logo Black.png", out: "vendor-develon.png", label: "Develon logo" },
  banditLogo: { source: "New Bandit_Authorized_Logo_BLACK.png", out: "vendor-bandit.png", label: "Bandit authorized logo" },
  stackedLogo: { source: "StackedLogo.png", out: "vendor-stacked.png", label: "Stacked vendor logo" },
  qrCode: { source: "Untitled design (8).png", out: "qep-qr.png", label: "QEP QR code" },
  primaryPhoto: { source: "IMG_5439.JPG", out: "asv-rt135f.jpg", label: "ASV RT-135F photo" },
  attachmentPhoto: { source: "IMG_2090.JPG", out: "shearex-hm70sr.jpg", label: "ShearEx HM-70SR photo" },
};

const quote = {
  title: "THIS IS A QUOTE TEST",
  quoteNumber: "QEP-2026-0001",
  legacyReference: "Q02699",
  branch: {
    code: "01",
    name: "LAKE CITY",
    address: "4894 NW US Highway 41",
    cityStateZip: "Lake City, Florida 32055",
    phone: "(386) 754-6186",
    fax: "(386) 888-1413",
    web: "www.qepusa.com",
  },
  prepared: { date: "05/07/2026", time: "13:15:21", origin: "O", expires: "06/06/2026" },
  customer: {
    accountNo: "RYLEE001",
    phone: "3862923743",
    name: "RYLEE MCKENZIE",
    invoiceTo: ["RYLEE MCKENZIE", "20843 CR 49", "O'BRIEN FL 32071"],
    shipTo: ["RYLEE MCKENZIE", "20843 CR 49", "O'BRIEN FL 32071"],
    taxIdNo: "",
    purchaseOrder: "",
    shipVia: "QEP DELIVERY",
  },
  salesperson: { code: "RM3", name: "Rylee McKenzie", email: "rylee@qepusa.com" },
  comments:
    "THIS IS THE COMMENTS BOX\nDelivery, final inspection, and attachment fit-up to be confirmed by QEP before release.",
  whyThisMachine:
    "This ASV RT-135F forestry track loader package gives the customer a high-flow, guarded carrier paired with a ShearEx HM-70SR mulching head. The configuration is built for land clearing, right-of-way cleanup, and heavy vegetation work while preserving QEP support visibility from quote through delivery.",
  units: [
    {
      stock: "Q003403",
      serial: "ASVRT135LTDF01723",
      amount: 148_950,
      condition: "New",
      year: "2026",
      make: "ASV",
      model: "RT-135F",
      marketing: "New 2026 ASV RT-135F 132 HP FORESTRY TRACK LOADER",
      productLine: "ASV RT-135F Track Loader",
      warranty: "2 Year/ 2000 Hour Full Machine Warranty",
      photo: "assets/asv-rt135f.jpg",
      specs: [
        "Cummins 3.8L engine · 132 HP",
        "All-weather cab with Lexan door",
        "Air ride seat suspension",
        "Dual hydraulic drive motors",
        "Reversing fan",
        "50 GPM high flow",
        "4060 PSI system pressure",
        "Rear forestry guarding",
      ],
    },
    {
      stock: "Q003475",
      serial: "2500HC0440",
      amount: 45_750,
      condition: "New",
      year: "2026",
      make: "ShearEx",
      model: "HM-70SR",
      marketing: 'New 2026 SHEAREX HM-70SR 74" Mulching Head',
      productLine: "ShearEx HM Series Front Mount Mulcher",
      warranty: "1 Year Attachment Warranty",
      photo: "assets/shearex-hm70sr.jpg",
      specs: [
        "HM Series front-mount mulcher",
        "Danfoss HD 110CC motor",
        "Top sharpened cutting teeth",
        "Convex style bite control",
        "HD stationary push bar",
        "Standard quick attach plate",
        "Dewalt grinder + maintenance kit",
        'Working width: 74.75"',
      ],
    },
  ],
  tradeIns: [
    {
      serial: "123456",
      amount: 50_000,
      description: "2021 CAT 299D3",
      inclusions: "Bucket Included",
      notes: "THIS IS A TEST TRADE",
      marketContext:
        "COMPARABLE MARKET RANGE — NOT A GUARANTEED OFFER: $44,000 low / $52,000 midpoint / $58,000 high. Final allowance requires inspection checklist and manager approval.",
    },
  ],
  parts: [{ description: "SHEAREX CARBIDE", partNo: "BD668", qty: 15, unitPrice: 41.11 }],
  misc: [
    { description: "LESS DOWN PAYMENT RECD.", qty: 1, unitPrice: 10_000, credit: true },
    { description: "PDI / FINAL DEALER INSPECTION", qty: 1, unitPrice: 0, credit: false },
    { description: "FREIGHT / DELIVERY", qty: 1, unitPrice: 0, credit: false },
    { description: "DOC / TITLE / TAG / REGISTRATION", qty: 1, unitPrice: 0, credit: false },
  ],
  taxes: {
    subtotal: 135_316.65,
    stateLabel: "Florida State 6.00%",
    stateAmount: 8_719.0,
    countyLabel: "COLUMBIA COUNTY",
    countyAmount: 75.0,
    countyMath: "Columbia County discretionary surtax uses the Florida $5,000 cap: 1.5% × $5,000 = $75.00.",
    total: 144_110.65,
  },
  finance: [
    { months: 36, rate: 0.0, payment: 4003.07, source: "QEP sample program, eff. 05/07/2026" },
    { months: 48, rate: 0.0, payment: 3002.31, source: "QEP sample program, eff. 05/07/2026" },
    { months: 60, rate: 0.0, payment: 2401.84, source: "QEP sample program, eff. 05/07/2026" },
    { months: 72, rate: 2.99, payment: 2188.93, source: "QEP sample program, eff. 05/07/2026" },
  ],
};

function copyRequiredAssets() {
  mkdirSync(ASSET_OUT_DIR, { recursive: true });
  const missing = [];
  for (const asset of Object.values(ASSETS)) {
    const source = resolve(ASSET_SOURCE_DIR, asset.source);
    if (!existsSync(source)) missing.push(`${asset.label}: ${asset.source}`);
  }
  if (missing.length > 0) {
    throw new Error(`Missing required proposal assets from ${ASSET_SOURCE_DIR}:\n- ${missing.join("\n- ")}`);
  }
  for (const asset of Object.values(ASSETS)) {
    const destination = resolve(ASSET_OUT_DIR, asset.out);
    copyFileSync(resolve(ASSET_SOURCE_DIR, asset.source), destination);
    optimizeReviewAsset(destination, asset.out);
  }
}

function optimizeReviewAsset(path, filename) {
  const maxPixels = filename.endsWith(".jpg") ? "1200" : filename.includes("qep-logo") ? "900" : filename.includes("vendor-") ? "520" : "750";
  try {
    execFileSync("sips", ["-Z", maxPixels, path, "--out", path], { stdio: "ignore" });
  } catch {
    // sips is available on macOS. If it is not present, keep the copied source asset
    // so proposal generation still succeeds.
  }
}

function money(value) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signedAmount(value, credit = false) {
  return `${credit ? "-" : ""}${money(value)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function paragraphLines(lines) {
  return lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("");
}

function renderVendorStrip() {
  return `
    <div class="vendor-strip" aria-label="Vendor logos">
      <img src="assets/vendor-asv.png" alt="ASV" />
      <img src="assets/vendor-cmi.png" alt="CMI" />
      <img src="assets/vendor-develon.png" alt="Develon" />
      <img src="assets/vendor-bandit.png" alt="Bandit Authorized" />
      <img src="assets/vendor-stacked.png" alt="QEP vendor partner" />
    </div>
  `;
}

function renderHeader(page) {
  return `
    <header class="letterhead">
      <div>
        <img class="qep-logo" src="assets/qep-logo.png" alt="Quality Equipment & Parts - It's in the Name" />
        <div class="company-lines">
          ${escapeHtml(quote.branch.address)} · ${escapeHtml(quote.branch.cityStateZip)}<br />
          Phone ${escapeHtml(quote.branch.phone)} · Fax ${escapeHtml(quote.branch.fax)} · ${escapeHtml(quote.branch.web)}
        </div>
        ${renderVendorStrip()}
      </div>
      <div class="meta-box">
        <div class="meta-branch">${escapeHtml(quote.branch.code)} - ${escapeHtml(quote.branch.name)}</div>
        <div class="meta-grid">
          <span>Date</span><strong>${escapeHtml(quote.prepared.date)}</strong>
          <span>Time</span><strong>${escapeHtml(quote.prepared.time)} (${escapeHtml(quote.prepared.origin)})</strong>
          <span>Page</span><strong>${page} of 2</strong>
          <span>Account No</span><strong>${escapeHtml(quote.customer.accountNo)}</strong>
          <span>Phone</span><strong>${escapeHtml(quote.customer.phone)}</strong>
          <span>Quote No</span><strong>${escapeHtml(quote.quoteNumber)}</strong>
          <span>Legacy Ref</span><strong>${escapeHtml(quote.legacyReference)}</strong>
          <span>Ship Via</span><strong>${escapeHtml(quote.customer.shipVia)}</strong>
          <span>Salesperson</span><strong>${escapeHtml(`${quote.salesperson.code} · ${quote.salesperson.name}`)}</strong>
        </div>
      </div>
    </header>
  `;
}

function sameAddress(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function renderSlimHeader(page) {
  return `
    <header class="slim-header">
      <div class="slim-brand">
        <img class="qep-logo slim-logo" src="assets/qep-logo.png" alt="Quality Equipment & Parts - It's in the Name" />
        <div>
          <strong>${escapeHtml(quote.quoteNumber)}</strong>
          <span>${escapeHtml(quote.branch.code)} - ${escapeHtml(quote.branch.name)} · Page ${page} of 2 · Estimate - Not an Invoice</span>
        </div>
      </div>
      <div class="slim-total">${money(quote.taxes.total)}</div>
    </header>
  `;
}

function renderAddressBlocks() {
  const shipMatchesInvoice = sameAddress(quote.customer.shipTo, quote.customer.invoiceTo);
  const shipCopy = shipMatchesInvoice ? "Same as billing unless changed before delivery." : quote.customer.shipTo.join(" · ");

  return `
    <section class="address-grid simple-address-grid">
      <div class="address-card customer-card"><div class="eyebrow">Prepared For</div>${paragraphLines(quote.customer.invoiceTo)}<div class="subnote">Ship to: ${escapeHtml(shipCopy)}</div></div>
      <div class="address-card quote-mini">
        <div><span>Account</span><strong>${escapeHtml(quote.customer.accountNo)}</strong></div>
        <div><span>Quote</span><strong>${escapeHtml(quote.quoteNumber)}</strong></div>
        <div><span>Expires</span><strong>${escapeHtml(quote.prepared.expires)}</strong></div>
      </div>
      <div class="rep-card"><div class="eyebrow">Prepared By</div><strong>${escapeHtml(quote.salesperson.name)}</strong><span>${escapeHtml(quote.salesperson.code)} · ${escapeHtml(quote.salesperson.email)}</span></div>
    </section>
  `;
}

function renderDocBanner() {
  return `
    <section class="document-banner">
      <span>EQUIPMENT ESTIMATE - NOT AN INVOICE</span>
      <small>${escapeHtml(quote.title)} · ${escapeHtml(quote.quoteNumber)} · EXPIRY DATE: ${escapeHtml(quote.prepared.expires)}</small>
    </section>
  `;
}

function renderQuoteSummary() {
  return `
    <section class="quote-summary">
      <div>
        <span>Quote Total</span>
        <strong>${money(quote.taxes.total)}</strong>
      </div>
      <div>
        <span>Valid Through</span>
        <strong>${escapeHtml(quote.prepared.expires)}</strong>
      </div>
      <div>
        <span>Delivery</span>
        <strong>${escapeHtml(quote.customer.shipVia)}</strong>
      </div>
    </section>
  `;
}

function renderWhyBullets() {
  const bullets = [
    "High-flow ASV forestry carrier paired with the ShearEx HM-70SR mulching head.",
    "Built for land clearing, right-of-way cleanup, and heavy vegetation work.",
    "QEP delivery, fit-up, and support visibility stay attached from quote through release.",
  ];

  return `
    <section class="why-card">
      <div class="eyebrow">Why this configuration fits</div>
      <ul>${bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>
    </section>
  `;
}

function renderUnit(unit, featured = false) {
  return `
    <article class="unit-card ${featured ? "featured" : ""}">
      <img class="unit-photo" src="${escapeHtml(unit.photo)}" alt="${escapeHtml(`${unit.year} ${unit.make} ${unit.model}`)}" />
      <div class="unit-copy">
        <div class="unit-topline"><strong>Stock #: ${escapeHtml(unit.stock)}</strong><strong>Serial #: ${escapeHtml(unit.serial)}</strong><strong>${money(unit.amount)}</strong></div>
        <h2>${escapeHtml(`${unit.condition} ${unit.year} ${unit.make} ${unit.model}`)}</h2>
        <p class="marketing">${escapeHtml(unit.marketing)}</p>
        <p class="product-line">${escapeHtml(unit.productLine)}</p>
        <div class="warranty">${escapeHtml(unit.warranty)}</div>
        <ul>${unit.specs.map((spec) => `<li>${escapeHtml(spec)}</li>`).join("")}</ul>
      </div>
    </article>
  `;
}

function renderTradeIns() {
  return `
    <section class="legacy-section trade-section">
      <h3>Trade Ins</h3>
      ${quote.tradeIns.map((trade) => `
        <div class="trade-row">
          <div>
            <strong>Serial #: ${escapeHtml(trade.serial)}</strong>
            <p>${escapeHtml(trade.description)} · ${escapeHtml(trade.inclusions)} · ${escapeHtml(trade.notes)}</p>
            <div class="market-context">${escapeHtml(trade.marketContext)}</div>
          </div>
          <strong class="credit">${signedAmount(trade.amount, true)}</strong>
        </div>
      `).join("")}
    </section>
  `;
}

function renderParts() {
  return `
    <section class="legacy-section">
      <h3>ADDITIONAL PARTS</h3>
      <table><thead><tr><th>Description</th><th>Part #</th><th>Qty</th><th>Unit</th><th>Extended</th></tr></thead>
      <tbody>${quote.parts.map((part) => `<tr><td>${escapeHtml(part.description)}</td><td>${escapeHtml(part.partNo)}</td><td>${part.qty}</td><td>${money(part.unitPrice)}</td><td>${money(part.qty * part.unitPrice)}</td></tr>`).join("")}</tbody></table>
    </section>
  `;
}

function renderMisc() {
  return `
    <section class="legacy-section">
      <h3>Miscellaneous Charges/Credits</h3>
      <table><thead><tr><th>Description</th><th>Qty</th><th>Price</th><th>Extended</th></tr></thead>
      <tbody>${quote.misc.map((line) => `<tr><td>${escapeHtml(line.description)}</td><td>${line.qty}</td><td>${money(line.unitPrice)}</td><td class="${line.credit ? "credit" : ""}">${signedAmount(line.qty * line.unitPrice, line.credit)}</td></tr>`).join("")}</tbody></table>
    </section>
  `;
}

function renderTotals() {
  return `
    <section class="totals-box">
      <div><span>Subtotal:</span><strong>${money(quote.taxes.subtotal)}</strong></div>
      <div><span>${escapeHtml(quote.taxes.stateLabel)}:</span><strong>${money(quote.taxes.stateAmount)}</strong></div>
      <div><span>${escapeHtml(quote.taxes.countyLabel)}:</span><strong>${money(quote.taxes.countyAmount)}</strong></div>
      <small>${escapeHtml(quote.taxes.countyMath)}</small>
      <div class="grand-total"><span>Authorization: _________________________</span><strong>Quote Total: ${money(quote.taxes.total)}</strong></div>
    </section>
  `;
}

function renderFinanceGrid() {
  return `
    <section class="finance-panel">
      <h3>Estimated Financing — Not a Commitment to Lend</h3>
      <table class="finance-table">
        <thead><tr><th>Months</th>${quote.finance.map((row) => `<th>${row.months}</th>`).join("")}</tr></thead>
        <tbody>
          <tr><th>%Rate</th>${quote.finance.map((row) => `<td>${row.rate.toFixed(2)}</td>`).join("")}</tr>
          <tr><th>$Payment</th>${quote.finance.map((row) => `<td>${money(row.payment)}</td>`).join("")}</tr>
          <tr><th>APR Source</th>${quote.finance.map((row) => `<td>${escapeHtml(row.source)}</td>`).join("")}</tr>
        </tbody>
      </table>
    </section>
  `;
}

function renderCommentsAndCompliance() {
  return `
    <section class="terms-box">
      <div class="eyebrow">Comments + Legal Disclosures</div>
      <p>${escapeHtml(quote.comments).replaceAll("\n", "<br />")}</p>
      <p class="legacy-disclaimer">${escapeHtml(LEGACY_FINANCE_DISCLAIMER).replaceAll("\n", "<br />")}</p>
      <p class="tila">${escapeHtml(TILA_DISCLAIMER)}</p>
      <p class="footer-copy">${escapeHtml(STANDARD_FOOTER).replaceAll("\n", "<br />")}</p>
    </section>
  `;
}

function renderAcceptanceBlock() {
  return `
    <section class="acceptance-block">
      <div>
        <div class="eyebrow">Customer Authorization</div>
        <div class="signature-grid">
          <span>Printed Name</span><span>Signature</span><span>Date</span>
          <strong>&nbsp;</strong><strong>&nbsp;</strong><strong>&nbsp;</strong>
        </div>
        <p>By signing, customer acknowledges this is an equipment estimate, not an invoice, and that financing/payment terms are estimates subject to approval.</p>
      </div>
      <div class="qr-action">
        <img src="assets/qep-qr.png" alt="QEP website QR code" />
        <strong>Scan to visit QEP online</strong>
      </div>
    </section>
  `;
}

function renderFooter({ showQr = true } = {}) {
  return `
    <footer class="page-footer">
      <div>Quality Equipment &amp; Parts · ${escapeHtml(quote.quoteNumber)} · ${escapeHtml(quote.branch.web)}</div>
      ${showQr ? `<div class="qr"><img src="assets/qep-qr.png" alt="QEP website QR code" /><span>Scan to visit QEP online</span></div>` : `<div>${escapeHtml(quote.branch.address)} · ${escapeHtml(quote.branch.cityStateZip)} · ${escapeHtml(quote.branch.phone)}</div>`}
    </footer>
  `;
}

function renderHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(quote.quoteNumber)} Owner Feedback 2-Page Proposal</title>
  <style>
    :root { --orange:#f28a07; --charcoal:#111; --paper:#f7f4ef; --muted:#666; --line:#ded8cd; --green:#0f7a3a; }
    * { box-sizing: border-box; }
    html { background:#262626; }
    body { margin:0; color:#1d1d1d; font-family: Inter, Arial, Helvetica, sans-serif; line-height:1.28; -webkit-font-smoothing: antialiased; }
    .page { position:relative; width:8.5in; min-height:11in; margin:24px auto; padding:0.34in 0.42in 0.62in; background:white; box-shadow:0 18px 50px rgba(0,0,0,.28); overflow:hidden; }
    .page::before { content:""; position:absolute; inset:0; background:radial-gradient(circle at 83% 42%, rgba(242,138,7,.09), transparent 22%), radial-gradient(circle at 14% 74%, rgba(17,17,17,.05), transparent 20%); pointer-events:none; }
    .page > * { position:relative; z-index:1; }
    .letterhead { display:grid; grid-template-columns:1fr 2.68in; gap:.22in; padding-bottom:.1in; border-bottom:5px solid var(--orange); }
    .qep-logo { width:2.05in; max-height:.68in; object-fit:contain; object-position:left center; display:block; }
    .company-lines { margin-top:.04in; color:var(--muted); font-size:.073in; font-weight:700; }
    .vendor-strip { display:flex; gap:.06in; align-items:center; height:.34in; margin-top:.06in; }
    .vendor-strip img { max-height:.26in; max-width:.64in; object-fit:contain; filter:grayscale(1); }
    .meta-box { border:1px solid var(--charcoal); background:var(--paper); font-size:.068in; }
    .meta-branch { padding:.045in .07in; color:white; background:var(--charcoal); font-weight:900; text-align:center; letter-spacing:.012in; }
    .meta-grid { display:grid; grid-template-columns:.72in 1fr; gap:1px; padding:.045in .055in; }
    .meta-grid span { color:var(--muted); text-transform:uppercase; }
    .meta-grid strong { text-align:right; font-variant-numeric:tabular-nums; }
    .slim-header { display:flex; align-items:center; justify-content:space-between; gap:.15in; padding-bottom:.08in; border-bottom:4px solid var(--orange); }
    .slim-brand { display:flex; align-items:center; gap:.1in; }
    .slim-logo { width:1.25in; max-height:.42in; }
    .slim-brand strong { display:block; font-size:.105in; letter-spacing:.012in; }
    .slim-brand span { display:block; margin-top:.02in; color:var(--muted); font-size:.07in; font-weight:800; text-transform:uppercase; letter-spacing:.006in; }
    .slim-total { color:var(--orange); font-size:.2in; font-weight:900; font-variant-numeric:tabular-nums; }
    .address-grid { display:grid; grid-template-columns:1fr 1.35in 1.35in; gap:.09in; margin-top:.1in; }
    .address-card,.rep-card { padding:.075in; border:1px solid var(--line); background:rgba(247,244,239,.92); font-size:.076in; font-weight:750; min-height:.58in; }
    .rep-card { color:white; background:var(--charcoal); border-left:5px solid var(--orange); }
    .rep-card span { display:block; margin-top:.035in; color:#ddd; font-size:.063in; }
    .customer-card { min-height:.48in; }
    .subnote { margin-top:.035in; color:var(--muted); font-size:.065in; font-weight:800; }
    .quote-mini { display:grid; gap:.025in; }
    .quote-mini div { display:flex; justify-content:space-between; gap:.08in; font-size:.066in; }
    .quote-mini span { color:var(--muted); text-transform:uppercase; }
    .quote-mini strong { text-align:right; font-variant-numeric:tabular-nums; }
    .eyebrow { margin-bottom:.035in; color:var(--orange); font-size:.061in; font-weight:900; letter-spacing:.018in; text-transform:uppercase; }
    .document-banner { display:flex; justify-content:space-between; gap:.12in; align-items:center; margin-top:.1in; padding:.07in .1in; color:white; background:var(--charcoal); border-left:.07in solid var(--orange); }
    .document-banner span { font-size:.17in; font-weight:900; letter-spacing:.013in; }
    .document-banner small { color:#ddd; font-size:.067in; text-align:right; }
    .quote-summary { display:grid; grid-template-columns:1.65fr 1fr 1fr; gap:.08in; margin-top:.1in; padding:.08in .1in; color:white; background:var(--charcoal); border-left:.06in solid var(--orange); }
    .quote-summary div { display:flex; flex-direction:column; gap:.015in; }
    .quote-summary span { color:#d9d9d9; font-size:.062in; font-weight:900; text-transform:uppercase; letter-spacing:.018in; }
    .quote-summary strong { color:var(--orange); font-size:.14in; font-weight:900; font-variant-numeric:tabular-nums; }
    .quote-summary div:not(:first-child) strong { color:white; font-size:.09in; }
    .why-card { margin-top:.08in; padding:.08in .1in; background:var(--paper); border:1px solid var(--line); border-left:.05in solid var(--orange); }
    .why-card ul { columns:1; margin:.025in 0 0; padding-left:.14in; font-size:.075in; line-height:1.35; }
    .unit-grid { display:grid; grid-template-columns:1fr; gap:.095in; margin-top:.095in; }
    .unit-card { display:grid; grid-template-columns:2.25in 1fr; gap:.11in; border:1px solid var(--line); background:white; padding:.08in; page-break-inside:avoid; }
    .unit-photo { width:2.25in; height:1.38in; object-fit:cover; border-bottom:.05in solid var(--orange); }
    .unit-topline { display:grid; grid-template-columns:1fr 1fr .75in; gap:.05in; color:var(--charcoal); font-size:.064in; font-variant-numeric:tabular-nums; }
    .unit-topline strong:last-child { color:var(--orange); font-size:.088in; }
    h2 { margin:.035in 0 .02in; color:var(--charcoal); font-size:.105in; text-transform:uppercase; }
    .marketing,.product-line { margin:.018in 0; color:var(--muted); font-size:.066in; font-weight:700; }
    .warranty { display:inline-block; margin:.035in 0; padding:.025in .045in; color:var(--charcoal); background:#fff7ec; border:1px solid var(--orange); font-size:.063in; font-weight:900; }
    ul { columns:2; margin:.025in 0 0; padding-left:.1in; font-size:.061in; line-height:1.25; }
    li { break-inside:avoid; margin-bottom:.014in; }
    .commercial-grid { display:grid; grid-template-columns:1fr 2.55in; gap:.11in; margin-top:.12in; align-items:start; }
    .legacy-section,.terms-box,.totals-box,.finance-panel,.acceptance-block { border:1px solid var(--line); background:rgba(255,255,255,.96); padding:.085in; page-break-inside:avoid; }
    .legacy-section { margin-bottom:.09in; }
    .legacy-section h3,.finance-panel h3 { margin:0 0 .06in; color:var(--charcoal); font-size:.085in; text-transform:uppercase; letter-spacing:.012in; border-bottom:2px solid var(--orange); padding-bottom:.025in; }
    .trade-row { display:grid; grid-template-columns:1fr .72in; gap:.09in; font-size:.073in; }
    .trade-row p { margin:.02in 0; }
    .market-context { margin-top:.045in; padding:.045in; border-left:4px solid var(--orange); background:var(--paper); font-size:.064in; font-weight:800; }
    .credit { color:var(--green); }
    table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
    th { color:white; background:var(--charcoal); padding:.035in .045in; font-size:.058in; text-align:left; text-transform:uppercase; }
    td { border-bottom:1px solid var(--line); padding:.038in .045in; font-size:.067in; }
    td:not(:first-child),th:not(:first-child) { text-align:right; }
    .totals-box { border-top:.055in solid var(--orange); font-variant-numeric:tabular-nums; }
    .totals-box div { display:flex; justify-content:space-between; gap:.08in; padding:.035in 0; border-bottom:1px solid var(--line); font-size:.078in; }
    .totals-box small { display:block; margin:.045in 0; color:var(--muted); font-size:.061in; }
    .grand-total { margin-top:.04in; color:white; background:var(--charcoal); border:0 !important; padding:.07in !important; align-items:baseline; }
    .grand-total strong { color:var(--orange); font-size:.108in; }
    .finance-panel { margin-top:.1in; color:white; background:var(--charcoal); border-bottom:.06in solid var(--orange); }
    .finance-panel h3 { color:var(--orange); border-color:#444; }
    .finance-table th { background:#2b2b2b; }
    .finance-table td { color:white; border-color:#444; }
    .terms-box { margin-top:.1in; font-size:.071in; background:var(--paper); }
    .terms-box p { margin:.035in 0; }
    .legacy-disclaimer { font-size:.073in; font-weight:900; white-space:pre-line; }
    .tila { padding:.055in; background:white; border-left:4px solid var(--orange); font-size:.064in; font-weight:750; }
    .footer-copy { color:var(--muted); text-align:center; white-space:pre-line; font-weight:700; }
    .acceptance-block { display:grid; grid-template-columns:1fr 1.15in; gap:.1in; margin-top:.1in; border-top:.055in solid var(--orange); background:white; }
    .signature-grid { display:grid; grid-template-columns:1fr 1fr .72in; gap:.08in; margin:.035in 0; font-size:.062in; color:var(--muted); text-transform:uppercase; font-weight:900; }
    .signature-grid strong { display:block; min-height:.22in; border-bottom:1px solid var(--charcoal); }
    .acceptance-block p { margin:0; color:var(--muted); font-size:.062in; font-weight:750; }
    .qr-action { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:.04in; text-align:center; color:var(--charcoal); font-size:.062in; text-transform:uppercase; }
    .qr-action img { width:.72in; height:.72in; object-fit:contain; border:1px solid var(--line); }
    .page-footer { position:absolute; left:.42in; right:.42in; bottom:.22in; display:flex; justify-content:space-between; align-items:end; gap:.15in; border-top:1px solid var(--line); padding-top:.06in; color:var(--muted); font-size:.063in; font-weight:700; }
    .qr { display:flex; align-items:center; gap:.055in; color:var(--charcoal); text-transform:uppercase; }
    .qr img { width:.55in; height:.55in; object-fit:contain; border:1px solid var(--line); }
    @media print { html,body { background:white; } .page { margin:0; box-shadow:none; page-break-after:always; print-color-adjust:exact; -webkit-print-color-adjust:exact; } .page:last-child { page-break-after:auto; } }
  </style>
</head>
<body>
  <main>
    <article class="page">
      ${renderHeader(1)}
      ${renderAddressBlocks()}
      ${renderDocBanner()}
      ${renderQuoteSummary()}
      ${renderWhyBullets()}
      <section class="unit-grid">${quote.units.map((unit, index) => renderUnit(unit, index === 0)).join("")}</section>
      ${renderFooter()}
    </article>

    <article class="page">
      ${renderSlimHeader(2)}
      <section class="commercial-grid">
        <div>
          ${renderTradeIns()}
          ${renderParts()}
          ${renderMisc()}
        </div>
        <div>
          ${renderTotals()}
          ${renderAcceptanceBlock()}
        </div>
      </section>
      ${renderFinanceGrid()}
      ${renderCommentsAndCompliance()}
      ${renderFooter({ showQr: false })}
    </article>
  </main>
</body>
</html>`;
}

function renderTxt() {
  const units = quote.units.map((unit) => [
    `${unit.condition} ${unit.year} ${unit.make} ${unit.model}`,
    `Stock #: ${unit.stock}`,
    `Serial #: ${unit.serial}`,
    `Warranty: ${unit.warranty}`,
    `Amount: ${money(unit.amount)}`,
    `Specs: ${unit.specs.join("; ")}`,
  ].join("\n")).join("\n\n");

  return [
    `${quote.quoteNumber} OWNER-FEEDBACK 2-PAGE PROPOSAL`,
    "EQUIPMENT ESTIMATE - NOT AN INVOICE",
    `Customer: ${quote.customer.name} (${quote.customer.accountNo})`,
    `Salesperson: ${quote.salesperson.code} · ${quote.salesperson.name}`,
    `Quote Total: ${money(quote.taxes.total)}`,
    `Expiry Date: ${quote.prepared.expires}`,
    "",
    "WHY THIS MACHINE",
    quote.whyThisMachine,
    "",
    "EQUIPMENT",
    units,
    "",
    "TRADE INS",
    quote.tradeIns.map((trade) => `${trade.description} · Serial #: ${trade.serial} · ${signedAmount(trade.amount, true)} · ${trade.marketContext}`).join("\n"),
    "",
    "ADDITIONAL PARTS",
    quote.parts.map((part) => `${part.description} (${part.partNo}) x${part.qty}: ${money(part.qty * part.unitPrice)}`).join("\n"),
    "",
    "MISCELLANEOUS CHARGES/CREDITS",
    quote.misc.map((line) => `${line.description}: ${signedAmount(line.qty * line.unitPrice, line.credit)}`).join("\n"),
    "",
    `Subtotal: ${money(quote.taxes.subtotal)}`,
    `${quote.taxes.stateLabel}: ${money(quote.taxes.stateAmount)}`,
    `${quote.taxes.countyLabel}: ${money(quote.taxes.countyAmount)}`,
    quote.taxes.countyMath,
    `Authorization: _________________________   Quote Total: ${money(quote.taxes.total)}`,
    "",
    "FINANCE OPTIONS",
    quote.finance.map((row) => `${row.months} months · ${row.rate.toFixed(2)}% · ${money(row.payment)} · ${row.source}`).join("\n"),
    "",
    quote.comments,
    LEGACY_FINANCE_DISCLAIMER,
    TILA_DISCLAIMER,
    STANDARD_FOOTER,
  ].join("\n");
}

const requiredNeedles = [
  "assets/qep-logo.png",
  "assets/vendor-asv.png",
  "assets/vendor-cmi.png",
  "assets/vendor-develon.png",
  "assets/vendor-bandit.png",
  "assets/vendor-stacked.png",
  "assets/qep-qr.png",
  "Scan to visit QEP online",
  "assets/asv-rt135f.jpg",
  "assets/shearex-hm70sr.jpg",
  "EQUIPMENT ESTIMATE - NOT AN INVOICE",
  "Page</span><strong>1 of 2",
  "Page 2 of 2",
  "RYLEE001",
  "QEP-2026-0001",
  "Stock #: Q003403",
  "Serial #: ASVRT135LTDF01723",
  "Stock #: Q003475",
  "Serial #: 2500HC0440",
  "2 Year/ 2000 Hour Full Machine Warranty",
  "1 Year Attachment Warranty",
  "Trade Ins",
  "Serial #: 123456",
  "ADDITIONAL PARTS",
  "SHEAREX CARBIDE",
  "Miscellaneous Charges/Credits",
  "LESS DOWN PAYMENT RECD.",
  "Florida State 6.00%:",
  "COLUMBIA COUNTY:",
  "1.5% × $5,000 = $75.00",
  "Authorization: _________________________",
  "Quote Total: $144,110.65",
  "FINANCING BASED ON CREDIT APPROVAL",
  "Truth in Lending Act",
  "Thank You For Your Business!",
  "COMPARABLE MARKET RANGE — NOT A GUARANTEED OFFER",
];

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  copyRequiredAssets();
  const html = renderHtml();
  const txt = renderTxt();
  writeFileSync(HTML_PATH, html, "utf8");
  writeFileSync(TXT_PATH, txt, "utf8");

  const missing = requiredNeedles.filter((needle) => !html.includes(needle));
  if (missing.length > 0) {
    throw new Error(`Owner-feedback prototype verification failed. Missing: ${missing.join(", ")}`);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1500 } });
    await page.goto(`file://${HTML_PATH}`, { waitUntil: "networkidle" });
    await page.pdf({
      path: PDF_PATH,
      format: "Letter",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({ ok: true, html: HTML_PATH, pdf: PDF_PATH, txt: TXT_PATH, checks: requiredNeedles.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
