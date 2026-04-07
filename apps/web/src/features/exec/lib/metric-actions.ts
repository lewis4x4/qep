export interface MetricActionLink {
  label: string;
  href: string;
}

export function resolveMetricPlaybook(metricKey: string | null): MetricActionLink | null {
  if (!metricKey) return null;

  if (metricKey === "weighted_pipeline" || metricKey === "forecast_confidence_score") {
    return { label: "Open pipeline playbook", href: "/qrm/deals" };
  }
  if (metricKey === "quote_expiring_7d") {
    return { label: "Open quote builder", href: "/quote-v2" };
  }
  if (metricKey === "service_backlog_overdue" || metricKey === "service_parts_waiting") {
    return { label: "Open service dashboard", href: "/service/dashboard" };
  }
  if (metricKey === "open_exception_count") {
    return { label: "Open exception inbox", href: "/exceptions" };
  }
  if (metricKey === "open_data_quality_count") {
    return { label: "Open data quality", href: "/admin/data-quality" };
  }
  if (metricKey === "receipt_compliance_rate" || metricKey === "payment_exception_rate") {
    return { label: "Open payment validation", href: "/service/invoice" };
  }
  if (metricKey === "health_score_movers") {
    return { label: "Open nervous system", href: "/nervous-system" };
  }

  return null;
}

export function resolveMetricRecordLink(metricKey: string | null): MetricActionLink | null {
  if (!metricKey) return null;

  if (metricKey === "weighted_pipeline" || metricKey === "quote_expiring_7d") {
    return { label: "Open QRM hub", href: "/qrm" };
  }
  if (metricKey === "service_backlog_overdue" || metricKey === "service_parts_waiting") {
    return { label: "Open service work queue", href: "/service" };
  }
  if (metricKey === "open_exception_count") {
    return { label: "Open exception queue", href: "/exceptions" };
  }
  if (metricKey === "open_data_quality_count") {
    return { label: "Open audit queue", href: "/admin/data-quality" };
  }

  return null;
}
