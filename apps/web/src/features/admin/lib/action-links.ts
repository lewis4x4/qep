export interface ActionLink {
  label: string;
  href: string;
}

interface BaseQueueItem {
  entity_table: string | null;
  entity_id: string | null;
  detail?: unknown;
  payload?: Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function issueDealId(item: BaseQueueItem): string | null {
  const detail = typeof item.detail === "object" && item.detail !== null
    ? item.detail as Record<string, unknown>
    : {};
  return readString(detail.deal_id) ?? readString(item.payload?.deal_id);
}

export function resolveEntityAction(item: BaseQueueItem): ActionLink | null {
  const table = item.entity_table ?? "";
  const entityId = item.entity_id;

  if ((table === "qrm_equipment" || table === "crm_equipment") && entityId) {
    return { label: "Open equipment", href: `/qrm/equipment/${entityId}` };
  }
  if ((table === "qrm_companies" || table === "crm_companies") && entityId) {
    return { label: "Open company", href: `/qrm/companies/${entityId}` };
  }
  if ((table === "qrm_contacts" || table === "crm_contacts") && entityId) {
    return { label: "Open contact", href: `/qrm/contacts/${entityId}` };
  }
  if ((table === "qrm_deals" || table === "crm_deals") && entityId) {
    return { label: "Open deal", href: `/qrm/deals/${entityId}` };
  }
  if (table === "quote_packages") {
    const dealId = issueDealId(item);
    if (dealId) {
      return { label: "Open quote", href: `/quote-v2?deal_id=${encodeURIComponent(dealId)}` };
    }
  }
  if (table === "equipment_documents") {
    return { label: "Open documents", href: "/portal/documents" };
  }
  if (table === "service_jobs" && entityId) {
    return { label: "Open service dashboard", href: "/service/dashboard" };
  }
  return null;
}

export function resolveDataQualityPlaybook(issueClass: string, item: BaseQueueItem): ActionLink | null {
  if (issueClass === "quotes_no_tax_jurisdiction" || issueClass === "quote_no_validity_window") {
    const dealId = issueDealId(item);
    if (dealId) {
      return { label: "Open quote playbook", href: `/quote-v2?deal_id=${encodeURIComponent(dealId)}` };
    }
  }
  if (issueClass === "documents_unclassified") {
    return { label: "Open admin review", href: "/admin" };
  }
  if (issueClass === "equipment_no_geocoords" || issueClass === "equipment_stale_telematics") {
    return { label: "Open fleet map", href: "/fleet" };
  }
  if (issueClass === "account_no_budget_cycle" || issueClass === "account_no_tax_treatment") {
    const entity = resolveEntityAction(item);
    if (entity) return { label: "Open company playbook", href: entity.href };
  }
  if (issueClass === "contact_stale_ownership") {
    const entity = resolveEntityAction(item);
    if (entity) return { label: "Open contact playbook", href: entity.href };
  }
  return null;
}

export function resolveExceptionPlaybook(source: string, item: BaseQueueItem): ActionLink | null {
  if (source === "tax_failed") {
    const dealId = readString(item.payload?.deal_id) ?? issueDealId(item);
    if (dealId) {
      return { label: "Open quote playbook", href: `/quote-v2?deal_id=${encodeURIComponent(dealId)}` };
    }
    return { label: "Open quote builder", href: "/quote-v2" };
  }
  if (source === "price_unmatched") {
    return { label: "Open price intelligence", href: "/price-intelligence" };
  }
  if (source === "health_refresh_failed") {
    return { label: "Open nervous system", href: "/nervous-system" };
  }
  if (source === "ar_override_pending") {
    const entity = resolveEntityAction(item);
    return entity ? { label: "Open AR playbook", href: entity.href } : { label: "Open account view", href: "/qrm/companies" };
  }
  if (source === "portal_reorder_approval") {
    return { label: "Open portal parts queue", href: "/service/portal-parts" };
  }
  if (source === "sop_evidence_mismatch") {
    return { label: "Open SOP compliance", href: "/ops/sop-compliance" };
  }
  if (source === "geofence_conflict" || source === "stale_telematics") {
    return { label: "Open fleet map", href: "/fleet" };
  }
  if (source === "doc_visibility") {
    return { label: "Open documents", href: "/portal/documents" };
  }
  if (source === "data_quality") {
    return { label: "Open data quality", href: "/admin/data-quality" };
  }
  if (source === "stripe_mismatch") {
    return { label: "Open invoices", href: "/portal/invoices" };
  }
  return null;
}
