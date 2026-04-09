/**
 * Quote PDF Document — React PDF component.
 *
 * Generates a branded multi-page proposal using @react-pdf/renderer.
 * Customer-facing: does NOT show margin data.
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    padding: 40,
    color: "#1a1a1a",
  },
  // Header
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: "#E87722",
  },
  brandName: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: "#E87722",
  },
  branchInfo: {
    fontSize: 8,
    color: "#666",
    textAlign: "right" as const,
    lineHeight: 1.5,
  },
  // Title
  title: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
    color: "#1a1a1a",
  },
  subtitle: {
    fontSize: 10,
    color: "#666",
    marginBottom: 24,
  },
  // Section
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
    marginTop: 16,
    color: "#333",
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  // Table
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f5f5f5",
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  colDescription: { width: "50%" },
  colYear: { width: "15%", textAlign: "center" as const },
  colPrice: { width: "35%", textAlign: "right" as const },
  headerText: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#666",
    textTransform: "uppercase" as const,
  },
  cellText: { fontSize: 10 },
  // Totals
  totalsBlock: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 2,
    borderTopColor: "#E87722",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  totalLabel: { fontSize: 10, color: "#666" },
  totalValue: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  grandTotalLabel: { fontSize: 14, fontFamily: "Helvetica-Bold", color: "#E87722" },
  grandTotalValue: { fontSize: 14, fontFamily: "Helvetica-Bold", color: "#E87722" },
  // Financing
  financingCard: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  financingOption: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 4,
    padding: 10,
  },
  financingTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#E87722",
    marginBottom: 4,
    textTransform: "uppercase" as const,
  },
  financingLine: { fontSize: 9, color: "#333", marginBottom: 2 },
  // Footer
  footer: {
    position: "absolute" as const,
    bottom: 30,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: "#ddd",
    paddingTop: 8,
  },
  footerText: {
    fontSize: 7,
    color: "#999",
    textAlign: "center" as const,
  },
});

// ─── Types ─────────────────────────────────────────────────────────────────

export interface QuotePDFData {
  dealName: string;
  customerName: string;
  preparedBy: string;
  preparedDate: string;
  equipment: Array<{
    make: string;
    model: string;
    year?: number | null;
    price: number;
  }>;
  attachments: Array<{
    name: string;
    price: number;
  }>;
  equipmentTotal: number;
  attachmentTotal: number;
  subtotal: number;
  tradeAllowance: number;
  netTotal: number;
  financing: Array<{
    type: string;
    termMonths: number;
    rate: number;
    monthlyPayment: number;
    totalCost: number;
    lender: string;
  }>;
  branch: {
    name: string;
    address?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    phone?: string;
    email?: string;
    website?: string;
    footerText?: string;
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmt(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Document ──────────────────────────────────────────────────────────────

export function QuotePDFDocument({ data }: { data: QuotePDFData }) {
  const b = data.branch;
  const addressLine = [b.address, b.city, b.state, b.postalCode].filter(Boolean).join(", ");

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.brandName}>{b.name || "Quality Equipment & Parts"}</Text>
            {addressLine && <Text style={{ fontSize: 8, color: "#666", marginTop: 2 }}>{addressLine}</Text>}
          </View>
          <View>
            {b.phone && <Text style={styles.branchInfo}>Phone: {b.phone}</Text>}
            {b.email && <Text style={styles.branchInfo}>Email: {b.email}</Text>}
            {b.website && <Text style={styles.branchInfo}>{b.website}</Text>}
          </View>
        </View>

        {/* Title */}
        <Text style={styles.title}>Equipment Proposal</Text>
        <Text style={styles.subtitle}>
          Prepared for {data.customerName} | {data.preparedDate} | Prepared by {data.preparedBy}
        </Text>

        {/* Deal Reference */}
        <Text style={{ fontSize: 9, color: "#666", marginBottom: 16 }}>
          Reference: {data.dealName}
        </Text>

        {/* Equipment Table */}
        <Text style={styles.sectionTitle}>Equipment</Text>
        <View style={styles.tableHeader}>
          <Text style={[styles.headerText, styles.colDescription]}>Description</Text>
          <Text style={[styles.headerText, styles.colYear]}>Year</Text>
          <Text style={[styles.headerText, styles.colPrice]}>Price</Text>
        </View>
        {data.equipment.map((item, i) => (
          <View key={i} style={styles.tableRow}>
            <Text style={[styles.cellText, styles.colDescription]}>
              {item.make} {item.model}
            </Text>
            <Text style={[styles.cellText, styles.colYear]}>{item.year ?? "—"}</Text>
            <Text style={[styles.cellText, styles.colPrice]}>{fmt(item.price)}</Text>
          </View>
        ))}

        {/* Attachments */}
        {data.attachments.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Attachments</Text>
            {data.attachments.map((att, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={[styles.cellText, styles.colDescription]}>{att.name}</Text>
                <Text style={[styles.cellText, styles.colYear]} />
                <Text style={[styles.cellText, styles.colPrice]}>{fmt(att.price)}</Text>
              </View>
            ))}
          </>
        )}

        {/* Totals */}
        <View style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Equipment Total</Text>
            <Text style={styles.totalValue}>{fmt(data.equipmentTotal)}</Text>
          </View>
          {data.attachmentTotal > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Attachments</Text>
              <Text style={styles.totalValue}>{fmt(data.attachmentTotal)}</Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{fmt(data.subtotal)}</Text>
          </View>
          {data.tradeAllowance > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Trade-In Allowance</Text>
              <Text style={styles.totalValue}>({fmt(data.tradeAllowance)})</Text>
            </View>
          )}
          <View style={[styles.totalRow, { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#ddd" }]}>
            <Text style={styles.grandTotalLabel}>Total</Text>
            <Text style={styles.grandTotalValue}>{fmt(data.netTotal)}</Text>
          </View>
        </View>

        {/* Financing Options */}
        {data.financing.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Financing Options</Text>
            <View style={styles.financingCard}>
              {data.financing.slice(0, 3).map((f, i) => (
                <View key={i} style={styles.financingOption}>
                  <Text style={styles.financingTitle}>{f.type}</Text>
                  <Text style={styles.financingLine}>Term: {f.termMonths} months</Text>
                  <Text style={styles.financingLine}>Rate: {f.rate}%</Text>
                  <Text style={styles.financingLine}>Monthly: {fmt(f.monthlyPayment)}</Text>
                  <Text style={styles.financingLine}>Total: {fmt(f.totalCost)}</Text>
                  {f.lender && <Text style={[styles.financingLine, { color: "#999" }]}>via {f.lender}</Text>}
                </View>
              ))}
            </View>
          </>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {b.footerText || "This proposal is valid for 30 days from the date of preparation. Prices are subject to change. All equipment is subject to prior sale."}
          </Text>
          <Text style={[styles.footerText, { marginTop: 4 }]}>
            {b.name || "Quality Equipment & Parts"} | Generated {data.preparedDate}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
