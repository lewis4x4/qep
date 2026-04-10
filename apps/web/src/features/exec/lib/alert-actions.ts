export interface ExecAlertActionLink {
  label: string;
  href: string;
}

function buildAccountCommandHref(companyId: string): string {
  return `/qrm/accounts/${companyId}/command`;
}

interface AlertActionInput {
  alert_type: string;
  metric_key: string | null;
  entity_type: string | null;
  entity_id: string | null;
}

export function resolveExecAlertRecordLink(alert: AlertActionInput): ExecAlertActionLink | null {
  if (!alert.entity_type || !alert.entity_id) return null;
  if (alert.entity_type === "crm_deal") {
    return { label: "Open deal", href: `/qrm/deals/${alert.entity_id}` };
  }
  if (alert.entity_type === "crm_company") {
    return { label: "Open account command", href: buildAccountCommandHref(alert.entity_id) };
  }
  if (alert.entity_type === "crm_contact") {
    return { label: "Open contact", href: `/qrm/contacts/${alert.entity_id}` };
  }
  if (alert.entity_type === "crm_equipment") {
    return { label: "Open equipment", href: `/qrm/equipment/${alert.entity_id}` };
  }
  if (alert.entity_type === "service_job") {
    return { label: "Open service dashboard", href: "/service/dashboard" };
  }
  if (alert.entity_type === "quote_package") {
    return { label: "Open quote builder", href: "/quote-v2" };
  }
  return null;
}

export function resolveExecAlertPlaybookLink(alert: AlertActionInput): ExecAlertActionLink | null {
  if (alert.metric_key === "weighted_pipeline" || alert.metric_key === "pipeline_at_risk_count") {
    return { label: "Open pipeline playbook", href: "/qrm/deals" };
  }
  if (alert.metric_key === "service_backlog_overdue" || alert.metric_key === "service_parts_waiting") {
    return { label: "Open service playbook", href: "/service/dashboard" };
  }
  if (alert.metric_key === "open_exception_count") {
    return { label: "Open exceptions", href: "/exceptions" };
  }
  if (alert.metric_key === "open_data_quality_count") {
    return { label: "Open data quality", href: "/admin/data-quality" };
  }
  if (alert.metric_key === "quote_expiring_7d") {
    return { label: "Open quote playbook", href: "/quote-v2" };
  }
  if (alert.metric_key === "receipt_compliance_rate" || alert.metric_key === "payment_exception_rate") {
    return { label: "Open invoice playbook", href: "/service/invoice" };
  }
  if (alert.alert_type === "threshold_breach" && alert.entity_type === "crm_company" && alert.entity_id) {
    return { label: "Open account command", href: buildAccountCommandHref(alert.entity_id) };
  }
  return null;
}
