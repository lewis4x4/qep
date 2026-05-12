#!/usr/bin/env node

/**
 * QEP Quote Proposal Prototype — Owner Feedback v2 (2026-05-11)
 *
 * Renders two prototype PDFs for Rylee + owner review:
 *
 *   1. QEP-2026-0001-owner-feedback-v2-onepage.pdf
 *      Slim case: single unit, no trade, no parts, no misc → 1 page default.
 *      Demonstrates section-suppression behavior (empty trade/parts/misc never render).
 *
 *   2. QEP-2026-0001-owner-feedback-v2-fullquote.pdf
 *      Full Q02699-parity case: 2 units + trade + parts + misc + finance.
 *      Demonstrates 2-page premium layout with all required compliance copy.
 *
 * Both share one renderer. The renderer applies Rylee's eight v2 changes:
 *   1. Body type bumped (~12pt body, ~10pt tables).
 *   2. Redundant document subtitle removed from the EQUIPMENT ESTIMATE banner.
 *   3. Rep card expanded with full QEP sig block (name / title / mobile / office / email).
 *   4. Comparable-market-range copy removed from customer-facing trade rows.
 *   5. $0 Misc Charges rows suppressed; if section empties out, entire section is hidden.
 *   6. Subtotal box LEFT, signature card RIGHT, same row, both below misc charges.
 *   7. Monthly payment is the dominant visual in the finance grid.
 *   8. One-page default: empty trade / parts / misc never render (header + body suppressed).
 *
 * Real assets are pulled from /Users/brianlewis/Downloads/reaiagent and copied into
 * test-results/proposals/assets/ at run time. Missing assets fail loudly.
 */

import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "test-results/proposals");
const ASSET_SOURCE = "/Users/brianlewis/Downloads/reaiagent";
const ASSET_DEST = resolve(OUT_DIR, "assets");

const ASSET_MAP = {
  "ITS IN THE NAME Quality Logo- PNG.png": "qep-its-in-the-name-logo.png",
  "ASVLogo_AllBlack_PNG.png": "vendor-asv.png",
  "CMI_LogoENG-Couleur.png": "vendor-cmi.png",
  "Develon-logo Black.png": "vendor-develon.png",
  "New Bandit_Authorized_Logo_BLACK.png": "vendor-bandit-authorized.png",
  "StackedLogo.png": "vendor-yanmar.png",
  "Untitled design (8).png": "qep-qr-acceptance.png",
  "IMG_5439.JPG": "package-rt135f-shearex.jpg",
  "IMG_2090.JPG": "attachment-shearex-hm70sr.jpg",
};

const ASSETS = {
  qepLogo: "assets/qep-its-in-the-name-logo.png",
  vendors: [
    { src: "assets/vendor-asv.png", alt: "ASV" },
    { src: "assets/vendor-bandit-authorized.png", alt: "Bandit Industries (Authorized Dealer)" },
    { src: "assets/vendor-cmi.png", alt: "CMI" },
    { src: "assets/vendor-develon.png", alt: "Develon" },
    { src: "assets/vendor-yanmar.png", alt: "Yanmar" },
  ],
  qr: "assets/qep-qr-acceptance.png",
  unitHero: "assets/package-rt135f-shearex.jpg",
  unitThumb: "assets/attachment-shearex-hm70sr.jpg",
};

const LEGACY_FINANCE_DISCLAIMER =
  "** FINANCING BASED ON CREDIT APPROVAL. INTEREST RATE MAY VARY. MONTHLY PAYMENTS ARE ESTIMATED **";

const STANDARD_FOOTER =
  "Good for thirty (30) days from date of quote.  This estimate is not a contract.  Estimate is based on initial inspection. Does not cover any issues that came up when work started.  Prices not guaranteed.";

const TILA_DISCLAIMER =
  "This is a payment estimate, not a guaranteed rate. Subject to credit approval. Rates shown are manufacturer-published programs, subject to change. QEP is not a lender.";

const BRANCH = {
  code: "01",
  name: "LAKE CITY",
  address: "4894 NW US Highway 41",
  cityStateZip: "Lake City, Florida 32055",
  phone: "(386) 754-6186",
  fax: "(386) 888-1413",
  web: "www.qepusa.com",
};

const SALESPERSON = {
  code: "RM3",
  name: "Rylee McKenzie",
  title: "Iron Manager",
  mobile: "(386) 292-3743",
  office: "(386) 754-6189",
  email: "rylee@qepusa.com",
};

const CUSTOMER = {
  accountNo: "RYLEE001",
  phone: "(386) 292-3743",
  name: "RYLEE MCKENZIE",
  invoiceTo: ["RYLEE MCKENZIE", "20843 CR 49", "O'BRIEN FL 32071"],
  shipTo: ["RYLEE MCKENZIE", "20843 CR 49", "O'BRIEN FL 32071"],
  taxIdNo: "",
  purchaseOrder: "",
  shipVia: "QEP DELIVERY",
};

const PREPARED = {
  date: "05/07/2026",
  time: "13:15:21",
  origin: "O",
  expires: "06/06/2026",
};

const UNIT_RT135F = {
  stock: "Q003403",
  serial: "ASVRT135LTDF01723",
  amount: 148_950,
  condition: "New",
  year: "2026",
  make: "ASV",
  model: "RT-135F",
  productLine: "2026 ASV RT-135F · 132 HP Forestry Track Loader",
  warranty: "2 Year / 2000 Hour Full Machine Warranty",
  heroImg: ASSETS.unitHero,
  // Lead specs only — capped at 7 per Rylee's request.
  specs: [
    "Cummins 3.8L · 132 HP",
    "All-Weather Cab w/ Lexan Door",
    "Air-Ride Seat Suspension",
    "50 GPM High-Flow Hydraulics",
    "Rear Forestry Guarding",
    "Operating Weight 12,990 lbs",
    "Rated Operating Capacity 4,150 lbs",
  ],
};

const UNIT_SHEAREX = {
  stock: "Q003475",
  serial: "2500HC0440",
  amount: 45_750,
  condition: "New",
  year: "2026",
  make: "ShearEx",
  model: "HM-70SR",
  productLine: '2026 ShearEx HM-70SR · 74" Front-Mount Mulcher',
  warranty: "1 Year Attachment Warranty",
  thumbImg: ASSETS.unitThumb,
  specs: [
    "Danfoss HD 110cc Motor",
    "Top-Sharpened Carbide Teeth",
    "Convex Bite Control",
    "HD Stationary Push Bar",
    "Standard Quick-Attach Plate",
    'Working Width 74.75"',
  ],
};

const FULL_QUOTE = {
  title: "EQUIPMENT QUOTE",
  quoteNumber: "QEP-2026-0001",
  legacyReference: "Q02699",
  branch: BRANCH,
  prepared: PREPARED,
  customer: CUSTOMER,
  salesperson: SALESPERSON,
  comments:
    "Delivery, final inspection, and attachment fit-up to be confirmed by QEP before release. Operator walk-through included.",
  whyThisMachine:
    "The ASV RT-135F paired with the ShearEx HM-70SR is configured for land clearing, right-of-way cleanup, and heavy vegetation work — high-flow carrier, guarded cab, sharp-tooth mulching head.",
  units: [UNIT_RT135F, UNIT_SHEAREX],
  tradeIns: [
    {
      serial: "123456",
      amount: 50_000,
      year: "2021",
      makeModel: "CAT 299D3",
      inclusions: "Bucket Included",
      notes: "Subject to physical inspection and operating hour verification.",
    },
  ],
  parts: [
    { description: "SHEAREX CARBIDE TEETH", partNo: "BD668", qty: 15, unitPrice: 41.11 },
  ],
  // Raw misc — script filters $0 rows automatically per Rylee's rule.
  miscRaw: [
    { description: "LESS DOWN PAYMENT RECD.", qty: 1, unitPrice: 10_000, credit: true },
    { description: "PDI / FINAL DEALER INSPECTION", qty: 1, unitPrice: 0, credit: false },
    { description: "FREIGHT / DELIVERY", qty: 1, unitPrice: 0, credit: false },
    { description: "DOC / TITLE / TAG / REGISTRATION", qty: 1, unitPrice: 0, credit: false },
  ],
  taxes: {
    stateLabel: "Florida State 6.00%",
    stateRate: 0.06,
    countyLabel: "Columbia County",
    countyAmount: 75.0,
    countyMath: "Discretionary surtax 1.5% × $5,000 cap = $75.00",
  },
  finance: [
    { months: 36, rate: 0.0, payment: 4003.07 },
    { months: 48, rate: 0.0, payment: 3002.31 },
    { months: 60, rate: 0.0, payment: 2401.84 },
    { months: 72, rate: 2.99, payment: 2188.93 },
  ],
};

const SLIM_QUOTE = {
  ...FULL_QUOTE,
  title: "EQUIPMENT QUOTE",
  quoteNumber: "QEP-2026-0002",
  legacyReference: "",
  units: [UNIT_RT135F],
  tradeIns: [],
  parts: [],
  miscRaw: [],
  finance: [
    { months: 36, rate: 0.0, payment: 4413.85 },
    { months: 48, rate: 0.0, payment: 3310.45 },
    { months: 60, rate: 0.0, payment: 2648.36 },
    { months: 72, rate: 2.99, payment: 2412.05 },
  ],
};

// ---------- helpers ----------

function money(value) {
  return `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signedAmount(value, credit = false) {
  return `${money(value)}${credit ? "-" : ""}`;
}

const AMP = String.fromCharCode(38);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const QUOT = String.fromCharCode(34);
const APOS = String.fromCharCode(39);
const ENT_AMP = AMP + "amp;";
const ENT_LT = AMP + "lt;";
const ENT_GT = AMP + "gt;";
const ENT_QUOT = AMP + "quot;";
const ENT_APOS = AMP + "#39;";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll(AMP, ENT_AMP)
    .replaceAll(LT, ENT_LT)
    .replaceAll(GT, ENT_GT)
    .replaceAll(QUOT, ENT_QUOT)
    .replaceAll(APOS, ENT_APOS);
}

function paragraphLines(lines) {
  return lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("");
}

function computeCommercial(quote) {
  const unitsSubtotal = quote.units.reduce((sum, u) => sum + u.amount, 0);
  const partsSubtotal = quote.parts.reduce((sum, p) => sum + p.qty * p.unitPrice, 0);
  // Filter $0 misc rows — Rylee rule: only show line items selected in the quote.
  const misc = quote.miscRaw.filter((m) => Math.abs(m.qty * m.unitPrice) > 0);
  const miscTotal = misc.reduce((sum, m) => sum + (m.credit ? -1 : 1) * m.qty * m.unitPrice, 0);
  const tradeTotal = quote.tradeIns.reduce((sum, t) => sum + t.amount, 0);
  const subtotal = unitsSubtotal + partsSubtotal + miscTotal - tradeTotal;
  const stateAmount = subtotal * quote.taxes.stateRate;
  const countyAmount = quote.taxes.countyAmount;
  const total = subtotal + stateAmount + countyAmount;
  return { misc, subtotal, stateAmount, countyAmount, total };
}

// ---------- renderers ----------

function renderMasthead(quote, pageIndex, totalPages) {
  const meta = [
    ["Account No", quote.customer.accountNo],
    ["Phone", quote.customer.phone],
    ["Quote No", quote.quoteNumber],
    quote.legacyReference ? ["Legacy Ref", quote.legacyReference] : null,
    ["Date / Time", `${quote.prepared.date} · ${quote.prepared.time} (${quote.prepared.origin})`],
    ["Page", `${pageIndex} of ${totalPages}`],
    ["Salesperson", `${quote.salesperson.code} · ${quote.salesperson.name}`],
    ["Ship Via", quote.customer.shipVia],
    ["Purchase Order", quote.customer.purchaseOrder || "—"],
    ["Tax ID No", quote.customer.taxIdNo || "—"],
    ["Expires", quote.prepared.expires],
  ].filter(Boolean);

  return `
    <header class="masthead">
      <div class="masthead-left">
        <img class="qep-logo" src="${ASSETS.qepLogo}" alt="Quality Equipment & Parts — IT'S IN THE NAME" />
        <div class="company-lines">
          ${escapeHtml(quote.branch.address)} · ${escapeHtml(quote.branch.cityStateZip)}<br />
          Phone ${escapeHtml(quote.branch.phone)} · Fax ${escapeHtml(quote.branch.fax)} · ${escapeHtml(quote.branch.web)}
        </div>
        <div class="vendor-strip">
          ${ASSETS.vendors.map((v) => `<img src="${v.src}" alt="${escapeHtml(v.alt)}" />`).join("")}
        </div>
      </div>
      <div class="meta-box">
        <div class="meta-branch">${escapeHtml(quote.branch.code)} — ${escapeHtml(quote.branch.name)}</div>
        <dl class="meta-grid">
          ${meta.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("")}
        </dl>
      </div>
    </header>
  `;
}

function renderBanner(quote) {
  // v2: redundant subtitle (test name / quote # / expiry) removed — already in metadata box.
  return `
    <section class="document-banner">
      <span>EQUIPMENT ESTIMATE — NOT AN INVOICE</span>
    </section>
  `;
}

function renderAddressRow(quote) {
  return `
    <section class="address-grid">
      <div class="address-card">
        <div class="eyebrow">Ship To</div>
        ${paragraphLines(quote.customer.shipTo)}
      </div>
      <div class="address-card">
        <div class="eyebrow">Invoice To</div>
        ${paragraphLines(quote.customer.invoiceTo)}
      </div>
      <div class="rep-card">
        <div class="eyebrow">Prepared By</div>
        <div class="rep-name">${escapeHtml(quote.salesperson.name)}</div>
        <div class="rep-title">${escapeHtml(quote.salesperson.title)}</div>
        <div class="rep-line"><span>Mobile</span> ${escapeHtml(quote.salesperson.mobile)}</div>
        <div class="rep-line"><span>Office</span> ${escapeHtml(quote.salesperson.office)}</div>
        <div class="rep-line"><span>Email</span> ${escapeHtml(quote.salesperson.email)}</div>
      </div>
    </section>
  `;
}

function renderHero(quote, commercial) {
  const primary = quote.units[0];
  return `
    <section class="hero">
      <div class="hero-photo">
        <img src="${primary.heroImg}" alt="${escapeHtml(`${primary.year} ${primary.make} ${primary.model}`)}" />
      </div>
      <aside class="total-card">
        <div class="total-eyebrow">Quote Total</div>
        <div class="total-amount">${money(commercial.total)}</div>
        <div class="total-meta">Valid through ${escapeHtml(quote.prepared.expires)}</div>
      </aside>
    </section>
  `;
}

function renderSlimSummary(quote, commercial) {
  const unit = quote.units[0];
  return `
    <section class="slim-summary">
      <div class="slim-photo">
        <img src="${unit.heroImg || ASSETS.unitHero}" alt="${escapeHtml(`${unit.year} ${unit.make} ${unit.model}`)}" />
      </div>
      <aside class="slim-total">
        <div class="total-eyebrow">Quote Total</div>
        <div class="slim-total-amount">${money(commercial.total)}</div>
        <div class="total-meta">Valid through ${escapeHtml(quote.prepared.expires)}</div>
      </aside>
      <div class="slim-info">
        <div class="slim-topline">
          <span><strong>Stock #</strong> ${escapeHtml(unit.stock)}</span>
          <span class="slim-sep">·</span>
          <span><strong>Serial #</strong> ${escapeHtml(unit.serial)}</span>
          <span class="slim-sep">·</span>
          <span class="slim-condition">${escapeHtml(unit.condition.toUpperCase())}</span>
          <span class="slim-amount">${money(unit.amount)}</span>
        </div>
        <div class="slim-info-body">
          <div>
            <h2 class="slim-title">${escapeHtml(unit.productLine)}</h2>
            <ul class="spec-list slim-spec-list">
              ${unit.specs.slice(0, 6).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
            </ul>
            <div class="slim-warranty"><span class="warranty">** ${escapeHtml(unit.warranty)} **</span></div>
          </div>
          ${quote.whyThisMachine ? `<div class="slim-why"><strong>Why this configuration</strong> ${escapeHtml(quote.whyThisMachine)}</div>` : ""}
        </div>
      </div>
    </section>
  `;
}

function renderUnitCard(unit, opts = {}) {
  const { compact = false, whyThisMachine = null } = opts;
  if (compact) {
    // Inline-compact: secondary unit collapses to a 2-row band — topline + horizontal title/specs row.
    return `
      <section class="unit-card inline-compact">
        <header class="unit-topline">
          <div class="unit-id">
            <strong>Stock #</strong> ${escapeHtml(unit.stock)}
            <span class="sep">·</span>
            <strong>Serial #</strong> ${escapeHtml(unit.serial)}
            <span class="sep">·</span>
            <strong>${escapeHtml(unit.condition.toUpperCase())}</strong>
          </div>
          <div class="unit-amount">${money(unit.amount)}</div>
        </header>
        <div class="inline-body">
          <h2 class="inline-title">${escapeHtml(unit.productLine)}</h2>
          <div class="inline-specs">${unit.specs.slice(0, 4).map((s) => escapeHtml(s)).join(" &middot; ")}</div>
          <div class="inline-warranty">** ${escapeHtml(unit.warranty)} **</div>
        </div>
      </section>
    `;
  }
  const photo = unit.thumbImg
    ? `<div class="unit-thumb"><img src="${unit.thumbImg}" alt="${escapeHtml(`${unit.make} ${unit.model}`)}" /></div>`
    : "";
  return `
    <section class="unit-card">
      <header class="unit-topline">
        <div class="unit-id">
          <strong>Stock #</strong> ${escapeHtml(unit.stock)}
          <span class="sep">·</span>
          <strong>Serial #</strong> ${escapeHtml(unit.serial)}
          <span class="sep">·</span>
          <strong>${escapeHtml(unit.condition.toUpperCase())}</strong>
        </div>
        <div class="unit-amount">${money(unit.amount)}</div>
      </header>
      <div class="unit-body">
        ${photo}
        <div class="unit-detail">
          <h2>${escapeHtml(unit.productLine)}</h2>
          <ul class="spec-list">
            ${unit.specs.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
          </ul>
          <div class="warranty-row">
            <span class="warranty">** ${escapeHtml(unit.warranty)} **</span>
            ${whyThisMachine ? `<span class="why-inline"><strong>Why:</strong> ${escapeHtml(whyThisMachine)}</span>` : ""}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderTradeIns(quote) {
  if (!quote.tradeIns.length) return "";
  return `
    <section class="commercial-section">
      <h3>Trade-Ins</h3>
      <table class="commercial-table">
        <thead>
          <tr><th>Year / Make / Model</th><th>Serial #</th><th>Inclusions & Notes</th><th>Trade Allowance</th></tr>
        </thead>
        <tbody>
          ${quote.tradeIns
            .map(
              (t) => `
            <tr>
              <td>${escapeHtml(`${t.year} ${t.makeModel}`)}</td>
              <td>${escapeHtml(t.serial)}</td>
              <td>${escapeHtml(t.inclusions)}${t.notes ? ` — ${escapeHtml(t.notes)}` : ""}</td>
              <td class="credit">${signedAmount(t.amount, true)}</td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderParts(quote) {
  if (!quote.parts.length) return "";
  return `
    <section class="commercial-section">
      <h3>Additional Parts</h3>
      <table class="commercial-table">
        <thead>
          <tr><th>Description</th><th>Part #</th><th>Qty</th><th>Unit Price</th><th>Extended</th></tr>
        </thead>
        <tbody>
          ${quote.parts
            .map(
              (p) => `
            <tr>
              <td>${escapeHtml(p.description)}</td>
              <td>${escapeHtml(p.partNo)}</td>
              <td>${p.qty}</td>
              <td>${money(p.unitPrice)}</td>
              <td>${money(p.qty * p.unitPrice)}</td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderMisc(commercial) {
  if (!commercial.misc.length) return "";
  return `
    <section class="commercial-section">
      <h3>Misc Charges & Credits</h3>
      <table class="commercial-table">
        <thead>
          <tr><th>Description</th><th>Qty</th><th>Price</th><th>Extended</th></tr>
        </thead>
        <tbody>
          ${commercial.misc
            .map(
              (m) => `
            <tr>
              <td>${escapeHtml(m.description)}</td>
              <td>${m.qty}</td>
              <td>${money(m.unitPrice)}</td>
              <td class="${m.credit ? "credit" : ""}">${signedAmount(m.qty * m.unitPrice, m.credit)}</td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderTotalsAndSignature(quote, commercial) {
  return `
    <section class="totals-sig-row">
      <div class="totals-card">
        <div class="totals-row"><span>Subtotal</span><strong>${money(commercial.subtotal)}</strong></div>
        <div class="totals-row"><span>${escapeHtml(quote.taxes.stateLabel)}</span><strong>${money(commercial.stateAmount)}</strong></div>
        <div class="totals-row"><span>${escapeHtml(quote.taxes.countyLabel)}</span><strong>${money(commercial.countyAmount)}</strong></div>
        <div class="totals-caption">${escapeHtml(quote.taxes.countyMath)}</div>
        <div class="grand-total">
          <span>Quote Total</span>
          <strong>${money(commercial.total)}</strong>
        </div>
      </div>
      <div class="signature-card">
        <div class="eyebrow">Authorization</div>
        <p>By signing below, the customer authorizes the purchase per the line items, taxes, and terms shown on this estimate.</p>
        <div class="sig-line"><label>Signature</label><span class="rule"></span></div>
        <div class="sig-line"><label>Print Name</label><span class="rule"></span></div>
        <div class="sig-line"><label>Date</label><span class="rule short"></span></div>
      </div>
    </section>
  `;
}

function renderFinance(quote) {
  if (!quote.finance.length) return "";
  return `
    <section class="finance-panel">
      <div class="finance-head">
        <h2>Estimated Financing</h2>
        <span class="finance-sub">Choose the term that fits your monthly budget.</span>
      </div>
      <div class="finance-grid">
        ${quote.finance
          .map(
            (f) => `
          <div class="finance-card">
            <div class="finance-term">${f.months} Months</div>
            <div class="finance-payment">${money(f.payment)}<span>/mo</span></div>
            <div class="finance-rate">${f.rate.toFixed(2)}% APR</div>
            <div class="finance-source">QEP program · eff. ${escapeHtml(quote.prepared.date)}</div>
          </div>`,
          )
          .join("")}
      </div>
      <p class="legacy-disclaimer">${escapeHtml(LEGACY_FINANCE_DISCLAIMER)}</p>
      <p class="tila">${escapeHtml(TILA_DISCLAIMER)}</p>
    </section>
  `;
}

function renderComments(quote) {
  if (!quote.comments || !quote.comments.trim()) return "";
  return `
    <section class="comments-card">
      <div class="eyebrow">Comments</div>
      <p>${escapeHtml(quote.comments).replaceAll("\n", "<br />")}</p>
    </section>
  `;
}

function renderFooter(quote) {
  return `
    <footer class="page-footer">
      <div class="footer-copy">
        ${escapeHtml(STANDARD_FOOTER)}<br />
        <strong>Thank you for your business!</strong>
      </div>
      <div class="qr">
        <img src="${ASSETS.qr}" alt="Scan to review or accept this quote online." />
        <strong>Scan to review & accept</strong>
        <small>${escapeHtml(quote.branch.web)}</small>
      </div>
    </footer>
  `;
}

// ---------- page composition ----------

function decidePages(quote) {
  // QEP rhythm: equipment lives on page 1, compliance (TILA + signature + QR) on page 2.
  // Empty trade/parts/misc fold gracefully on page 2 so slim quotes don't pad with whitespace.
  return 2;
}

function renderProposal(quote) {
  const commercial = computeCommercial(quote);
  const isSlim = quote.units.length === 1 && quote.tradeIns.length === 0 && quote.parts.length === 0 && commercial.misc.length === 0;

  if (isSlim) {
    // Slim 2-page: page 1 = masthead + hero/unit card (visual showcase, no footer);
    // page 2 = totals + auth + finance + comments + compliance footer.
    return `
      <article class="page">
        ${renderMasthead(quote, 1, 2)}
        ${renderAddressRow(quote)}
        ${renderBanner(quote)}
        ${renderSlimSummary(quote, commercial)}
      </article>
      <article class="page">
        <div class="running-header">
          <strong>${escapeHtml(quote.quoteNumber)}</strong>
          <span>${escapeHtml(quote.customer.name)} · Page 2 of 2</span>
        </div>
        ${renderTotalsAndSignature(quote, commercial)}
        ${renderFinance(quote)}
        ${renderComments(quote)}
        ${renderFooter(quote)}
      </article>
    `;
  }

  // 2-page layout for richer quotes (page 1 = visual showcase, no compliance footer).
  // Secondary unit (attachment) leads page 2 above commercials so page 1 stays uncluttered.
  return `
    <article class="page">
      ${renderMasthead(quote, 1, 2)}
      ${renderAddressRow(quote)}
      ${renderBanner(quote)}
      ${renderHero(quote, commercial)}
      ${renderUnitCard(quote.units[0], { whyThisMachine: quote.whyThisMachine })}
    </article>
    <article class="page">
      <div class="running-header">
        <strong>${escapeHtml(quote.quoteNumber)}</strong>
        <span>${escapeHtml(quote.customer.name)} · Page 2 of 2</span>
      </div>
      ${quote.units[1] ? renderUnitCard(quote.units[1], { compact: true }) : ""}
      ${renderTradeIns(quote)}
      ${renderParts(quote)}
      ${renderMisc(commercial)}
      ${renderTotalsAndSignature(quote, commercial)}
      ${renderFinance(quote)}
      ${renderComments(quote)}
      ${renderFooter(quote)}
    </article>
  `;
}

// ---------- shell HTML ----------

function renderHtml(quote) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(quote.quoteNumber)} — QEP Equipment Quote</title>
  <style>
    :root {
      --orange: #f28a07;
      --charcoal: #111111;
      --paper: #faf7f1;
      --rule: #d8d2c5;
      --muted: #6b6b6b;
      --green: #0f7a3a;
      --body-size: 11.5pt;
      --table-size: 10pt;
      --legal-size: 9pt;
    }
    * { box-sizing: border-box; }
    html { background: #2b2b2b; }
    body {
      margin: 0;
      color: var(--charcoal);
      font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
      font-size: var(--body-size);
      line-height: 1.4;
      -webkit-font-smoothing: antialiased;
    }
    .page {
      position: relative;
      width: 8.5in;
      height: 11in;
      margin: 24px auto;
      padding: 0.4in 0.5in 0.4in;
      background: #ffffff;
      box-shadow: 0 18px 50px rgba(0,0,0,0.28);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .page > * { position: relative; z-index: 1; }

    /* Masthead --------------------------------------------------- */
    .masthead {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 2.85in;
      gap: 0.22in;
      align-items: start;
      padding-bottom: 0.14in;
      border-bottom: 5px solid var(--orange);
    }
    .masthead-left {
      min-width: 0;
      overflow: hidden;
    }
    .qep-logo {
      display: block;
      max-width: 2.4in;
      max-height: 0.95in;
      object-fit: contain;
    }
    .company-lines {
      margin-top: 0.06in;
      color: var(--muted);
      font-size: 9.5pt;
    }
    .vendor-strip {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.14in;
      margin-top: 0.08in;
      padding-top: 0.08in;
      border-top: 1px dashed var(--rule);
      max-width: 100%;
    }
    .vendor-strip img {
      max-height: 0.36in;
      max-width: 0.78in;
      width: auto;
      filter: grayscale(100%);
      object-fit: contain;
    }
    .meta-box {
      border: 1px solid var(--charcoal);
      background: var(--paper);
    }
    .meta-branch {
      padding: 0.06in 0.1in;
      color: white;
      background: var(--charcoal);
      font-weight: 800;
      font-size: 10pt;
      letter-spacing: 0.02in;
      text-align: center;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 0.9in 1fr;
      gap: 1px 0.05in;
      margin: 0;
      padding: 0.06in 0.1in;
      font-size: 9pt;
    }
    .meta-grid dt {
      color: var(--muted);
      text-transform: uppercase;
      font-size: 8.5pt;
      letter-spacing: 0.01in;
    }
    .meta-grid dd {
      margin: 0;
      text-align: right;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    /* Address row ----------------------------------------------- */
    .address-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1.85in;
      gap: 0.12in;
      margin-top: 0.12in;
    }
    .address-card, .rep-card {
      padding: 0.1in 0.12in;
      border: 1px solid var(--rule);
      background: var(--paper);
      font-size: 10.5pt;
      font-weight: 700;
    }
    .rep-card {
      background: var(--charcoal);
      color: #fff;
      border-left: 0.06in solid var(--orange);
      border-color: var(--charcoal);
    }
    .rep-card .eyebrow { color: var(--orange); }
    .rep-name {
      margin-top: 0.04in;
      font-size: 12.5pt;
      font-weight: 900;
      letter-spacing: 0.01in;
      text-transform: uppercase;
    }
    .rep-title {
      margin-top: 0.02in;
      color: var(--orange);
      font-size: 10.5pt;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.015in;
    }
    .rep-line {
      margin-top: 0.05in;
      font-size: 10pt;
      font-weight: 600;
      color: #efe9da;
    }
    .rep-line span {
      display: inline-block;
      width: 0.46in;
      color: #b8b3a8;
      font-weight: 700;
      font-size: 9pt;
      text-transform: uppercase;
      letter-spacing: 0.01in;
    }
    .eyebrow {
      margin-bottom: 0.05in;
      color: var(--orange);
      font-size: 8.5pt;
      font-weight: 900;
      letter-spacing: 0.022in;
      text-transform: uppercase;
    }

    /* Banner ---------------------------------------------------- */
    .document-banner {
      margin-top: 0.12in;
      padding: 0.07in 0.14in;
      color: #fff;
      background: var(--charcoal);
      border-left: 0.085in solid var(--orange);
    }
    .document-banner span {
      font-family: "Barlow Condensed", Impact, sans-serif;
      font-size: 18pt;
      font-weight: 900;
      letter-spacing: 0.03in;
    }

    /* Hero ------------------------------------------------------- */
    .hero {
      display: grid;
      grid-template-columns: 1fr 2.4in;
      gap: 0.14in;
      margin-top: 0.14in;
    }
    .hero-photo {
      position: relative;
      height: 2.3in;
      border: 1px solid var(--rule);
      background: var(--paper);
      overflow: hidden;
    }
    .hero-photo img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center;
      display: block;
    }
    .total-card {
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 0.18in;
      color: #fff;
      background: linear-gradient(135deg, var(--charcoal), #2c2c2c);
      border-bottom: 0.08in solid var(--orange);
    }
    .total-eyebrow {
      color: #cfcfcf;
      font-size: 10pt;
      font-weight: 900;
      letter-spacing: 0.025in;
      text-transform: uppercase;
    }
    .total-amount {
      margin: 0.04in 0;
      color: var(--orange);
      font-family: "Barlow Condensed", Impact, sans-serif;
      font-size: 30pt;
      font-weight: 900;
      letter-spacing: 0.005in;
    }
    .total-meta {
      color: #d8d8d8;
      font-size: 10pt;
      font-weight: 700;
    }
    .why {
      margin-top: 0.12in;
      padding-top: 0.1in;
      border-top: 1px solid rgba(255,255,255,0.18);
      color: #f4f4f4;
      font-size: 10pt;
      font-weight: 500;
      line-height: 1.45;
    }
    .why strong { color: var(--orange); text-transform: uppercase; letter-spacing: 0.01in; }

    /* Unit cards ------------------------------------------------- */
    .unit-card {
      margin-top: 0.1in;
      border: 1px solid var(--rule);
      background: #ffffff;
    }
    .unit-topline {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.06in 0.14in;
      color: #fff;
      background: var(--charcoal);
      font-size: 10pt;
      font-variant-numeric: tabular-nums;
    }
    .unit-topline .sep { margin: 0 0.06in; color: #888; }
    .unit-topline strong { color: var(--orange); font-weight: 800; letter-spacing: 0.005in; }
    .unit-amount {
      color: var(--orange);
      font-family: "Barlow Condensed", Impact, sans-serif;
      font-size: 17pt;
      font-weight: 900;
    }
    .unit-body {
      display: grid;
      grid-template-columns: 1.3in 1fr;
      gap: 0.12in;
      padding: 0.08in 0.12in;
    }
    .unit-card.compact .unit-body { grid-template-columns: 1.0in 1fr; padding: 0.06in 0.1in; gap: 0.1in; }
    .unit-body:has(> .unit-detail:only-child) { grid-template-columns: 1fr; }
    .unit-card:not(:has(.unit-thumb)) .unit-body { grid-template-columns: 1fr; }
    .unit-thumb {
      border: 1px solid var(--rule);
      background: var(--paper);
      overflow: hidden;
      min-height: 1.2in;
    }
    .unit-thumb img {
      width: 100%; height: 100%;
      max-height: 1.45in;
      object-fit: cover;
      display: block;
    }
    .unit-card.compact .unit-thumb { min-height: 0.85in; }
    .unit-card.compact .unit-thumb img { max-height: 1.0in; }
    .unit-detail h2 {
      margin: 0 0 0.04in;
      font-size: 12.5pt;
      font-weight: 900;
      text-transform: uppercase;
      color: var(--charcoal);
    }
    .unit-card.compact .unit-detail h2 { font-size: 11pt; margin-bottom: 0.02in; }
    .spec-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      column-gap: 0.18in;
      row-gap: 0.01in;
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: 9.5pt;
    }
    .unit-card.compact .spec-list { font-size: 9pt; }
    .spec-list li {
      padding: 0.01in 0 0.01in 0.14in;
      position: relative;
      line-height: 1.25;
    }
    .spec-list li::before {
      content: "";
      position: absolute;
      left: 0; top: 0.075in;
      width: 0.06in; height: 0.06in;
      background: var(--orange);
    }
    .warranty {
      display: inline-block;
      padding: 0.03in 0.09in;
      color: var(--charcoal);
      background: #fff5e3;
      border: 1px solid var(--orange);
      font-weight: 900;
      font-size: 9.5pt;
      white-space: nowrap;
    }
    .warranty-row {
      display: flex;
      align-items: center;
      gap: 0.12in;
      margin-top: 0.06in;
    }
    .why-inline {
      flex: 1;
      color: #4a4a4a;
      font-size: 9pt;
      line-height: 1.3;
    }
    .why-inline strong {
      color: var(--orange);
      text-transform: uppercase;
      font-size: 8pt;
      letter-spacing: 0.012in;
      margin-right: 0.04in;
    }
    .unit-card.compact .warranty { font-size: 8.5pt; padding: 0.02in 0.07in; }

    /* Inline-compact unit card (secondary/attachment unit on page 1) */
    .unit-card.inline-compact .inline-body {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 0.1in;
      align-items: center;
      padding: 0.06in 0.12in;
    }
    .unit-card.inline-compact .inline-title {
      margin: 0;
      font-size: 11pt;
      font-weight: 900;
      text-transform: uppercase;
      color: var(--charcoal);
      grid-column: 1 / 2;
    }
    .unit-card.inline-compact .inline-specs {
      grid-column: 1 / 2;
      color: #444;
      font-size: 9pt;
      line-height: 1.3;
    }
    .unit-card.inline-compact .inline-warranty {
      grid-column: 2 / 3;
      grid-row: 1 / 3;
      align-self: center;
      padding: 0.03in 0.08in;
      background: #fff5e3;
      border: 1px solid var(--orange);
      color: var(--charcoal);
      font-weight: 900;
      font-size: 8.5pt;
      white-space: nowrap;
    }

    /* Slim summary (single-unit, no extras) -------------------- */
    /* Row 1: photo (left) + total card (right). Row 2: unit details full-width. */
    .slim-summary {
      display: grid;
      grid-template-columns: 1fr 2.3in;
      grid-template-rows: 1.95in auto;
      gap: 0.12in;
      margin-top: 0.12in;
    }
    .slim-photo {
      grid-column: 1;
      grid-row: 1;
      height: 1.95in;
      border: 1px solid var(--rule);
      background: var(--paper);
      overflow: hidden;
    }
    .slim-photo img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .slim-total {
      grid-column: 2;
      grid-row: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 0.12in 0.14in;
      color: #fff;
      background: linear-gradient(135deg, var(--charcoal), #2c2c2c);
      border-bottom: 0.06in solid var(--orange);
      text-align: center;
    }
    .slim-total-amount {
      margin: 0.04in 0;
      color: var(--orange);
      font-family: "Barlow Condensed", Impact, sans-serif;
      font-size: 26pt;
      font-weight: 900;
      letter-spacing: 0.005in;
      line-height: 1;
    }
    .slim-info {
      grid-column: 1 / -1;
      grid-row: 2;
      display: flex;
      flex-direction: column;
      border: 1px solid var(--rule);
      background: #fff;
      min-width: 0;
    }
    .slim-topline {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.06in;
      padding: 0.06in 0.12in;
      color: #fff;
      background: var(--charcoal);
      font-size: 9.5pt;
      font-variant-numeric: tabular-nums;
    }
    .slim-topline strong { color: var(--orange); font-weight: 800; }
    .slim-topline .slim-amount {
      margin-left: auto;
      color: var(--orange);
      font-family: "Barlow Condensed", Impact, sans-serif;
      font-size: 16pt;
      font-weight: 900;
    }
    .slim-sep { color: #888; }
    .slim-condition { color: var(--orange); font-weight: 900; }
    .slim-info-body {
      padding: 0.1in 0.12in 0.1in;
      display: grid;
      grid-template-columns: 1fr 2.2in;
      gap: 0.16in;
    }
    .slim-title {
      margin: 0;
      font-size: 12pt;
      font-weight: 900;
      text-transform: uppercase;
      color: var(--charcoal);
    }
    .slim-spec-list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      font-size: 9.5pt;
      margin: 0.05in 0 0;
    }
    .slim-why {
      margin: 0;
      padding: 0.08in 0.1in;
      background: var(--paper);
      border-left: 3px solid var(--orange);
      font-size: 9pt;
      line-height: 1.35;
    }
    .slim-why strong { color: var(--orange); text-transform: uppercase; letter-spacing: 0.01in; font-size: 8pt; display: block; margin-bottom: 0.02in; }
    .slim-warranty {
      margin-top: 0.06in;
    }

    /* Commercial sections --------------------------------------- */
    .commercial-section {
      margin-top: 0.07in;
    }
    .commercial-section h3 {
      margin: 0 0 0.03in;
      padding: 0.035in 0.12in;
      color: #fff;
      background: var(--charcoal);
      border-left: 0.06in solid var(--orange);
      font-size: 10pt;
      letter-spacing: 0.025in;
      text-transform: uppercase;
    }
    .commercial-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9pt;
      font-variant-numeric: tabular-nums;
    }
    .commercial-table th {
      padding: 0.03in 0.08in;
      color: #fff;
      background: #2a2a2a;
      font-size: 8.5pt;
      text-align: left;
      letter-spacing: 0.012in;
      text-transform: uppercase;
    }
    .commercial-table td {
      padding: 0.03in 0.08in;
      border-bottom: 1px solid var(--rule);
      line-height: 1.2;
    }
    .commercial-table td:not(:first-child),
    .commercial-table th:not(:first-child) { text-align: right; }
    .credit { color: var(--green); font-weight: 800; }

    /* Totals + signature --------------------------------------- */
    .totals-sig-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.12in;
      margin-top: 0.07in;
    }
    .totals-card {
      padding: 0.08in 0.12in;
      background: var(--paper);
      border: 1px solid var(--rule);
      border-top: 0.05in solid var(--orange);
      font-variant-numeric: tabular-nums;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 0.03in 0;
      border-bottom: 1px solid var(--rule);
      font-size: 10pt;
    }
    .totals-row strong { font-weight: 800; }
    .totals-caption {
      padding-top: 0.03in;
      color: var(--muted);
      font-size: 8.5pt;
      font-style: italic;
    }
    .grand-total {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-top: 0.05in;
      padding: 0.05in 0.12in;
      color: #fff;
      background: var(--charcoal);
    }
    .grand-total span {
      font-size: 10pt;
      font-weight: 900;
      letter-spacing: 0.022in;
      text-transform: uppercase;
    }
    .grand-total strong {
      color: var(--orange);
      font-family: "Barlow Condensed", Impact, sans-serif;
      font-size: 18pt;
    }
    .signature-card {
      padding: 0.08in 0.12in;
      background: #ffffff;
      border: 1px solid var(--rule);
      border-top: 0.05in solid var(--charcoal);
    }
    .signature-card p {
      margin: 0.03in 0 0.08in;
      color: #333;
      font-size: 9pt;
      line-height: 1.3;
    }
    .sig-line {
      display: flex;
      align-items: baseline;
      gap: 0.1in;
      margin-top: 0.08in;
      font-size: 9pt;
    }
    .sig-line label {
      width: 0.95in;
      flex-shrink: 0;
      color: var(--muted);
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.012in;
      font-size: 9pt;
    }
    .sig-line .rule {
      flex: 1;
      border-bottom: 1.5px solid var(--charcoal);
      height: 0.22in;
    }
    .sig-line .rule.short { max-width: 1.6in; }

    /* Finance --------------------------------------------------- */
    .finance-panel {
      margin-top: 0.07in;
      padding: 0.06in 0.12in 0.07in;
      color: #fff;
      background: var(--charcoal);
      border-bottom: 0.05in solid var(--orange);
    }
    .finance-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 0.04in;
    }
    .finance-panel h2 {
      margin: 0;
      color: var(--orange);
      font-family: "Barlow Condensed", Impact, sans-serif;
      font-size: 14pt;
      letter-spacing: 0.022in;
      text-transform: uppercase;
    }
    .finance-sub {
      color: #d6d6d6;
      font-size: 9pt;
      font-weight: 600;
    }
    .finance-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.08in;
    }
    .finance-card {
      padding: 0.04in 0.06in 0.06in;
      background: #1e1e1e;
      border-top: 0.04in solid var(--orange);
      text-align: center;
      min-width: 0;
      overflow: hidden;
    }
    .finance-term {
      color: #cfcfcf;
      font-size: 8.5pt;
      font-weight: 900;
      letter-spacing: 0.014in;
      text-transform: uppercase;
    }
    .finance-payment {
      margin: 0.02in 0 0.01in;
      color: var(--orange);
      font-family: "Barlow Condensed", Impact, sans-serif;
      font-size: 17pt;
      font-weight: 900;
      letter-spacing: 0.002in;
      line-height: 1.05;
      white-space: nowrap;
    }
    .finance-payment span {
      margin-left: 0.02in;
      color: #fff;
      font-size: 8pt;
      font-weight: 700;
      letter-spacing: 0.005in;
    }
    .finance-rate {
      color: #fff;
      font-size: 8.5pt;
      font-weight: 700;
    }
    .finance-source {
      margin-top: 0.02in;
      color: #b8b8b8;
      font-size: 7pt;
      font-weight: 500;
      line-height: 1.15;
    }
    .legacy-disclaimer {
      margin: 0.05in 0 0;
      color: #fff;
      font-size: 7.5pt;
      font-weight: 800;
      letter-spacing: 0.005in;
    }
    .tila {
      margin: 0.03in 0 0;
      padding: 0.04in 0.08in;
      color: var(--charcoal);
      background: #fff;
      border-left: 3px solid var(--orange);
      font-size: 7.5pt;
      font-weight: 600;
      line-height: 1.25;
    }

    /* Comments + footer ---------------------------------------- */
    .comments-card {
      margin-top: 0.1in;
      padding: 0.07in 0.12in;
      background: var(--paper);
      border: 1px solid var(--rule);
      font-size: 9.5pt;
      line-height: 1.3;
    }
    .comments-card p { margin: 0.02in 0 0; }
    .page-footer {
      margin-top: auto;
      display: grid;
      grid-template-columns: 1fr 0.95in;
      gap: 0.14in;
      align-items: end;
      padding-top: 0.08in;
      border-top: 1px solid var(--rule);
    }
    .footer-copy {
      color: var(--muted);
      font-size: 8.5pt;
      line-height: 1.35;
    }
    .footer-copy strong { color: var(--charcoal); }
    .qr { text-align: center; font-size: 8pt; color: var(--muted); }
    .qr img {
      display: block;
      width: 0.78in;
      height: 0.78in;
      margin: 0 auto;
      border: 1.5px solid var(--charcoal);
      background: #fff;
    }
    .qr strong {
      display: block;
      margin-top: 0.02in;
      color: var(--charcoal);
      font-size: 8pt;
      text-transform: uppercase;
      letter-spacing: 0.008in;
    }

    /* Running header (page 2) ---------------------------------- */
    .running-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 0.08in 0.14in;
      color: #fff;
      background: var(--charcoal);
      border-left: 0.085in solid var(--orange);
      font-size: 10pt;
      letter-spacing: 0.018in;
      text-transform: uppercase;
    }
    .running-header strong { color: var(--orange); }

    /* Always-on page break rules so PDF generation gets one article per page */
    .page {
      page-break-after: always;
      break-after: page;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
    .page:last-child {
      page-break-after: auto;
      break-after: auto;
    }

    @page {
      size: Letter;
      margin: 0;
    }

    @media print {
      html, body { background: #fff; }
      .page {
        margin: 0;
        box-shadow: none;
      }
    }
  </style>
</head>
<body>
  <main>
    ${renderProposal(quote)}
  </main>
</body>
</html>`;
}

// ---------- compliance + asset verification ----------

const COMPLIANCE_NEEDLES_BOTH = [
  "Quality Equipment",
  "01 — LAKE CITY",
  "EQUIPMENT ESTIMATE — NOT AN INVOICE",
  "Ship To",
  "Invoice To",
  "Prepared By",
  "Mobile",
  "Office",
  "Email",
  "Florida State 6.00%",
  "Columbia County",
  "Quote Total",
  "Estimated Financing",
  "FINANCING BASED ON CREDIT APPROVAL",
  "QEP is not a lender",
  "Good for thirty (30) days from date of quote",
  "Thank you for your business!",
  "Scan to review",
];

const COMPLIANCE_NEEDLES_FULL = [
  ...COMPLIANCE_NEEDLES_BOTH,
  "Trade-Ins",
  "Additional Parts",
  "Misc Charges",
  "LESS DOWN PAYMENT RECD.",
  "SHEAREX CARBIDE",
  "Page 2 of 2",
];

const COMPLIANCE_NEEDLES_SLIM = [
  ...COMPLIANCE_NEEDLES_BOTH,
];

const FORBIDDEN_NEEDLES_SLIM = [
  "Trade-Ins",
  "Additional Parts",
  "Misc Charges",
  "PDI / FINAL DEALER INSPECTION",
  "FREIGHT / DELIVERY",
  "DOC / TITLE / TAG",
  "COMPARABLE MARKET RANGE",
];

const FORBIDDEN_NEEDLES_FULL = [
  "COMPARABLE MARKET RANGE",
  "PDI / FINAL DEALER INSPECTION", // $0 row must be suppressed
  "FREIGHT / DELIVERY", // $0 row must be suppressed
  "DOC / TITLE / TAG / REGISTRATION", // $0 row must be suppressed
];

// Resize/compress targets for embedded assets. Heavy JPGs get knocked down
// to ~1200px on the long edge at q72 so the PDF stays under ~1MB total.
const RESIZE_RULES = {
  "package-rt135f-shearex.jpg": { maxDim: 1200, quality: 72, format: "jpeg" },
  "attachment-shearex-hm70sr.jpg": { maxDim: 900, quality: 72, format: "jpeg" },
  "qep-its-in-the-name-logo.png": { maxDim: 700, format: "png" },
};

function sipsResize(filePath, rule) {
  // sips: -Z resamples (max dimension), -s formatOptions controls JPEG quality.
  const args = ["-Z", String(rule.maxDim)];
  if (rule.format === "jpeg" && rule.quality) {
    args.push("-s", "formatOptions", String(rule.quality));
  }
  args.push(filePath);
  execFileSync("/usr/bin/sips", args, { stdio: "pipe" });
}

function verifyAssets() {
  mkdirSync(ASSET_DEST, { recursive: true });
  const sizes = [];
  for (const [src, dest] of Object.entries(ASSET_MAP)) {
    const srcPath = resolve(ASSET_SOURCE, src);
    const destPath = resolve(ASSET_DEST, dest);
    if (!existsSync(srcPath)) {
      throw new Error(`Required source asset missing: ${srcPath}`);
    }
    copyFileSync(srcPath, destPath);
    const rule = RESIZE_RULES[dest];
    if (rule) {
      sipsResize(destPath, rule);
    }
    sizes.push({ name: dest, bytes: statSync(destPath).size });
  }
  return sizes;
}

async function renderPdf(htmlPath, pdfPath, browser) {
  const page = await browser.newPage({ viewport: { width: 1180, height: 1525 } });
  await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: pdfPath,
    format: "Letter",
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
  });
  await page.close();
}

function verifyNeedles(html, required, forbidden, label) {
  const missing = required.filter((n) => !html.includes(n));
  if (missing.length) {
    throw new Error(`[${label}] Required content missing: ${missing.join(", ")}`);
  }
  const present = forbidden.filter((n) => html.includes(n));
  if (present.length) {
    throw new Error(`[${label}] Forbidden content present: ${present.join(", ")}`);
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  verifyAssets();

  const targets = [
    {
      label: "slim",
      quote: SLIM_QUOTE,
      htmlPath: resolve(OUT_DIR, "QEP-2026-0002-owner-feedback-v2-onepage.html"),
      pdfPath: resolve(OUT_DIR, "QEP-2026-0002-owner-feedback-v2-onepage.pdf"),
      required: COMPLIANCE_NEEDLES_SLIM,
      forbidden: FORBIDDEN_NEEDLES_SLIM,
    },
    {
      label: "full",
      quote: FULL_QUOTE,
      htmlPath: resolve(OUT_DIR, "QEP-2026-0001-owner-feedback-v2-fullquote.html"),
      pdfPath: resolve(OUT_DIR, "QEP-2026-0001-owner-feedback-v2-fullquote.pdf"),
      required: COMPLIANCE_NEEDLES_FULL,
      forbidden: FORBIDDEN_NEEDLES_FULL,
    },
  ];

  for (const t of targets) {
    const html = renderHtml(t.quote);
    writeFileSync(t.htmlPath, html, "utf8");
    verifyNeedles(html, t.required, t.forbidden, t.label);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    for (const t of targets) {
      await renderPdf(t.htmlPath, t.pdfPath, browser);
    }
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({
    ok: true,
    artifacts: targets.map((t) => ({ label: t.label, html: t.htmlPath, pdf: t.pdfPath })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
