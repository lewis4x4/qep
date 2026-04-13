/**
 * Quote PDF Document — 4-page branded proposal.
 *
 * Page 1: Cover — branding, customer, quote number, date
 * Page 2: Configuration — equipment table, attachments, AI summary
 * Page 3: Pricing & Financing — totals, trade-in, scenarios
 * Page 4: Why QEP — value proposition, warranty, branch contact
 *
 * Customer-facing: does NOT show margin data.
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

// ─── Shared styles ──────────────────────────────────────────────────────────

const ORANGE = "#E87722";
const DARK = "#1a2332";
const GRAY = "#666";
const LIGHT_GRAY = "#f5f5f5";

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 10, padding: 40, color: "#1a1a1a" },
  // Shared header
  headerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24, paddingBottom: 16, borderBottomWidth: 2, borderBottomColor: ORANGE },
  brandName: { fontSize: 18, fontFamily: "Helvetica-Bold", color: ORANGE },
  branchMeta: { fontSize: 8, color: GRAY, textAlign: "right" as const, lineHeight: 1.5 },
  // Cover-specific
  coverTitle: { fontSize: 28, fontFamily: "Helvetica-Bold", color: DARK, marginTop: 80, textAlign: "center" as const },
  coverSubtitle: { fontSize: 12, color: GRAY, textAlign: "center" as const, marginTop: 8 },
  coverMeta: { fontSize: 10, color: GRAY, textAlign: "center" as const, marginTop: 4 },
  accentBar: { height: 4, backgroundColor: ORANGE, marginVertical: 32 },
  coverCustomer: { fontSize: 16, fontFamily: "Helvetica-Bold", color: DARK, textAlign: "center" as const, marginTop: 24 },
  // Section
  sectionTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 8, marginTop: 16, color: "#333", textTransform: "uppercase" as const, letterSpacing: 1 },
  // Table
  tableHeader: { flexDirection: "row", backgroundColor: LIGHT_GRAY, borderBottomWidth: 1, borderBottomColor: "#ddd", paddingVertical: 6, paddingHorizontal: 8 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#eee", paddingVertical: 6, paddingHorizontal: 8 },
  colDesc: { width: "50%" },
  colYear: { width: "15%", textAlign: "center" as const },
  colPrice: { width: "35%", textAlign: "right" as const },
  headerText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: GRAY, textTransform: "uppercase" as const },
  cellText: { fontSize: 10 },
  // Totals
  totalsBlock: { marginTop: 16, paddingTop: 12, borderTopWidth: 2, borderTopColor: ORANGE },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalLabel: { fontSize: 10, color: GRAY },
  totalValue: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  grandTotalLabel: { fontSize: 14, fontFamily: "Helvetica-Bold", color: ORANGE },
  grandTotalValue: { fontSize: 14, fontFamily: "Helvetica-Bold", color: ORANGE },
  // Financing
  financingCard: { flexDirection: "row", gap: 12, marginTop: 8 },
  financingOption: { flex: 1, borderWidth: 1, borderColor: "#ddd", borderRadius: 4, padding: 10 },
  financingTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: ORANGE, marginBottom: 4, textTransform: "uppercase" as const },
  financingLine: { fontSize: 9, color: "#333", marginBottom: 2 },
  // Footer
  footer: { position: "absolute" as const, bottom: 30, left: 40, right: 40, borderTopWidth: 1, borderTopColor: "#ddd", paddingTop: 8 },
  footerText: { fontSize: 7, color: "#999", textAlign: "center" as const },
  // Why QEP
  valueCard: { borderWidth: 1, borderColor: "#ddd", borderRadius: 4, padding: 12, marginBottom: 10 },
  valueTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", color: DARK, marginBottom: 4 },
  valueBody: { fontSize: 9, color: "#444", lineHeight: 1.5 },
  // AI summary
  aiBox: { backgroundColor: "#FFF5EB", borderWidth: 1, borderColor: "#E8772233", borderRadius: 4, padding: 10, marginTop: 12 },
  aiLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", color: ORANGE, textTransform: "uppercase" as const, letterSpacing: 0.5 },
  aiText: { fontSize: 9, color: "#444", marginTop: 4, fontStyle: "italic" as const },
});

// ─── Types ──────────────────────────────────────────────────────────────────

export interface QuotePDFData {
  dealName: string;
  customerName: string;
  quoteNumber?: string | null;
  preparedBy: string;
  preparedDate: string;
  aiRecommendationSummary?: string | null;
  equipment: Array<{ make: string; model: string; year?: number | null; price: number }>;
  attachments: Array<{ name: string; price: number }>;
  equipmentTotal: number;
  attachmentTotal: number;
  subtotal: number;
  tradeAllowance: number;
  netTotal: number;
  financing: Array<{ type: string; termMonths: number; rate: number; monthlyPayment: number; totalCost: number; lender: string }>;
  branch: { name: string; address?: string; city?: string; state?: string; postalCode?: string; phone?: string; email?: string; website?: string; footerText?: string };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function PageFooter({ branch, date }: { branch: QuotePDFData["branch"]; date: string }) {
  return (
    <View style={s.footer}>
      <Text style={s.footerText}>
        {branch.footerText || "This proposal is valid for 30 days from the date of preparation. Prices are subject to change. All equipment is subject to prior sale."}
      </Text>
      <Text style={[s.footerText, { marginTop: 4 }]}>
        {branch.name || "Quality Equipment & Parts"} | Generated {date}
      </Text>
    </View>
  );
}

function PageHeader({ branch }: { branch: QuotePDFData["branch"] }) {
  const addressLine = [branch.address, branch.city, branch.state, branch.postalCode].filter(Boolean).join(", ");
  return (
    <View style={s.headerRow}>
      <View>
        <Text style={s.brandName}>{branch.name || "Quality Equipment & Parts"}</Text>
        {addressLine ? <Text style={{ fontSize: 8, color: GRAY, marginTop: 2 }}>{addressLine}</Text> : null}
      </View>
      <View>
        {branch.phone ? <Text style={s.branchMeta}>Phone: {branch.phone}</Text> : null}
        {branch.email ? <Text style={s.branchMeta}>Email: {branch.email}</Text> : null}
        {branch.website ? <Text style={s.branchMeta}>{branch.website}</Text> : null}
      </View>
    </View>
  );
}

// ─── Document ───────────────────────────────────────────────────────────────

export function QuotePDFDocument({ data }: { data: QuotePDFData }) {
  const b = data.branch;

  return (
    <Document>
      {/* ── Page 1: Cover ──────────────────────────────────────────────── */}
      <Page size="LETTER" style={s.page}>
        <PageHeader branch={b} />
        <Text style={s.coverTitle}>Equipment Proposal</Text>
        <Text style={s.coverSubtitle}>
          {data.quoteNumber || "Custom Proposal"}
        </Text>
        <View style={s.accentBar} />
        <Text style={s.coverCustomer}>Prepared for {data.customerName}</Text>
        <Text style={s.coverMeta}>{data.preparedDate}</Text>
        <Text style={s.coverMeta}>Prepared by {data.preparedBy}</Text>
        {data.dealName ? <Text style={[s.coverMeta, { marginTop: 8 }]}>Reference: {data.dealName}</Text> : null}
        <PageFooter branch={b} date={data.preparedDate} />
      </Page>

      {/* ── Page 2: Configuration ──────────────────────────────────────── */}
      <Page size="LETTER" style={s.page}>
        <PageHeader branch={b} />
        <Text style={s.sectionTitle}>Equipment Configuration</Text>
        <View style={s.tableHeader}>
          <Text style={[s.headerText, s.colDesc]}>Description</Text>
          <Text style={[s.headerText, s.colYear]}>Year</Text>
          <Text style={[s.headerText, s.colPrice]}>Price</Text>
        </View>
        {data.equipment.map((item, i) => (
          <View key={i} style={s.tableRow}>
            <Text style={[s.cellText, s.colDesc]}>{item.make} {item.model}</Text>
            <Text style={[s.cellText, s.colYear]}>{item.year ?? "\u2014"}</Text>
            <Text style={[s.cellText, s.colPrice]}>{fmt(item.price)}</Text>
          </View>
        ))}

        {data.attachments.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Attachments & Accessories</Text>
            {data.attachments.map((att, i) => (
              <View key={i} style={s.tableRow}>
                <Text style={[s.cellText, s.colDesc]}>{att.name}</Text>
                <Text style={[s.cellText, s.colYear]} />
                <Text style={[s.cellText, s.colPrice]}>{fmt(att.price)}</Text>
              </View>
            ))}
          </>
        )}

        {data.aiRecommendationSummary && (
          <View style={s.aiBox}>
            <Text style={s.aiLabel}>AI Equipment Analysis</Text>
            <Text style={s.aiText}>{data.aiRecommendationSummary}</Text>
          </View>
        )}

        <PageFooter branch={b} date={data.preparedDate} />
      </Page>

      {/* ── Page 3: Pricing & Financing ────────────────────────────────── */}
      <Page size="LETTER" style={s.page}>
        <PageHeader branch={b} />
        <Text style={s.sectionTitle}>Pricing Summary</Text>

        <View style={s.totalsBlock}>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Equipment Total</Text>
            <Text style={s.totalValue}>{fmt(data.equipmentTotal)}</Text>
          </View>
          {data.attachmentTotal > 0 && (
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Attachments</Text>
              <Text style={s.totalValue}>{fmt(data.attachmentTotal)}</Text>
            </View>
          )}
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Subtotal</Text>
            <Text style={s.totalValue}>{fmt(data.subtotal)}</Text>
          </View>
          {data.tradeAllowance > 0 && (
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Trade-In Allowance</Text>
              <Text style={s.totalValue}>({fmt(data.tradeAllowance)})</Text>
            </View>
          )}
          <View style={[s.totalRow, { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#ddd" }]}>
            <Text style={s.grandTotalLabel}>Total</Text>
            <Text style={s.grandTotalValue}>{fmt(data.netTotal)}</Text>
          </View>
        </View>

        {data.financing.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Financing Options</Text>
            <View style={s.financingCard}>
              {data.financing.slice(0, 3).map((f, i) => (
                <View key={i} style={s.financingOption}>
                  <Text style={s.financingTitle}>{f.type}</Text>
                  <Text style={s.financingLine}>Term: {f.termMonths} months</Text>
                  <Text style={s.financingLine}>Rate: {f.rate}%</Text>
                  <Text style={s.financingLine}>Monthly: {fmt(f.monthlyPayment)}</Text>
                  <Text style={s.financingLine}>Total: {fmt(f.totalCost)}</Text>
                  {f.lender ? <Text style={[s.financingLine, { color: "#999" }]}>via {f.lender}</Text> : null}
                </View>
              ))}
            </View>
          </>
        )}

        <PageFooter branch={b} date={data.preparedDate} />
      </Page>

      {/* ── Page 4: Why QEP ────────────────────────────────────────────── */}
      <Page size="LETTER" style={s.page}>
        <PageHeader branch={b} />
        <Text style={s.sectionTitle}>Why Quality Equipment & Parts</Text>

        <View style={s.valueCard}>
          <Text style={s.valueTitle}>Full-Service Dealership</Text>
          <Text style={s.valueBody}>
            From sales to service to parts, QEP is your single point of contact for the entire equipment lifecycle. Our field-ready technicians and stocked parts inventory mean less downtime and faster resolution for your operation.
          </Text>
        </View>

        <View style={s.valueCard}>
          <Text style={s.valueTitle}>Flexible Financing</Text>
          <Text style={s.valueBody}>
            We work with multiple lenders to find the right payment structure for your business. Whether you need a lease, loan, or rental-to-own arrangement, our finance team builds packages that fit your cash flow.
          </Text>
        </View>

        <View style={s.valueCard}>
          <Text style={s.valueTitle}>Warranty & Support</Text>
          <Text style={s.valueBody}>
            Every machine ships with manufacturer warranty coverage. Our certified service department provides warranty support, preventive maintenance programs, and emergency field service to keep you running.
          </Text>
        </View>

        <View style={s.valueCard}>
          <Text style={s.valueTitle}>Trade-In & Fleet Management</Text>
          <Text style={s.valueBody}>
            We offer competitive trade-in valuations and fleet management consulting to help you optimize your equipment investment over time.
          </Text>
        </View>

        <View style={{ marginTop: 24, padding: 16, backgroundColor: LIGHT_GRAY, borderRadius: 4 }}>
          <Text style={{ fontSize: 11, fontFamily: "Helvetica-Bold", color: DARK, marginBottom: 6 }}>
            Ready to move forward?
          </Text>
          <Text style={{ fontSize: 9, color: "#444", lineHeight: 1.5 }}>
            Contact your sales representative or reach us at:
          </Text>
          {b.phone ? <Text style={{ fontSize: 9, color: ORANGE, marginTop: 4 }}>Phone: {b.phone}</Text> : null}
          {b.email ? <Text style={{ fontSize: 9, color: ORANGE }}>Email: {b.email}</Text> : null}
          {b.website ? <Text style={{ fontSize: 9, color: ORANGE }}>{b.website}</Text> : null}
        </View>

        <PageFooter branch={b} date={data.preparedDate} />
      </Page>
    </Document>
  );
}
