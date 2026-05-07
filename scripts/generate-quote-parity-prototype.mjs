#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "test-results/proposals");
const HTML_PATH = resolve(OUT_DIR, "QEP-2026-0001-moonshot-parity.html");
const PDF_PATH = resolve(OUT_DIR, "QEP-2026-0001-moonshot-parity.pdf");

const LEGACY_FINANCE_DISCLAIMER =
  "** FINANCING BASED ON CREDIT APPROVAL. INTEREST RATE MAY\nVARY. MONTHLY PAYMENTS ARE ESTIMATED **";

const STANDARD_FOOTER =
  "Good for thirty (30) days from date of quote.  This estimate is not a contract.  Estimate is based on initial inspection.\nDoes not cover any issues that came up when work started.  Prices not guaranteed.\n\nThank You For Your Business!";

const TILA_DISCLAIMER =
  "This is a payment estimate, not a guaranteed rate. Subject to credit approval. Rates shown are manufacturer-published programs, subject to change. QEP is not a lender.";

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
  prepared: {
    date: "05/07/2026",
    time: "13:15:21",
    origin: "O",
    expires: "06/06/2026",
  },
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
  salesperson: {
    code: "RM3",
    name: "Rylee McKenzie",
    email: "rylee@qepusa.com",
  },
  comments: "THIS IS THE COMMENTS BOX\nDelivery, final inspection, and attachment fit-up to be confirmed by QEP before release.",
  whyThisMachine:
    "This ASV RT-135F forestry track loader package gives the customer a high-flow, guarded carrier paired with a ShearEx HM-70SR mulching head. The configuration is built for land clearing, right-of-way cleanup, and heavy vegetation work while preserving QEP support visibility from quote through delivery.",
  units: [
    {
      stock: "Q003403",
      serial: "ASVRT135LTDF01723",
      amount: 148_950,
      condition: "New",
      year: "2026",
      make: "AV",
      model: "RT-135F",
      marketing: "New 2026 ASV RT-135F 132 HP FORESTRY TRACK LOADER",
      productLine: "ASV RT-135F Track Loader",
      warranty: "2 Year/ 2000 Hour Full Machine Warranty",
      specs: [
        "135F Forestry Skid Steer",
        "Cummins 3.8L Engine with 132HP",
        "All Weather Cab with Lexan Door",
        "Air Ride Seat Suspension",
        "Dual Hydraulic Drive Motors",
        "Reversing Fan",
        "2 Forward Facing Lights/ 2 Rear Facing",
        '7" Color Multifunction Display',
        "50 GPM High Flow",
        "4060 PSI System Pressure",
        "Rear Forestry Guarding",
        "Operating Weight: 12990 lbs",
        "Tipping Load: 11858 lbs",
        "Rated Operating Capacity: 4150 lbs",
        '20" Track Width',
      ],
    },
    {
      stock: "Q003475",
      serial: "2500HC0440",
      amount: 45_750,
      condition: "New",
      year: "2026",
      make: "SH",
      model: "HM-70SR",
      marketing: 'New 2026 SHEAREX HM-70SR 74" Mulching Head',
      productLine: "ShearEx HM Series Front Mount Mulcher",
      warranty: "1 Year Attachment Warranty",
      specs: [
        "HM Series Front Mount Mulcher",
        "Danfoss HD 110CC Motor",
        "Top Sharpened Cutting Teeth",
        "Convex Style Bite Control",
        "HD Stationary Push Bar",
        "Standard Quick Attach Plate",
        "Dewalt Grinder Kit",
        "Maintenance Kit",
        "Spare Set of Knives",
        'Working Width: 74.75"',
        'Overall Width: 88.50"',
        "Weight: 3100 lbs",
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
      marketContext: "COMPARABLE MARKET RANGE — NOT A GUARANTEED OFFER: $44,000 low / $52,000 midpoint / $58,000 high. Final allowance requires inspection checklist and manager approval.",
    },
  ],
  parts: [
    { description: "SHEAREX CARBIDE", partNo: "BD668", qty: 15, unitPrice: 41.11 },
  ],
  misc: [
    { description: "LESS DOWN PAYMENT RECD.", qty: 1, unitPrice: 10_000, credit: true },
    { description: "PDI / FINAL DEALER INSPECTION", qty: 1, unitPrice: 0, credit: false },
    { description: "FREIGHT / DELIVERY", qty: 1, unitPrice: 0, credit: false },
    { description: "DOC / TITLE / TAG / REGISTRATION", qty: 1, unitPrice: 0, credit: false },
  ],
  taxes: {
    subtotal: 135_316.65,
    stateLabel: "Florida State 6.00%",
    stateAmount: 8_719.00,
    countyLabel: "COLUMBIA COUNTY",
    countyAmount: 75.00,
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

function money(value) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signedAmount(value, credit = false) {
  return `${money(value)}${credit ? "-" : ""}`;
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

function renderHeader(page, totalPages) {
  return `
    <header class="letterhead">
      <div class="brand">
        <div class="logo-lockup">
          <div class="gear-mark">Q</div>
          <div>
            <div class="brand-name">Quality Equipment &amp; Parts</div>
            <div class="tagline">IT'S IN THE NAME</div>
          </div>
        </div>
        <div class="company-lines">
          ${escapeHtml(quote.branch.address)} • ${escapeHtml(quote.branch.cityStateZip)}<br />
          Phone ${escapeHtml(quote.branch.phone)} • Fax ${escapeHtml(quote.branch.fax)} • ${escapeHtml(quote.branch.web)}
        </div>
        <div class="oem-badges">
          <span>DEVELON</span><span>Bandit Industries, Inc.</span><span>YANMAR</span><span>asv</span>
        </div>
      </div>
      <div class="meta-box">
        <div class="meta-branch">${escapeHtml(quote.branch.code)} - ${escapeHtml(quote.branch.name)}</div>
        <div class="meta-grid">
          <span>Date</span><strong>${escapeHtml(quote.prepared.date)}</strong>
          <span>Time</span><strong>${escapeHtml(quote.prepared.time)} (${escapeHtml(quote.prepared.origin)})</strong>
          <span>Page</span><strong>${page} of ${totalPages}</strong>
          <span>Account No</span><strong>${escapeHtml(quote.customer.accountNo)}</strong>
          <span>Phone</span><strong>${escapeHtml(quote.customer.phone)}</strong>
          <span>Quote No</span><strong>${escapeHtml(quote.quoteNumber)}</strong>
          <span>Legacy Ref</span><strong>${escapeHtml(quote.legacyReference)}</strong>
          <span>Ship Via</span><strong>${escapeHtml(quote.customer.shipVia)}</strong>
          <span>Purchase Order</span><strong>${escapeHtml(quote.customer.purchaseOrder || "—")}</strong>
          <span>Tax ID No</span><strong>${escapeHtml(quote.customer.taxIdNo || "—")}</strong>
          <span>Salesperson</span><strong>${escapeHtml(`${quote.salesperson.code} · ${quote.salesperson.name}`)}</strong>
        </div>
      </div>
    </header>
  `;
}

function renderAddressBlocks() {
  return `
    <section class="address-grid">
      <div class="address-card">
        <div class="eyebrow">Ship To:</div>
        ${paragraphLines(quote.customer.shipTo)}
      </div>
      <div class="address-card">
        <div class="eyebrow">Invoice To:</div>
        ${paragraphLines(quote.customer.invoiceTo)}
      </div>
      <div class="rep-card">
        <div class="eyebrow">Prepared By</div>
        <strong>${escapeHtml(quote.salesperson.name)}</strong>
        <span>${escapeHtml(quote.salesperson.code)} · ${escapeHtml(quote.salesperson.email)}</span>
      </div>
    </section>
  `;
}

function renderDocBanner() {
  return `
    <section class="document-banner">
      <span>EQUIPMENT ESTIMATE - NOT AN INVOICE</span>
      <small>${escapeHtml(quote.title)} · ${escapeHtml(quote.quoteNumber)}</small>
    </section>
    <div class="quote-column-head">
      <span>Description</span>
      <strong>** Q U O T E **</strong>
      <span>EXPIRY DATE: ${escapeHtml(quote.prepared.expires)}</span>
      <span class="amount-head">Amount</span>
    </div>
  `;
}

function renderUnit(unit) {
  return `
    <section class="unit-card">
      <div class="unit-topline">
        <strong>Stock #: ${escapeHtml(unit.stock)}</strong>
        <strong>Serial #: ${escapeHtml(unit.serial)}</strong>
        <strong class="amount">${money(unit.amount)}</strong>
      </div>
      <div class="unit-grid">
        <div class="hero-photo">
          <div class="machine-silhouette">${escapeHtml(unit.make)}</div>
          <span>${escapeHtml(`${unit.year} ${unit.model}`)}</span>
        </div>
        <div>
          <h2>${escapeHtml(`${unit.condition} ${unit.year} ${unit.make} ${unit.model}`)}</h2>
          <p class="marketing">${escapeHtml(unit.marketing)}</p>
          <p class="product-line">${escapeHtml(unit.productLine)}</p>
          <div class="spec-box">
            <div class="spec-title">INCLUDING THE FOLLOWING OPTIONS:</div>
            <ul>${unit.specs.map((spec) => `<li>${escapeHtml(spec)}</li>`).join("")}</ul>
          </div>
          <div class="warranty">**${escapeHtml(unit.warranty)}**</div>
        </div>
      </div>
    </section>
  `;
}

function renderTradeIns() {
  return `
    <section class="legacy-section">
      <h3>Trade Ins</h3>
      ${quote.tradeIns.map((trade) => `
        <div class="trade-row">
          <div>
            <strong>Serial #: ${escapeHtml(trade.serial)}</strong>
            <p>${escapeHtml(trade.description)}</p>
            <p>${escapeHtml(trade.inclusions)}</p>
            <p>${escapeHtml(trade.notes)}</p>
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
      <table class="parts-table">
        <thead><tr><th>Description</th><th>Part #</th><th>Qty</th><th>Unit Price</th><th>Extended</th></tr></thead>
        <tbody>
          ${quote.parts.map((part) => `
            <tr>
              <td>${escapeHtml(part.description)}</td>
              <td>${escapeHtml(part.partNo)}</td>
              <td>${part.qty}</td>
              <td>${money(part.unitPrice)}</td>
              <td>${money(part.qty * part.unitPrice)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderMisc() {
  return `
    <section class="legacy-section">
      <h3>Miscellaneous Charges/Credits</h3>
      <table class="parts-table">
        <thead><tr><th>Description</th><th>Qty</th><th>Price</th><th>Extended</th></tr></thead>
        <tbody>
          ${quote.misc.map((line) => `
            <tr>
              <td>${escapeHtml(line.description)}</td>
              <td>${line.qty}</td>
              <td>${money(line.unitPrice)}</td>
              <td class="${line.credit ? "credit" : ""}">${signedAmount(line.qty * line.unitPrice, line.credit)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderTotalsAndDisclaimers() {
  return `
    <section class="totals-grid">
      <div class="comments-box">
        <div class="eyebrow">Comments Box</div>
        <p>${escapeHtml(quote.comments).replaceAll("\n", "<br />")}</p>
        <p class="legacy-disclaimer">${escapeHtml(LEGACY_FINANCE_DISCLAIMER).replaceAll("\n", "<br />")}</p>
        <p class="tila">${escapeHtml(TILA_DISCLAIMER)}</p>
      </div>
      <div class="totals-box">
        <div><span>Subtotal:</span><strong>${money(quote.taxes.subtotal)}</strong></div>
        <div><span>${escapeHtml(quote.taxes.stateLabel)}:</span><strong>${money(quote.taxes.stateAmount)}</strong></div>
        <div><span>${escapeHtml(quote.taxes.countyLabel)}:</span><strong>${money(quote.taxes.countyAmount)}</strong></div>
        <small>${escapeHtml(quote.taxes.countyMath)}</small>
        <div class="grand-total"><span>Authorization: _________________________</span><strong>Quote Total: ${money(quote.taxes.total)}</strong></div>
      </div>
    </section>
  `;
}

function renderFinanceGrid() {
  return `
    <section class="finance-panel">
      <h2>Finance Options</h2>
      <table class="finance-table">
        <thead>
          <tr><th>Months</th>${quote.finance.map((row) => `<th>${row.months}</th>`).join("")}</tr>
        </thead>
        <tbody>
          <tr><th>%Rate</th>${quote.finance.map((row) => `<td>${row.rate.toFixed(2)}</td>`).join("")}</tr>
          <tr><th>$Payment</th>${quote.finance.map((row) => `<td>${money(row.payment)}</td>`).join("")}</tr>
          <tr><th>APR Source</th>${quote.finance.map((row) => `<td>${escapeHtml(row.source)}</td>`).join("")}</tr>
        </tbody>
      </table>
      <p class="legacy-disclaimer">${escapeHtml(LEGACY_FINANCE_DISCLAIMER).replaceAll("\n", "<br />")}</p>
      <p class="tila">${escapeHtml(TILA_DISCLAIMER)}</p>
    </section>
  `;
}

function renderFooter() {
  return `
    <footer class="page-footer">
      <div class="footer-copy">${escapeHtml(STANDARD_FOOTER).replaceAll("\n", "<br />")}</div>
      <div class="qr">
        <div class="qr-box">
          <span></span><span></span><span></span><span></span>
          <span></span><span></span><span></span><span></span>
          <span></span><span></span><span></span><span></span>
          <span></span><span></span><span></span><span></span>
        </div>
        <strong>Visit our Website</strong>
        <small>https://www.qepusa.com</small>
      </div>
    </footer>
  `;
}

function renderHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(quote.quoteNumber)} Moonshot Quote Parity Prototype</title>
  <style>
    :root {
      --orange: #f28a07;
      --charcoal: #111111;
      --surface: #1d1d1d;
      --paper: #f7f4ef;
      --muted: #6b6b6b;
      --line: #ded8cd;
      --green: #0f7a3a;
    }
    * { box-sizing: border-box; }
    html { background: #282828; }
    body {
      margin: 0;
      color: var(--surface);
      font-family: Inter, Arial, Helvetica, sans-serif;
      line-height: 1.35;
      -webkit-font-smoothing: antialiased;
    }
    .page {
      position: relative;
      width: 8.5in;
      min-height: 11in;
      margin: 24px auto;
      padding: 0.42in 0.48in 0.52in;
      background:
        radial-gradient(circle at 85% 45%, rgba(242, 138, 7, 0.10), transparent 16%),
        radial-gradient(circle at 22% 54%, rgba(17, 17, 17, 0.055), transparent 18%),
        white;
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
      overflow: hidden;
    }
    .page::before {
      content: "⚙";
      position: absolute;
      inset: 2.1in auto auto 1.0in;
      color: rgba(17, 17, 17, 0.035);
      font-size: 5.8in;
      line-height: 1;
      transform: rotate(-14deg);
      z-index: 0;
    }
    .page > * { position: relative; z-index: 1; }
    .letterhead {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 2.82in;
      gap: 0.25in;
      padding-bottom: 0.16in;
      border-bottom: 5px solid var(--orange);
    }
    .logo-lockup { display: flex; gap: 0.13in; align-items: center; }
    .gear-mark {
      display: grid;
      place-items: center;
      width: 0.58in;
      height: 0.58in;
      color: white;
      background: var(--orange);
      border: 8px solid var(--charcoal);
      border-radius: 999px;
      font-family: "Barlow Condensed", Impact, sans-serif;
      font-weight: 900;
      font-size: 0.26in;
    }
    .brand-name {
      color: var(--charcoal);
      font-family: "Barlow Condensed", Impact, sans-serif;
      font-size: 0.26in;
      font-weight: 900;
      letter-spacing: 0.015in;
      text-transform: uppercase;
    }
    .tagline {
      display: inline-block;
      margin-top: 0.035in;
      padding: 0.025in 0.08in;
      color: white;
      background: var(--charcoal);
      border-left: 0.06in solid var(--orange);
      font-size: 0.078in;
      font-weight: 900;
      letter-spacing: 0.035in;
    }
    .company-lines { margin-top: 0.1in; color: var(--muted); font-size: 0.086in; }
    .oem-badges { display: flex; flex-wrap: wrap; gap: 0.055in; margin-top: 0.12in; }
    .oem-badges span {
      border: 1px solid var(--charcoal);
      border-left: 4px solid var(--orange);
      padding: 0.035in 0.062in;
      color: var(--charcoal);
      background: #fff;
      font-size: 0.068in;
      font-weight: 900;
      letter-spacing: 0.012in;
      text-transform: uppercase;
    }
    .meta-box {
      border: 1px solid var(--charcoal);
      border-top: 0.055in solid var(--charcoal);
      background: var(--paper);
      font-size: 0.074in;
    }
    .meta-branch {
      padding: 0.055in 0.08in;
      color: white;
      background: var(--charcoal);
      font-weight: 900;
      letter-spacing: 0.012in;
      text-align: center;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 0.84in 1fr;
      gap: 1px;
      padding: 0.055in;
    }
    .meta-grid span { color: var(--muted); text-transform: uppercase; }
    .meta-grid strong { text-align: right; font-variant-numeric: tabular-nums; }
    .address-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1.28in;
      gap: 0.12in;
      margin-top: 0.18in;
    }
    .address-card, .rep-card {
      min-height: 0.86in;
      padding: 0.1in;
      border: 1px solid var(--line);
      background: rgba(247, 244, 239, 0.92);
      font-size: 0.088in;
      font-weight: 700;
    }
    .rep-card { background: var(--charcoal); color: white; border-left: 5px solid var(--orange); }
    .rep-card span { display: block; margin-top: 0.05in; color: #c8c8c8; font-size: 0.074in; }
    .eyebrow {
      margin-bottom: 0.055in;
      color: var(--orange);
      font-size: 0.07in;
      font-weight: 900;
      letter-spacing: 0.02in;
      text-transform: uppercase;
    }
    .document-banner {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 0.18in;
      padding: 0.09in 0.12in;
      color: white;
      background: var(--charcoal);
      border-left: 0.08in solid var(--orange);
    }
    .document-banner span {
      font-family: "Barlow Condensed", Impact, sans-serif;
      font-size: 0.21in;
      font-weight: 900;
      letter-spacing: 0.016in;
    }
    .document-banner small { color: #d8d8d8; font-size: 0.08in; }
    .quote-column-head {
      display: grid;
      grid-template-columns: 1fr 1fr 1.35fr 0.9in;
      gap: 0.1in;
      margin-top: 0.13in;
      padding: 0.075in 0.09in;
      color: var(--charcoal);
      background: #fff7ec;
      border: 1px solid var(--orange);
      font-size: 0.086in;
      font-weight: 900;
    }
    .amount-head { text-align: right; }
    .moonshot-hero {
      display: grid;
      grid-template-columns: 1fr 2.05in;
      gap: 0.18in;
      margin-top: 0.18in;
    }
    h1 {
      margin: 0;
      font-family: "Barlow Condensed", Impact, sans-serif;
      color: var(--charcoal);
      font-size: 0.42in;
      line-height: 0.9;
      letter-spacing: -0.008in;
      text-transform: uppercase;
    }
    .why {
      margin-top: 0.13in;
      padding: 0.14in;
      color: white;
      background: var(--charcoal);
      border-left: 0.065in solid var(--orange);
      font-size: 0.096in;
    }
    .total-callout {
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 0.16in;
      color: white;
      background: linear-gradient(135deg, var(--charcoal), #323232);
      border-bottom: 0.06in solid var(--orange);
      text-align: right;
    }
    .total-callout small { color: #c7c7c7; font-weight: 900; letter-spacing: 0.02in; text-transform: uppercase; }
    .total-callout strong { color: var(--orange); font-size: 0.3in; font-weight: 900; }
    .unit-card {
      margin-top: 0.15in;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.94);
      page-break-inside: avoid;
    }
    .unit-topline {
      display: grid;
      grid-template-columns: 1.1in 1.65in 1fr;
      gap: 0.08in;
      padding: 0.075in 0.1in;
      color: white;
      background: var(--charcoal);
      font-size: 0.082in;
      font-variant-numeric: tabular-nums;
    }
    .unit-topline .amount { color: var(--orange); text-align: right; }
    .unit-grid {
      display: grid;
      grid-template-columns: 1.58in 1fr;
      gap: 0.14in;
      padding: 0.12in;
    }
    .hero-photo {
      display: grid;
      place-items: center;
      min-height: 1.48in;
      color: white;
      background:
        linear-gradient(160deg, rgba(242, 138, 7, 0.92), rgba(17, 17, 17, 0.95)),
        repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0 3px, transparent 3px 8px);
      text-align: center;
      overflow: hidden;
    }
    .machine-silhouette { font-family: Impact, sans-serif; font-size: 0.34in; letter-spacing: 0.02in; }
    .hero-photo span { display: block; margin-top: -0.28in; font-size: 0.08in; font-weight: 900; letter-spacing: 0.02in; }
    .unit-card h2 {
      margin: 0;
      font-size: 0.16in;
      color: var(--charcoal);
      font-weight: 900;
      text-transform: uppercase;
    }
    .marketing, .product-line { margin: 0.035in 0; color: var(--muted); font-size: 0.086in; font-weight: 700; }
    .spec-box {
      margin-top: 0.08in;
      padding: 0.08in 0.1in;
      border-top: 2px solid var(--charcoal);
      border-bottom: 2px solid var(--charcoal);
      background: var(--paper);
    }
    .spec-title {
      margin-bottom: 0.035in;
      color: var(--orange);
      font-size: 0.07in;
      font-weight: 900;
      letter-spacing: 0.018in;
      text-transform: uppercase;
    }
    ul {
      columns: 2;
      margin: 0;
      padding-left: 0.13in;
      font-size: 0.075in;
    }
    li { break-inside: avoid; margin-bottom: 0.025in; }
    .warranty {
      display: inline-block;
      margin-top: 0.08in;
      padding: 0.05in 0.08in;
      color: var(--charcoal);
      background: #fff7ec;
      border: 1px solid var(--orange);
      font-size: 0.085in;
      font-weight: 900;
    }
    .legacy-section {
      margin-top: 0.17in;
      padding: 0.11in;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.94);
      page-break-inside: avoid;
    }
    .legacy-section h3 {
      width: fit-content;
      margin: -0.22in auto 0.1in;
      padding: 0.035in 0.2in;
      color: white;
      background: var(--charcoal);
      border-bottom: 0.045in solid var(--orange);
      font-size: 0.105in;
      text-align: center;
      letter-spacing: 0;
      white-space: nowrap;
    }
    .legacy-section h3::after {
      content: "";
      display: block;
      height: 2px;
      margin-top: 0.035in;
      background: repeating-linear-gradient(90deg, white 0 6px, transparent 6px 10px);
    }
    .trade-row {
      display: grid;
      grid-template-columns: 1fr 1.2in;
      gap: 0.16in;
      font-size: 0.087in;
    }
    .trade-row p { margin: 0.025in 0; }
    .credit { color: var(--green); }
    .market-context {
      margin-top: 0.08in;
      padding: 0.075in 0.09in;
      border-left: 4px solid var(--orange);
      background: var(--paper);
      color: var(--charcoal);
      font-size: 0.074in;
      font-weight: 800;
    }
    table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    th {
      color: white;
      background: var(--charcoal);
      padding: 0.055in 0.065in;
      font-size: 0.071in;
      text-align: left;
      text-transform: uppercase;
      letter-spacing: 0.011in;
    }
    td {
      border-bottom: 1px solid var(--line);
      padding: 0.06in 0.065in;
      font-size: 0.083in;
    }
    td:not(:first-child), th:not(:first-child) { text-align: right; }
    .totals-grid {
      display: grid;
      grid-template-columns: 1fr 2.7in;
      gap: 0.18in;
      margin-top: 0.17in;
      align-items: stretch;
    }
    .comments-box, .totals-box {
      padding: 0.13in;
      border: 1px solid var(--line);
      background: rgba(247, 244, 239, 0.95);
      font-size: 0.083in;
    }
    .totals-box {
      border-top: 0.06in solid var(--orange);
      font-variant-numeric: tabular-nums;
    }
    .totals-box div {
      display: flex;
      justify-content: space-between;
      gap: 0.12in;
      padding: 0.045in 0;
      border-bottom: 1px solid var(--line);
    }
    .totals-box small { display: block; margin: 0.06in 0; color: var(--muted); font-size: 0.07in; }
    .totals-box .grand-total {
      align-items: baseline;
      margin-top: 0.07in;
      color: white;
      background: var(--charcoal);
      border: 0;
      padding: 0.085in;
    }
    .grand-total span { color: #fff; font-weight: 900; }
    .grand-total strong { color: var(--orange); font-size: 0.13in; }
    .legacy-disclaimer {
      margin-top: 0.1in;
      font-size: 0.085in;
      font-weight: 900;
      white-space: pre-line;
    }
    .tila {
      margin-top: 0.08in;
      padding: 0.075in;
      color: var(--charcoal);
      background: white;
      border-left: 4px solid var(--orange);
      font-size: 0.072in;
      font-weight: 700;
    }
    .finance-panel {
      margin-top: 0.22in;
      padding: 0.18in;
      color: white;
      background: var(--charcoal);
      border-bottom: 0.08in solid var(--orange);
    }
    .finance-panel h2 {
      margin: 0 0 0.12in;
      color: var(--orange);
      font-family: "Barlow Condensed", Impact, sans-serif;
      font-size: 0.28in;
      text-align: center;
      letter-spacing: 0.02in;
      text-transform: uppercase;
    }
    .finance-table th { background: #2b2b2b; }
    .finance-table td { color: white; border-color: #444; }
    .finance-table tbody tr:nth-child(2) td { color: var(--orange); font-size: 0.12in; font-weight: 900; }
    .finance-panel .legacy-disclaimer, .finance-panel .tila { color: white; }
    .finance-panel .tila { color: var(--charcoal); }
    .page-footer {
      position: absolute;
      left: 0.48in;
      right: 0.48in;
      bottom: 0.28in;
      display: grid;
      grid-template-columns: 1fr 0.95in;
      gap: 0.2in;
      align-items: end;
      padding-top: 0.1in;
      border-top: 1px solid var(--line);
    }
    .footer-copy {
      color: var(--muted);
      font-size: 0.074in;
      font-weight: 700;
      white-space: pre-line;
      text-align: center;
    }
    .qr { text-align: center; font-size: 0.065in; color: var(--muted); }
    .qr strong { display: block; margin-top: 0.035in; color: var(--charcoal); text-transform: uppercase; }
    .qr-box {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 3px;
      width: 0.62in;
      height: 0.62in;
      margin-left: auto;
      padding: 0.055in;
      background: white;
      border: 2px solid var(--charcoal);
    }
    .qr-box span:nth-child(3n), .qr-box span:nth-child(4n+1) { background: var(--charcoal); }
    .qr-box span { background: var(--orange); }
    @media print {
      html, body { background: white; }
      .page {
        margin: 0;
        box-shadow: none;
        page-break-after: always;
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
      .page:last-child { page-break-after: auto; }
    }
  </style>
</head>
<body>
  <main>
    <article class="page">
      ${renderHeader(1, 4)}
      ${renderAddressBlocks()}
      ${renderDocBanner()}
      <section class="moonshot-hero">
        <div>
          <h1>Moonshot equipment proposal with IntelliDealer parity.</h1>
          <div class="why"><strong>Why this machine:</strong> ${escapeHtml(quote.whyThisMachine)}</div>
        </div>
        <aside class="total-callout">
          <small>Quote Total</small>
          <strong>${money(quote.taxes.total)}</strong>
          <small>Valid through ${escapeHtml(quote.prepared.expires)}</small>
        </aside>
      </section>
      ${renderUnit(quote.units[0])}
      ${renderFooter()}
    </article>

    <article class="page">
      ${renderHeader(2, 4)}
      ${renderAddressBlocks()}
      ${renderDocBanner()}
      ${renderUnit(quote.units[1])}
      ${renderTradeIns()}
      ${renderParts()}
      ${renderFooter()}
    </article>

    <article class="page">
      ${renderHeader(3, 4)}
      ${renderAddressBlocks()}
      ${renderDocBanner()}
      ${renderMisc()}
      ${renderTotalsAndDisclaimers()}
      ${renderFooter()}
    </article>

    <article class="page">
      ${renderHeader(4, 4)}
      ${renderAddressBlocks()}
      ${renderDocBanner()}
      ${renderFinanceGrid()}
      <section class="legacy-section">
        <h3>Acceptance Flow Preview</h3>
        <p><strong>QR destination placeholder:</strong> a branded QEP landing page for ${escapeHtml(quote.quoteNumber)} with quote status, accept button, contact rep button, and customer feedback prompt.</p>
        <p><strong>Signature requirement:</strong> customer authorization line appears on the same row as Quote Total before the proposal can be accepted.</p>
      </section>
      ${renderFooter()}
    </article>
  </main>
</body>
</html>`;
}

const requiredNeedles = [
  "Quality Equipment &amp; Parts",
  "IT'S IN THE NAME",
  "DEVELON",
  "Bandit Industries, Inc.",
  "YANMAR",
  "asv",
  "01 - LAKE CITY",
  "Page</span><strong>1 of 4",
  "Page</span><strong>2 of 4",
  "Page</span><strong>3 of 4",
  "Page</span><strong>4 of 4",
  "RYLEE001",
  "3862923743",
  "QEP-2026-0001",
  "Ship Via",
  "Purchase Order",
  "Tax ID No",
  "RM3 · Rylee McKenzie",
  "Ship To:",
  "Invoice To:",
  "EQUIPMENT ESTIMATE - NOT AN INVOICE",
  "Stock #: Q003403",
  "Serial #: ASVRT135LTDF01723",
  "Stock #: Q003475",
  "Serial #: 2500HC0440",
  "INCLUDING THE FOLLOWING OPTIONS:",
  "**2 Year/ 2000 Hour Full Machine Warranty**",
  "**1 Year Attachment Warranty**",
  "Trade Ins",
  "Serial #: 123456",
  "$50,000.00-",
  "ADDITIONAL PARTS",
  "SHEAREX CARBIDE",
  "Miscellaneous Charges/Credits",
  "LESS DOWN PAYMENT RECD.",
  "Subtotal:",
  "Florida State 6.00%:",
  "COLUMBIA COUNTY:",
  "1.5% × $5,000 = $75.00",
  "Authorization: _________________________",
  "Quote Total: $144,110.65",
  "THIS IS THE COMMENTS BOX",
  "FINANCING BASED ON CREDIT APPROVAL",
  "This is a payment estimate, not a guaranteed rate. Subject to credit approval. Rates shown are manufacturer-published programs, subject to change. QEP is not a lender.",
  "Finance Options",
  "$4,003.07",
  "Good for thirty (30) days from date of quote.  This estimate is not a contract.  Estimate is based on initial inspection.",
  "Thank You For Your Business!",
  "Visit our Website",
  "https://www.qepusa.com",
  "COMPARABLE MARKET RANGE — NOT A GUARANTEED OFFER",
];

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const html = renderHtml();
  writeFileSync(HTML_PATH, html, "utf8");

  const missing = requiredNeedles.filter((needle) => !html.includes(needle));
  if (missing.length > 0) {
    throw new Error(`Parity prototype verification failed. Missing: ${missing.join(", ")}`);
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

  console.log(JSON.stringify({
    ok: true,
    html: HTML_PATH,
    pdf: PDF_PATH,
    checks: requiredNeedles.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
