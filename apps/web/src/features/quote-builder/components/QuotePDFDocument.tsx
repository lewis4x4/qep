/**
 * Quote PDF Document — customer-safe QEP proposal.
 *
 * Customer-facing: confirmed narrative only; no dealer cost, margin, raw AI
 * trigger data, source IDs, metadata, or approval internals are rendered.
 */

import { Document, Image, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { QuoteFinanceAprSource, QuoteFinanceScenarioKind, QuoteLineItemKind } from "../../../../../../shared/qep-moonshot-contracts";
import { formatAprSourceAttribution } from "../lib/finance-apr-source";
import { isDisplayableProposalFinanceScenario } from "../lib/quote-proposal-data";

const ORANGE = "#F28A07";
const CHARCOAL = "#111111";
const SURFACE = "#1a1a1a";
const SURFACE_2 = "#242424";
const GEAR_GRAY = "#BFBFBF";
const MUTED = "#707070";
const WHITE = "#FFFFFF";
const PAPER = "#F7F4EF";
export const QEP_WEBSITE_QR_LABEL = "Scan to visit QEP online";

type TextAlign = "left" | "center" | "right";

export interface QuoteProposalAsset {
  src: string;
  alt: string;
  caption?: string | null;
  mediaKind?: "actual" | "model_generic" | "trade_in" | "manual" | string | null;
}

export interface QuoteProposalLineMedia {
  primaryPhoto: QuoteProposalAsset | null;
  gallery: QuoteProposalAsset[];
}

export interface QuoteProposalLine {
  /** Stable semantic diff handle for version comparisons; intentionally not rendered. */
  diffKey?: string | null;
  lineType: QuoteLineItemKind;
  description: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  quantity: number;
  unitPrice: number;
  extendedPrice: number;
  displayAmount: number;
  tone: "charge" | "credit";
  reasonCode?: string | null;
  stockNumber?: string | null;
  serialNumber?: string | null;
  condition?: string | null;
  warrantyText?: string | null;
  longDescription?: string | null;
  specBullets?: string[];
  media?: QuoteProposalLineMedia;
  vendorLogo?: QuoteProposalAsset | null;
}

export interface QuoteProposalCoverUnit {
  title: string;
  meta: string | null;
  photos: QuoteProposalAsset[];
}

export interface QuoteProposalNarrative {
  text: string | null;
  confirmed: boolean;
  facts: Array<{ label: string; value: string }>;
  highlights: Array<{ quote: string; supports: string }>;
  considerations: string[];
  alternative: {
    machine: string;
    attachments: string[];
    reasoning: string;
    whyNotChosen: string | null;
  } | null;
}

export interface QuoteProposalCompliance {
  validUntil: string | null;
  specialTerms: string | null;
  taxLabel: string;
  taxDetail: string | null;
  financingDisclaimer: string;
  proposalDisclaimer: string;
  selectedPaymentKind: "cash" | "finance" | "lease" | "unknown";
  primaryTotalLabel: "Customer total" | "Amount financed";
}

export interface QuotePDFFinancingScenario {
  type: "cash" | "finance" | "lease";
  kind?: QuoteFinanceScenarioKind;
  label?: string;
  termMonths: number | null;
  rate: number | null;
  monthlyPayment: number | null;
  totalCost: number | null;
  lender: string | null;
  downPayment?: number | null;
  residualAmount?: number | null;
  aprSource?: QuoteFinanceAprSource | null;
  isDefault?: boolean;
}

export interface QuotePDFData {
  dealName: string;
  customerName: string;
  quoteNumber?: string | null;
  preparedBy: string;
  preparedDate: string;
  /** Deprecated migration field. Renderers must not use this as customer narrative. */
  aiRecommendationSummary?: string | null;
  equipment: Array<{ make: string; model: string; year?: number | null; price: number; quantity?: number; extendedPrice?: number }>;
  attachments: Array<{ name: string; price: number; quantity?: number; extendedPrice?: number }>;
  lineItems: QuoteProposalLine[];
  coverGalleryUnits: QuoteProposalCoverUnit[];
  brandAssets: {
    qepLogo: QuoteProposalAsset | null;
    vendorLogos: QuoteProposalAsset[];
    qrCode: QuoteProposalAsset | null;
  };
  narrative: QuoteProposalNarrative;
  equipmentTotal: number;
  attachmentTotal: number;
  pricingLineTotal: number;
  subtotal: number;
  discountTotal: number;
  tradeAllowance: number;
  taxTotal: number;
  customerTotal: number;
  cashDown: number;
  amountFinanced: number;
  netTotal: number;
  financing: QuotePDFFinancingScenario[];
  financeComparisonEnabled: boolean;
  selectedFinancingLabel?: string | null;
  primaryMachineTitle?: string | null;
  deliveryEta?: string | null;
  depositRequiredAmount?: number | null;
  specialTerms?: string | null;
  validUntil?: string | null;
  compliance: QuoteProposalCompliance;
  branch: { name: string; address?: string; city?: string; state?: string; postalCode?: string; phone?: string; email?: string; website?: string; footerText?: string };
}

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, padding: 34, color: SURFACE, backgroundColor: WHITE },
  masthead: { backgroundColor: CHARCOAL, margin: -34, marginBottom: 24, padding: 28, borderBottomWidth: 5, borderBottomColor: ORANGE },
  mastheadRow: { flexDirection: "row", justifyContent: "space-between" },
  brandBlock: { width: 260 },
  qepLogo: { width: 156, height: 48, objectFit: "contain" as const, marginBottom: 8 },
  vendorRow: { flexDirection: "row", gap: 5, marginTop: 8 },
  vendorLogo: { width: 38, height: 17, objectFit: "contain" as const, backgroundColor: WHITE, padding: 2 },
  brandName: { fontSize: 19, fontFamily: "Helvetica-Bold", color: WHITE, letterSpacing: 0.2 },
  brandRule: { height: 2, width: 56, backgroundColor: ORANGE, marginTop: 8, marginBottom: 8 },
  tagline: { fontSize: 8, color: GEAR_GRAY, letterSpacing: 1.4, textTransform: "uppercase" as const },
  branchMeta: { fontSize: 8, color: GEAR_GRAY, textAlign: "right" as TextAlign, lineHeight: 1.45 },
  footer: { position: "absolute" as const, bottom: 24, left: 34, right: 34, borderTopWidth: 1, borderTopColor: GEAR_GRAY, paddingTop: 7 },
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  footerCopy: { flex: 1, paddingRight: 10 },
  footerText: { fontSize: 7, color: MUTED, textAlign: "center" as TextAlign, lineHeight: 1.35 },
  footerQr: { width: 44, height: 44, objectFit: "contain" as const, borderWidth: 1, borderColor: "#E6E2DB", padding: 2 },
  footerQrLabel: { fontSize: 6, color: CHARCOAL, textAlign: "center" as TextAlign, marginTop: 2, fontFamily: "Helvetica-Bold" },
  coverTitle: { fontSize: 32, fontFamily: "Helvetica-Bold", color: CHARCOAL, marginTop: 64, lineHeight: 1.05 },
  coverKicker: { fontSize: 9, color: ORANGE, fontFamily: "Helvetica-Bold", letterSpacing: 1.8, textTransform: "uppercase" as const },
  coverGrid: { flexDirection: "row", marginTop: 26 },
  coverLeft: { flex: 1, marginRight: 18 },
  coverRight: { width: 180, backgroundColor: CHARCOAL, padding: 16, borderRadius: 2 },
  coverLabel: { fontSize: 8, color: MUTED, textTransform: "uppercase" as const, letterSpacing: 1.2, marginBottom: 3 },
  coverValue: { fontSize: 12, color: SURFACE, fontFamily: "Helvetica-Bold", marginBottom: 12 },
  coverMetricLabel: { fontSize: 8, color: GEAR_GRAY, textTransform: "uppercase" as const, letterSpacing: 1.2 },
  coverMetric: { fontSize: 18, color: ORANGE, fontFamily: "Helvetica-Bold", marginTop: 5 },
  coverMetricSub: { fontSize: 8, color: GEAR_GRAY, marginTop: 4, lineHeight: 1.35 },
  coverTitleCompact: { marginTop: 18, fontSize: 28 },
  coverGallery: { marginTop: 13, marginBottom: 13 },
  coverGalleryLabel: { fontSize: 8, color: ORANGE, fontFamily: "Helvetica-Bold", letterSpacing: 1.2, textTransform: "uppercase" as const, marginBottom: 6 },
  coverGalleryCards: { flexDirection: "row" },
  coverGalleryCard: { flex: 1, marginRight: 7, padding: 7, backgroundColor: PAPER, borderWidth: 1, borderColor: "#E6E2DB", borderBottomWidth: 3, borderBottomColor: ORANGE },
  coverGalleryCardTitle: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: CHARCOAL, marginBottom: 3, lineHeight: 1.2 },
  coverGalleryMeta: { fontSize: 6.5, color: MUTED, marginBottom: 5, lineHeight: 1.2 },
  coverGalleryMainPhoto: { width: "100%", height: 62, objectFit: "cover" as const, marginBottom: 4 },
  coverGalleryThumbRow: { flexDirection: "row" },
  coverGalleryThumb: { width: 30, height: 22, objectFit: "cover" as const, marginRight: 3, borderWidth: 1, borderColor: WHITE },
  coverGalleryMoreNote: { fontSize: 7, color: MUTED, marginTop: 5, lineHeight: 1.3 },
  sectionTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", color: CHARCOAL, marginBottom: 9, marginTop: 6, textTransform: "uppercase" as const, letterSpacing: 1.1 },
  sectionDeck: { fontSize: 9, color: MUTED, lineHeight: 1.45, marginBottom: 10 },
  tableHeader: { flexDirection: "row", backgroundColor: CHARCOAL, paddingVertical: 7, paddingHorizontal: 8 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#E6E2DB", paddingVertical: 7, paddingHorizontal: 8 },
  colDesc: { width: "43%" },
  colQty: { width: "10%", textAlign: "center" as TextAlign },
  colUnit: { width: "17%", textAlign: "right" as TextAlign },
  colExt: { width: "17%", textAlign: "right" as TextAlign },
  colTone: { width: "13%", textAlign: "right" as TextAlign },
  headerText: { fontSize: 7, fontFamily: "Helvetica-Bold", color: WHITE, textTransform: "uppercase" as const, letterSpacing: 0.5 },
  cellText: { fontSize: 8.5, color: SURFACE },
  mutedCell: { fontSize: 7.5, color: MUTED, marginTop: 2 },
  linePhoto: { width: 82, height: 56, objectFit: "cover" as const, marginTop: 5, borderWidth: 1, borderColor: "#E6E2DB", borderBottomWidth: 3, borderBottomColor: ORANGE },
  lineBullet: { fontSize: 7, color: MUTED, marginTop: 2, lineHeight: 1.25 },
  creditText: { color: "#0F7A3A" },
  narrativeBox: { marginTop: 16, padding: 14, backgroundColor: CHARCOAL, borderLeftWidth: 5, borderLeftColor: ORANGE },
  narrativeLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", color: ORANGE, textTransform: "uppercase" as const, letterSpacing: 1.2, marginBottom: 6 },
  narrativeText: { fontSize: 10, color: WHITE, lineHeight: 1.55 },
  insightGrid: { flexDirection: "row", marginTop: 12 },
  insightCard: { flex: 1, borderWidth: 1, borderColor: "#E6E2DB", padding: 10, marginRight: 8 },
  insightTitle: { fontSize: 8, color: ORANGE, fontFamily: "Helvetica-Bold", textTransform: "uppercase" as const, letterSpacing: 0.8, marginBottom: 5 },
  insightBody: { fontSize: 8, color: SURFACE, lineHeight: 1.4, marginBottom: 3 },
  totalsPanel: { backgroundColor: PAPER, padding: 14, borderTopWidth: 4, borderTopColor: ORANGE },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalLabel: { fontSize: 9, color: MUTED },
  totalValue: { fontSize: 9, color: SURFACE, fontFamily: "Helvetica-Bold" },
  grandRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: GEAR_GRAY },
  grandLabel: { fontSize: 13, color: CHARCOAL, fontFamily: "Helvetica-Bold" },
  grandValue: { fontSize: 14, color: ORANGE, fontFamily: "Helvetica-Bold" },
  financeGrid: { flexDirection: "row", marginTop: 12 },
  financeCard: { flex: 1, borderWidth: 1, borderColor: GEAR_GRAY, padding: 11, marginRight: 8, minHeight: 96 },
  financeCardSelected: { borderColor: ORANGE, borderWidth: 2, backgroundColor: "#FFF7EC" },
  financeTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", color: ORANGE, textTransform: "uppercase" as const, letterSpacing: 0.8, marginBottom: 5 },
  financePayment: { fontSize: 18, fontFamily: "Helvetica-Bold", color: CHARCOAL, marginBottom: 5 },
  financeLine: { fontSize: 8, color: SURFACE, marginBottom: 2, lineHeight: 1.35 },
  financeSourceLine: { fontSize: 7.2, color: MUTED, marginTop: 2, lineHeight: 1.3 },
  disclaimer: { fontSize: 7.5, color: MUTED, lineHeight: 1.45, marginTop: 11 },
  supportCard: { backgroundColor: CHARCOAL, padding: 12, marginBottom: 9, borderLeftWidth: 4, borderLeftColor: ORANGE },
  supportTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", color: WHITE, marginBottom: 4 },
  supportBody: { fontSize: 8.5, color: GEAR_GRAY, lineHeight: 1.45 },
  termsBox: { borderWidth: 1, borderColor: GEAR_GRAY, padding: 12, marginTop: 12 },
  termsTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", color: CHARCOAL, marginBottom: 6 },
  termsLine: { fontSize: 8.2, color: SURFACE, lineHeight: 1.45, marginBottom: 4 },
});

function fmt(amount: number | null | undefined): string {
  const safe = Number.isFinite(amount ?? NaN) ? Number(amount) : 0;
  return `$${safe.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function maybe(value: string | number | null | undefined): string {
  return value == null || value === "" ? "—" : String(value);
}

function selectedTotal(data: QuotePDFData): number {
  return data.compliance.primaryTotalLabel === "Amount financed" ? data.amountFinanced : data.customerTotal;
}

function hasVisibleLeaseScenario(options: QuotePDFData["financing"]): boolean {
  return options.some((option) => option.type === "lease" || option.kind === "lease_fmv" || option.kind === "lease_fppo");
}

function financeSectionTitle(data: QuotePDFData, options: QuotePDFData["financing"]): string {
  if (!data.financeComparisonEnabled) return "Selected payment scenario";
  return hasVisibleLeaseScenario(options) ? "Cash / finance / lease comparison" : "Cash / finance comparison";
}

function PageFooter({ data }: { data: QuotePDFData }) {
  const reference = data.quoteNumber || data.dealName || "QEP Proposal";
  return (
    <View style={s.footer}>
      <View style={s.footerRow}>
        <View style={s.footerCopy}>
          <Text style={s.footerText}>{data.compliance.proposalDisclaimer}</Text>
          <Text style={[s.footerText, { marginTop: 3 }]}>{data.branch.name || "Quality Equipment & Parts"} | {reference} | Generated {data.preparedDate}</Text>
        </View>
        {data.brandAssets.qrCode?.src ? (
          <View>
            <Image src={data.brandAssets.qrCode.src} style={s.footerQr} />
            <Text style={s.footerQrLabel}>{QEP_WEBSITE_QR_LABEL}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function PageHeader({ data }: { data: QuotePDFData }) {
  const branch = data.branch;
  const addressLine = [branch.address, branch.city, branch.state, branch.postalCode].filter(Boolean).join(", ");
  return (
    <View style={s.masthead}>
      <View style={s.mastheadRow}>
        <View style={s.brandBlock}>
          {data.brandAssets.qepLogo?.src ? (
            <Image src={data.brandAssets.qepLogo.src} style={s.qepLogo} />
          ) : (
            <Text style={s.brandName}>{branch.name || "Quality Equipment & Parts"}</Text>
          )}
          <View style={s.brandRule} />
          <Text style={s.tagline}>Setting a New Standard in Heavy Equipment. It's in the Name.</Text>
          {data.brandAssets.vendorLogos.length > 0 ? (
            <View style={s.vendorRow}>
              {data.brandAssets.vendorLogos.slice(0, 5).map((logo) => (
                <Image key={logo.src} src={logo.src} style={s.vendorLogo} />
              ))}
            </View>
          ) : null}
        </View>
        <View>
          {addressLine ? <Text style={s.branchMeta}>{addressLine}</Text> : null}
          {branch.phone ? <Text style={s.branchMeta}>{branch.phone}</Text> : null}
          {branch.email ? <Text style={s.branchMeta}>{branch.email}</Text> : null}
          {branch.website ? <Text style={s.branchMeta}>{branch.website}</Text> : null}
        </View>
      </View>
    </View>
  );
}

function lineDetailText(line: QuoteProposalLine): string {
  const machine = [line.year, line.make, line.model].filter(Boolean).join(" ").trim();
  return [
    line.lineType.replace(/_/g, " "),
    machine || null,
    line.stockNumber ? `Stock #: ${line.stockNumber}` : null,
    line.serialNumber ? `Serial #: ${line.serialNumber}` : null,
    line.condition,
    line.warrantyText ? `Warranty: ${line.warrantyText}` : null,
    line.reasonCode ? line.reasonCode.replace(/_/g, " ") : null,
  ].filter(Boolean).join(" · ");
}

function LineItemsTable({ lines }: { lines: QuoteProposalLine[] }) {
  return (
    <View>
      <View style={s.tableHeader}>
        <Text style={[s.headerText, s.colDesc]}>Customer line item</Text>
        <Text style={[s.headerText, s.colQty]}>Qty</Text>
        <Text style={[s.headerText, s.colUnit]}>Unit</Text>
        <Text style={[s.headerText, s.colExt]}>Extended</Text>
        <Text style={[s.headerText, s.colTone]}>Impact</Text>
      </View>
      {lines.map((line, index) => (
        <View key={`${line.description}-${index}`} style={s.tableRow}>
          <View style={s.colDesc}>
            <Text style={s.cellText}>{line.description}</Text>
            <Text style={s.mutedCell}>{lineDetailText(line)}</Text>
            {line.media?.primaryPhoto?.src ? (
              <Image src={line.media.primaryPhoto.src} style={s.linePhoto} />
            ) : null}
            {line.longDescription ? (
              <Text style={s.lineBullet}>{line.longDescription}</Text>
            ) : null}
            {(line.specBullets ?? []).slice(0, 3).map((spec) => (
              <Text key={spec} style={s.lineBullet}>• {spec}</Text>
            ))}
          </View>
          <Text style={[s.cellText, s.colQty]}>{line.quantity}</Text>
          <Text style={[s.cellText, s.colUnit]}>{fmt(line.unitPrice)}</Text>
          <Text style={[s.cellText, s.colExt]}>{fmt(line.extendedPrice)}</Text>
          <Text style={line.tone === "credit" ? [s.cellText, s.colTone, s.creditText] : [s.cellText, s.colTone]}>{line.tone === "credit" ? `-${fmt(line.displayAmount)}` : fmt(line.displayAmount)}</Text>
        </View>
      ))}
    </View>
  );
}

function CoverGallery({ units }: { units: QuoteProposalCoverUnit[] }) {
  const visibleUnits = units.slice(0, 3);
  if (visibleUnits.length === 0) return null;

  return (
    <View style={s.coverGallery}>
      <Text style={s.coverGalleryLabel}>Equipment photo gallery</Text>
      <View style={s.coverGalleryCards}>
        {visibleUnits.map((unit, index) => {
          const [primaryPhoto, ...thumbs] = unit.photos.slice(0, 5);
          return (
            <View key={`${unit.title}-${index}`} style={s.coverGalleryCard}>
              <Text style={s.coverGalleryCardTitle}>{unit.title}</Text>
              {unit.meta ? <Text style={s.coverGalleryMeta}>{unit.meta}</Text> : null}
              {primaryPhoto ? <Image src={primaryPhoto.src} style={s.coverGalleryMainPhoto} /> : null}
              {thumbs.length > 0 ? (
                <View style={s.coverGalleryThumbRow}>
                  {thumbs.map((photo) => <Image key={photo.src} src={photo.src} style={s.coverGalleryThumb} />)}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      {units.length > visibleUnits.length ? (
        <Text style={s.coverGalleryMoreNote}>Additional equipment appears in the configuration summary.</Text>
      ) : null}
    </View>
  );
}

function FinancingCard({ option, selected }: { option: QuotePDFData["financing"][number]; selected: boolean }) {
  const payment = option.type === "cash"
    ? (option.totalCost != null ? fmt(option.totalCost) : "Cash purchase")
    : option.monthlyPayment != null ? `${fmt(option.monthlyPayment)} / mo` : "Payment estimate pending";
  const aprSource = formatAprSourceAttribution(option);
  return (
    <View style={selected ? [s.financeCard, s.financeCardSelected] : s.financeCard}>
      <Text style={s.financeTitle}>{option.label ?? option.type}{selected ? " · Selected" : ""}</Text>
      <Text style={s.financePayment}>{payment}</Text>
      <Text style={s.financeLine}>Term: {option.termMonths != null ? `${option.termMonths} months` : "TBD"}</Text>
      <Text style={s.financeLine}>Rate/APR: {option.rate != null ? `${option.rate.toFixed(2)}%` : "Subject to approval"}</Text>
      {aprSource ? <Text style={s.financeSourceLine}>{aprSource}</Text> : null}
      {option.totalCost != null ? <Text style={s.financeLine}>Estimated total: {fmt(option.totalCost)}</Text> : null}
      {option.downPayment != null ? <Text style={s.financeLine}>Down payment: {fmt(option.downPayment)}</Text> : null}
      {option.lender ? <Text style={[s.financeLine, { color: MUTED }]}>via {option.lender}</Text> : null}
    </View>
  );
}

export function QuotePDFDocument({ data }: { data: QuotePDFData }) {
  const b = data.branch;
  const financingOptions = data.financing.filter(isDisplayableProposalFinanceScenario).slice(0, 3);
  const paymentSectionTitle = financeSectionTitle(data, financingOptions);
  const selectedFinancing = financingOptions.find((option) => data.selectedFinancingLabel && option.label === data.selectedFinancingLabel) ?? financingOptions[0] ?? null;
  const facts = data.narrative.facts.slice(0, 4);
  const highlights = data.narrative.highlights.slice(0, 2);
  const hasCoverGallery = data.coverGalleryUnits.length > 0;

  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <PageHeader data={data} />
        <Text style={s.coverKicker}>Customer equipment proposal</Text>
        <Text style={hasCoverGallery ? [s.coverTitle, s.coverTitleCompact] : s.coverTitle}>Built for the job. Backed by QEP.</Text>
        <CoverGallery units={data.coverGalleryUnits} />
        <View style={s.coverGrid}>
          <View style={s.coverLeft}>
            <Text style={s.coverLabel}>Prepared for</Text>
            <Text style={s.coverValue}>{data.customerName}</Text>
            <Text style={s.coverLabel}>Recommended machine</Text>
            <Text style={s.coverValue}>{data.primaryMachineTitle || "Equipment configuration"}</Text>
            <Text style={s.coverLabel}>Quote reference</Text>
            <Text style={s.coverValue}>{data.quoteNumber || data.dealName || "New quote"}</Text>
            <Text style={s.coverLabel}>Prepared by</Text>
            <Text style={s.coverValue}>{data.preparedBy} · {data.preparedDate}</Text>
          </View>
          <View style={s.coverRight}>
            <Text style={s.coverMetricLabel}>{data.compliance.primaryTotalLabel}</Text>
            <Text style={s.coverMetric}>{fmt(selectedTotal(data))}</Text>
            <Text style={s.coverMetricSub}>Customer total: {fmt(data.customerTotal)}</Text>
            {data.compliance.primaryTotalLabel === "Amount financed" ? <Text style={s.coverMetricSub}>Amount financed after cash down: {fmt(data.amountFinanced)}</Text> : null}
            {data.validUntil ? <Text style={s.coverMetricSub}>Valid until: {data.validUntil}</Text> : null}
          </View>
        </View>
        {data.narrative.text ? (
          <View style={s.narrativeBox}>
            <Text style={s.narrativeLabel}>Why this machine</Text>
            <Text style={s.narrativeText}>{data.narrative.text}</Text>
          </View>
        ) : null}
        <PageFooter data={data} />
      </Page>

      <Page size="LETTER" style={s.page}>
        <PageHeader data={data} />
        <Text style={s.sectionTitle}>Configuration waterfall</Text>
        <Text style={s.sectionDeck}>Customer-visible charges and credits are shown from one proposal data model. Internal margin, cost, source IDs, and approval data are excluded.</Text>
        <LineItemsTable lines={data.lineItems} />
        {data.narrative.text ? (
          <View style={s.narrativeBox}>
            <Text style={s.narrativeLabel}>Confirmed customer narrative</Text>
            <Text style={s.narrativeText}>{data.narrative.text}</Text>
          </View>
        ) : null}
        {(facts.length > 0 || highlights.length > 0) ? (
          <View style={s.insightGrid}>
            {facts.length > 0 ? (
              <View style={s.insightCard}>
                <Text style={s.insightTitle}>Intake facts</Text>
                {facts.map((fact) => <Text key={`${fact.label}-${fact.value}`} style={s.insightBody}>{fact.label}: {fact.value}</Text>)}
              </View>
            ) : null}
            {highlights.length > 0 ? (
              <View style={s.insightCard}>
                <Text style={s.insightTitle}>Customer signals</Text>
                {highlights.map((item) => <Text key={item.supports} style={s.insightBody}>{item.supports}</Text>)}
              </View>
            ) : null}
          </View>
        ) : null}
        <PageFooter data={data} />
      </Page>

      <Page size="LETTER" style={s.page}>
        <PageHeader data={data} />
        <Text style={s.sectionTitle}>Commercial summary and payment scenarios</Text>
        <View style={s.totalsPanel}>
          <View style={s.totalRow}><Text style={s.totalLabel}>Equipment total</Text><Text style={s.totalValue}>{fmt(data.equipmentTotal)}</Text></View>
          {data.attachmentTotal > 0 ? <View style={s.totalRow}><Text style={s.totalLabel}>Attachments/options</Text><Text style={s.totalValue}>{fmt(data.attachmentTotal)}</Text></View> : null}
          {data.pricingLineTotal > 0 ? <View style={s.totalRow}><Text style={s.totalLabel}>Fees/adders</Text><Text style={s.totalValue}>{fmt(data.pricingLineTotal)}</Text></View> : null}
          <View style={s.totalRow}><Text style={s.totalLabel}>Subtotal</Text><Text style={s.totalValue}>{fmt(data.subtotal)}</Text></View>
          {data.discountTotal > 0 ? <View style={s.totalRow}><Text style={s.totalLabel}>Commercial discounts/rebates</Text><Text style={[s.totalValue, s.creditText]}>-{fmt(data.discountTotal)}</Text></View> : null}
          {data.tradeAllowance > 0 ? <View style={s.totalRow}><Text style={s.totalLabel}>Trade-in allowance</Text><Text style={[s.totalValue, s.creditText]}>-{fmt(data.tradeAllowance)}</Text></View> : null}
          <View style={s.grandRow}><Text style={s.grandLabel}>Net before tax</Text><Text style={s.grandValue}>{fmt(data.netTotal)}</Text></View>
          <View style={s.totalRow}><Text style={s.totalLabel}>{data.compliance.taxLabel}</Text><Text style={s.totalValue}>{fmt(data.taxTotal)}</Text></View>
          {data.compliance.taxDetail ? <Text style={s.disclaimer}>{data.compliance.taxDetail}</Text> : null}
          <View style={s.totalRow}><Text style={s.totalLabel}>Customer total</Text><Text style={s.totalValue}>{fmt(data.customerTotal)}</Text></View>
          {data.cashDown > 0 ? <View style={s.totalRow}><Text style={s.totalLabel}>Cash down / deposit credit</Text><Text style={[s.totalValue, s.creditText]}>-{fmt(data.cashDown)}</Text></View> : null}
          <View style={s.grandRow}><Text style={s.grandLabel}>{data.compliance.primaryTotalLabel}</Text><Text style={s.grandValue}>{fmt(selectedTotal(data))}</Text></View>
        </View>

        {financingOptions.length > 0 ? (
          <>
            <Text style={s.sectionTitle}>{paymentSectionTitle}</Text>
            <View style={s.financeGrid}>
              {financingOptions.map((option) => (
                <FinancingCard key={option.label ?? option.type} option={option} selected={selectedFinancing === option} />
              ))}
            </View>
          </>
        ) : null}
        <Text style={s.disclaimer}>{data.compliance.financingDisclaimer}</Text>
        <PageFooter data={data} />
      </Page>

      <Page size="LETTER" style={s.page}>
        <PageHeader data={data} />
        <Text style={s.sectionTitle}>QEP support, terms, and next steps</Text>
        <View style={s.supportCard}>
          <Text style={s.supportTitle}>Equipment, parts, rental, and service under one roof</Text>
          <Text style={s.supportBody}>QEP supports the machine beyond delivery with field service, parts availability, rental flexibility, and lifecycle guidance for fleet owners and operators.</Text>
        </View>
        <View style={s.supportCard}>
          <Text style={s.supportTitle}>Downtime-aware local support</Text>
          <Text style={s.supportBody}>Your QEP team can coordinate inspections, delivery, preventive maintenance, warranty support, and urgent parts/service response through the branch listed on this proposal.</Text>
        </View>
        <View style={s.supportCard}>
          <Text style={s.supportTitle}>Clear commercial handoff</Text>
          <Text style={s.supportBody}>The line-item waterfall, taxes, payment scenarios, and special terms shown here are designed to make the buying decision clear before signature.</Text>
        </View>
        <View style={s.termsBox}>
          <Text style={s.termsTitle}>Proposal details</Text>
          <Text style={s.termsLine}>Quote: {data.quoteNumber || data.dealName || "QEP Proposal"}</Text>
          <Text style={s.termsLine}>Prepared by: {data.preparedBy}</Text>
          <Text style={s.termsLine}>Valid until: {maybe(data.validUntil ?? data.compliance.validUntil)}</Text>
          <Text style={s.termsLine}>Delivery ETA: {maybe(data.deliveryEta)}</Text>
          <Text style={s.termsLine}>Deposit required: {data.depositRequiredAmount != null ? fmt(data.depositRequiredAmount) : "Not required unless specified by your QEP representative."}</Text>
          <Text style={s.termsLine}>Special terms: {data.specialTerms || "Standard QEP proposal terms apply; final terms confirmed at signature."}</Text>
          <Text style={s.termsLine}>{data.compliance.taxDetail || "Tax subject to final jurisdiction confirmation."}</Text>
          {b.phone ? <Text style={s.termsLine}>Phone: {b.phone}</Text> : null}
          {b.email ? <Text style={s.termsLine}>Email: {b.email}</Text> : null}
        </View>
        <PageFooter data={data} />
      </Page>
    </Document>
  );
}
