/**
 * quote-parts-materializer.ts — the sales↔parts seam (Stream N / N2.1).
 *
 * Two jobs, one price canon (parts_resolve_priced_line, m676 — customer/
 * volume pricing, margin floor, 5% counter cap, authority trail):
 *
 * 1. applyGovernedPartPricing — at quote save, part-type lines get the same
 *    governed price the counter would charge, stamped with provenance.
 *    Zero-blocking: an unresolvable part keeps the rep's price and carries
 *    pricing_governance.status='unresolved' instead of failing the save.
 *
 * 2. materializePartsOrderFromQuote — at quote acceptance, part-type lines
 *    become a draft parts_orders row (order_source='quote', FK back to the
 *    quote package) so the counter picks/fulfills and the M2.1 delivered
 *    transition invoices it. Idempotent per quote package; acceptance is
 *    never blocked by materialization failures.
 */

// deno-lint-ignore no-explicit-any
type AdminClient = any;

type PricedPart = {
  part_catalog_id: string | null;
  part_id: string | null;
  part_number: string;
  description: string | null;
  price_source: string;
  price_source_id: string | null;
  pricing_rule_id: string | null;
  list_unit_price_cents: number;
  base_unit_price_cents: number;
  final_unit_price_cents: number;
  requested_discount_pct: number;
  applied_discount_pct: number;
  discount_authority: string;
  discount_approval_status: string;
  margin_floor_applied: boolean;
  pricing_metadata: Record<string, unknown>;
};

function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

function partNumberOf(line: Record<string, unknown>): string | null {
  const metadata = line.metadata && typeof line.metadata === "object" && !Array.isArray(line.metadata)
    ? line.metadata as Record<string, unknown>
    : {};
  const candidate = metadata.part_number ?? line.part_number ?? null;
  const text = typeof candidate === "string" ? candidate.trim() : "";
  return text.length > 0 ? text : null;
}

export async function pricePartLine(
  admin: AdminClient,
  input: {
    partNumber: string;
    crmCompanyId: string | null;
    quantity: number;
    requestedDiscountPct?: number;
  },
): Promise<PricedPart | null> {
  const { data, error } = await admin
    .rpc("parts_resolve_priced_line", {
      p_part_number: input.partNumber,
      p_part_catalog_id: null,
      p_qrm_company_id: null,
      p_crm_company_id: input.crmCompanyId,
      p_quantity: input.quantity,
      p_requested_discount_pct: input.requestedDiscountPct ?? 0,
    })
    .single();
  if (error || !data) {
    console.error("quote parts pricing resolver:", error?.message ?? "no row");
    return null;
  }
  const row = data as Record<string, unknown>;
  return {
    part_catalog_id: typeof row.part_catalog_id === "string" ? row.part_catalog_id : null,
    part_id: typeof row.part_id === "string" ? row.part_id : null,
    part_number: String(row.part_number ?? input.partNumber),
    description: typeof row.description === "string" ? row.description : null,
    price_source: String(row.price_source ?? "list_price"),
    price_source_id: typeof row.price_source_id === "string" ? row.price_source_id : null,
    pricing_rule_id: typeof row.pricing_rule_id === "string" ? row.pricing_rule_id : null,
    list_unit_price_cents: Number(row.list_unit_price_cents) || 0,
    base_unit_price_cents: Number(row.base_unit_price_cents) || 0,
    final_unit_price_cents: Number(row.final_unit_price_cents) || 0,
    requested_discount_pct: Number(row.requested_discount_pct) || 0,
    applied_discount_pct: Number(row.applied_discount_pct) || 0,
    discount_authority: String(row.discount_authority ?? "none"),
    discount_approval_status: String(row.discount_approval_status ?? "not_required"),
    margin_floor_applied: Boolean(row.margin_floor_applied),
    pricing_metadata: (row.pricing_metadata && typeof row.pricing_metadata === "object")
      ? row.pricing_metadata as Record<string, unknown>
      : {},
  };
}

/**
 * Governed pricing pass over normalized quote line rows (pre-persist).
 * Mutates only line_type='part' rows with a resolvable part number.
 */
export async function applyGovernedPartPricing(
  admin: AdminClient,
  crmCompanyId: string | null,
  lineRows: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  for (const row of lineRows) {
    if (row.line_type !== "part") continue;
    const partNumber = partNumberOf(row);
    const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? { ...(row.metadata as Record<string, unknown>) }
      : {};
    if (!partNumber) {
      metadata.pricing_governance = { status: "unresolved", reason: "no_part_number" };
      row.metadata = metadata;
      continue;
    }
    const quantity = Math.max(1, Number(row.quantity) || 1);
    const priced = await pricePartLine(admin, { partNumber, crmCompanyId, quantity });
    if (!priced) {
      metadata.pricing_governance = { status: "unresolved", reason: "resolver_failed" };
      row.metadata = metadata;
      continue;
    }
    const unitPrice = centsToDollars(priced.final_unit_price_cents);
    row.unit_price = unitPrice;
    row.extended_price = Math.round(unitPrice * quantity * 100) / 100;
    metadata.pricing_governance = {
      status: "governed",
      price_source: priced.price_source,
      pricing_rule_id: priced.pricing_rule_id,
      list_unit_price: centsToDollars(priced.list_unit_price_cents),
      final_unit_price: unitPrice,
      applied_discount_pct: priced.applied_discount_pct,
      margin_floor_applied: priced.margin_floor_applied,
    };
    metadata.part_number = priced.part_number;
    row.metadata = metadata;
  }
  return lineRows;
}

export type MaterializeResult =
  | { status: "skipped"; reason: "already_materialized" | "no_part_lines" | "no_company" | "quote_not_found" | "workspace_mismatch"; partsOrderId?: string }
  | { status: "created"; partsOrderId: string; lineCount: number; subtotal: number; warnings: string[] };

async function resolveQuoteCompanyId(
  admin: AdminClient,
  quote: { deal_id?: unknown; contact_id?: unknown; workspace_id?: unknown },
): Promise<string | null> {
  const workspaceId = typeof quote.workspace_id === "string" ? quote.workspace_id : "default";

  if (quote.deal_id) {
    const { data: deal } = await admin
      .from("qrm_deals")
      .select("company_id, workspace_id")
      .eq("id", quote.deal_id as string)
      .maybeSingle();
    if (deal) {
      const dealWorkspaceId = typeof deal.workspace_id === "string" ? deal.workspace_id : null;
      if (dealWorkspaceId && dealWorkspaceId !== workspaceId) {
        return null;
      }
      const companyId = (deal.company_id as string | null) ?? null;
      if (companyId) return companyId;
    }
  }

  if (quote.contact_id) {
    const { data: contact } = await admin
      .from("qrm_contacts")
      .select("primary_company_id, workspace_id")
      .eq("id", quote.contact_id as string)
      .maybeSingle();
    if (contact) {
      const contactWorkspaceId = typeof contact.workspace_id === "string" ? contact.workspace_id : null;
      if (contactWorkspaceId && contactWorkspaceId !== workspaceId) {
        return null;
      }
      return (contact.primary_company_id as string | null) ?? null;
    }
  }

  return null;
}

export async function materializePartsOrderFromQuote(
  admin: AdminClient,
  quotePackageId: string,
): Promise<MaterializeResult> {
  const { data: existing } = await admin
    .from("parts_orders")
    .select("id")
    .eq("quote_package_id", quotePackageId)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return { status: "skipped", reason: "already_materialized", partsOrderId: existing.id as string };
  }

  const { data: quote } = await admin
    .from("quote_packages")
    .select("id, workspace_id, deal_id, contact_id")
    .eq("id", quotePackageId)
    .maybeSingle();
  if (!quote) return { status: "skipped", reason: "quote_not_found" };

  const workspaceId = typeof quote.workspace_id === "string" ? quote.workspace_id : "default";

  if (quote.deal_id) {
    const { data: deal } = await admin
      .from("qrm_deals")
      .select("workspace_id")
      .eq("id", quote.deal_id as string)
      .maybeSingle();
    const dealWorkspaceId = typeof deal?.workspace_id === "string" ? deal.workspace_id : null;
    if (dealWorkspaceId && dealWorkspaceId !== workspaceId) {
      return { status: "skipped", reason: "workspace_mismatch" };
    }
  }

  const { data: partLines } = await admin
    .from("quote_package_line_items")
    .select("id, line_type, description, quantity, unit_price, extended_price, metadata, display_order")
    .eq("quote_package_id", quotePackageId)
    .eq("line_type", "part")
    .order("display_order", { ascending: true });
  if (!partLines || partLines.length === 0) {
    return { status: "skipped", reason: "no_part_lines" };
  }

  const crmCompanyId = await resolveQuoteCompanyId(admin, quote);
  if (!crmCompanyId) {
    await admin.rpc("enqueue_exception", {
      p_source: "data_quality",
      p_title: "Accepted quote has part lines but no company — counter order not staged",
      p_severity: "warn",
      p_detail: `Quote package ${quotePackageId} accepted with ${partLines.length} part line(s) but its deal carries no company; parts order materialization skipped.`,
      p_payload: { quote_package_id: quotePackageId },
      p_entity_table: "quote_packages",
      p_entity_id: quotePackageId,
    });
    return { status: "skipped", reason: "no_company" };
  }

  const warnings: string[] = [];
  const orderLines: Array<Record<string, unknown>> = [];
  for (const [index, line] of (partLines as Array<Record<string, unknown>>).entries()) {
    const partNumber = partNumberOf(line);
    const quantity = Math.max(1, Number(line.quantity) || 1);
    if (!partNumber) {
      warnings.push(`line ${index + 1}: no part number — skipped`);
      continue;
    }
    const priced = await pricePartLine(admin, { partNumber, crmCompanyId, quantity });
    const unitPrice = priced
      ? centsToDollars(priced.final_unit_price_cents)
      : Math.round((Number(line.unit_price) || 0) * 100) / 100;
    if (!priced) warnings.push(`line ${index + 1} (${partNumber}): resolver failed — quote price kept`);
    orderLines.push({
      catalog_item_id: priced?.part_catalog_id ?? null,
      part_id: priced?.part_id ?? null,
      part_number: partNumber,
      description: (line.description as string | null) ?? priced?.description ?? null,
      quantity,
      unit_price: unitPrice,
      line_total: Math.round(unitPrice * quantity * 10000) / 10000,
      sort_order: index,
      price_source: priced?.price_source ?? "quote_unresolved",
      price_source_id: priced?.price_source_id ?? null,
      pricing_rule_id: priced?.pricing_rule_id ?? null,
      requested_discount_pct: priced?.requested_discount_pct ?? 0,
      applied_discount_pct: priced?.applied_discount_pct ?? 0,
      discount_authority: priced?.discount_authority ?? "none",
      discount_approval_status: priced?.discount_approval_status ?? "not_required",
      list_unit_price: priced ? centsToDollars(priced.list_unit_price_cents) : unitPrice,
      base_unit_price: priced ? centsToDollars(priced.base_unit_price_cents) : unitPrice,
      final_unit_price: unitPrice,
      margin_floor_applied: priced?.margin_floor_applied ?? false,
      pricing_metadata: priced?.pricing_metadata ?? { source: "quote_unresolved" },
    });
  }

  if (orderLines.length === 0) {
    return { status: "skipped", reason: "no_part_lines" };
  }

  const subtotal = Math.round(orderLines.reduce((sum, line) => sum + Number(line.line_total ?? 0), 0) * 10000) / 10000;

  const { data: order, error: orderError } = await admin
    .from("parts_orders")
    .insert({
      workspace_id: workspaceId,
      status: "draft",
      portal_customer_id: null,
      crm_company_id: crmCompanyId,
      order_source: "quote",
      quote_package_id: quotePackageId,
      notes: `Staged from accepted quote ${String(quotePackageId).slice(0, 8)}`,
      line_items: orderLines,
      subtotal,
      tax: 0,
      shipping: 0,
      total: subtotal,
    })
    .select("id")
    .single();
  if (orderError || !order) {
    if (orderError?.code === "23505") {
      const { data: raced } = await admin
        .from("parts_orders")
        .select("id")
        .eq("quote_package_id", quotePackageId)
        .limit(1)
        .maybeSingle();
      if (raced) {
        return { status: "skipped", reason: "already_materialized", partsOrderId: raced.id as string };
      }
    }
    throw new Error(`parts order materialization failed: ${orderError?.message ?? "no row"}`);
  }
  const partsOrderId = order.id as string;

  const { error: linesError } = await admin
    .from("parts_order_lines")
    .insert(orderLines.map((line) => ({ parts_order_id: partsOrderId, ...line })));
  if (linesError) warnings.push(`parts_order_lines insert failed: ${linesError.message}`);

  return { status: "created", partsOrderId, lineCount: orderLines.length, subtotal, warnings };
}
