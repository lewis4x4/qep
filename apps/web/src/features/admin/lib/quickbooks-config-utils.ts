export type QuickBooksConfigSummary = {
  integration: {
    display_name: string;
    status: string;
    last_test_success: boolean | null;
    last_test_error: string | null;
    last_sync_error: string | null;
    updated_at: string | null;
  };
  config: {
    client_id: string | null;
    realm_id: string | null;
    environment: "sandbox" | "production";
    has_client_secret: boolean;
    has_refresh_token: boolean;
    account_ids: {
      ar_account_id: string | null;
      service_revenue_account_id: string | null;
      parts_revenue_account_id: string | null;
      haul_revenue_account_id: string | null;
      shop_supplies_account_id: string | null;
      misc_revenue_account_id: string | null;
      tax_liability_account_id: string | null;
    };
    credential_count: number;
    account_mapping_count: number;
    core_ready: boolean;
    ready_for_sync: boolean;
  };
};

export type QuickBooksConfigDraft = {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  realm_id: string;
  environment: "sandbox" | "production";
  ar_account_id: string;
  service_revenue_account_id: string;
  parts_revenue_account_id: string;
  haul_revenue_account_id: string;
  shop_supplies_account_id: string;
  misc_revenue_account_id: string;
  tax_liability_account_id: string;
};

export function buildDraftFromSummary(summary: QuickBooksConfigSummary | null): QuickBooksConfigDraft {
  return {
    client_id: summary?.config.client_id ?? "",
    client_secret: "",
    refresh_token: "",
    realm_id: summary?.config.realm_id ?? "",
    environment: summary?.config.environment ?? "production",
    ar_account_id: summary?.config.account_ids.ar_account_id ?? "",
    service_revenue_account_id: summary?.config.account_ids.service_revenue_account_id ?? "",
    parts_revenue_account_id: summary?.config.account_ids.parts_revenue_account_id ?? "",
    haul_revenue_account_id: summary?.config.account_ids.haul_revenue_account_id ?? "",
    shop_supplies_account_id: summary?.config.account_ids.shop_supplies_account_id ?? "",
    misc_revenue_account_id: summary?.config.account_ids.misc_revenue_account_id ?? "",
    tax_liability_account_id: summary?.config.account_ids.tax_liability_account_id ?? "",
  };
}

export function countMissingMappings(summary: QuickBooksConfigSummary | null): number {
  if (!summary) return 7;
  return 7 - Number(summary.config.account_mapping_count ?? 0);
}

export function quickBooksSetupHeadline(summary: QuickBooksConfigSummary | null): string {
  if (!summary) return "QuickBooks integration not configured";
  if (summary.config.ready_for_sync) return "Ready to post journal entries";
  if (!summary.config.core_ready) return "Core OAuth credentials incomplete";
  return "Account mapping still incomplete";
}

export function quickBooksSetupTone(
  summary: QuickBooksConfigSummary | null,
): "healthy" | "warning" | "critical" {
  if (!summary) return "critical";
  if (summary.config.ready_for_sync) return "healthy";
  if (summary.config.core_ready) return "warning";
  return "critical";
}

export function extractQuickBooksCompanyCard(data: Record<string, unknown> | null): {
  companyName: string | null;
  legalName: string | null;
  country: string | null;
  webAddr: string | null;
} {
  const companyInfo = (data?.CompanyInfo as Record<string, unknown> | undefined) ?? {};
  const companyName =
    (typeof companyInfo.CompanyName === "string" && companyInfo.CompanyName) ||
    (typeof companyInfo.LegalName === "string" && companyInfo.LegalName) ||
    null;

  return {
    companyName,
    legalName: typeof companyInfo.LegalName === "string" ? companyInfo.LegalName : null,
    country: typeof companyInfo.Country === "string" ? companyInfo.Country : null,
    webAddr: typeof companyInfo.WebAddr === "string" ? companyInfo.WebAddr : null,
  };
}
