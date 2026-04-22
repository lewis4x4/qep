import { decryptCredential, encryptCredential } from "./integration-crypto.ts";

type AdminDb = unknown;

export type QuickBooksCredentials = {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  realm_id: string;
  environment?: "sandbox" | "production";
  ar_account_id: string;
  service_revenue_account_id: string;
  parts_revenue_account_id: string;
  haul_revenue_account_id: string;
  shop_supplies_account_id: string;
  misc_revenue_account_id: string;
  tax_liability_account_id: string;
};

export type QuickBooksConfigDraft = Partial<QuickBooksCredentials>;

type QuickBooksIntegrationRow = {
  display_name?: string | null;
  status?: string | null;
  last_test_success?: boolean | null;
  last_test_error?: string | null;
  last_sync_error?: string | null;
  updated_at?: string | null;
  credentials_encrypted?: string | null;
};

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

export type QuickBooksInvoiceContext = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  total: number;
  tax: number | null;
  description: string | null;
  service_job_id: string | null;
  crm_company_id: string | null;
  company_name?: string | null;
  line_items: Array<{
    id: string;
    description: string;
    quantity: number;
    unit_price: number;
    line_total: number | null;
  }>;
};

type QuickBooksSyncInvoiceLine = {
  description: string;
  amount: number;
  accountId: string;
  postingType: "Credit" | "Debit";
};

function parseCredentials(raw: string): QuickBooksCredentials {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const required = [
    "client_id",
    "client_secret",
    "refresh_token",
    "realm_id",
    "ar_account_id",
    "service_revenue_account_id",
    "parts_revenue_account_id",
    "haul_revenue_account_id",
    "shop_supplies_account_id",
    "misc_revenue_account_id",
    "tax_liability_account_id",
  ] as const;

  for (const key of required) {
    if (typeof parsed[key] !== "string" || parsed[key]!.trim() === "") {
      throw new Error(`QuickBooks credential missing ${key}`);
    }
  }

  return {
    client_id: String(parsed.client_id),
    client_secret: String(parsed.client_secret),
    refresh_token: String(parsed.refresh_token),
    realm_id: String(parsed.realm_id),
    environment: parsed.environment === "sandbox" ? "sandbox" : "production",
    ar_account_id: String(parsed.ar_account_id),
    service_revenue_account_id: String(parsed.service_revenue_account_id),
    parts_revenue_account_id: String(parsed.parts_revenue_account_id),
    haul_revenue_account_id: String(parsed.haul_revenue_account_id),
    shop_supplies_account_id: String(parsed.shop_supplies_account_id),
    misc_revenue_account_id: String(parsed.misc_revenue_account_id),
    tax_liability_account_id: String(parsed.tax_liability_account_id),
  };
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseDraft(raw: string): QuickBooksConfigDraft {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const environment = parsed.environment === "sandbox" ? "sandbox" : "production";
  return {
    client_id: normalizeOptionalString(parsed.client_id) ?? undefined,
    client_secret: normalizeOptionalString(parsed.client_secret) ?? undefined,
    refresh_token: normalizeOptionalString(parsed.refresh_token) ?? undefined,
    realm_id: normalizeOptionalString(parsed.realm_id) ?? undefined,
    environment,
    ar_account_id: normalizeOptionalString(parsed.ar_account_id) ?? undefined,
    service_revenue_account_id: normalizeOptionalString(parsed.service_revenue_account_id) ?? undefined,
    parts_revenue_account_id: normalizeOptionalString(parsed.parts_revenue_account_id) ?? undefined,
    haul_revenue_account_id: normalizeOptionalString(parsed.haul_revenue_account_id) ?? undefined,
    shop_supplies_account_id: normalizeOptionalString(parsed.shop_supplies_account_id) ?? undefined,
    misc_revenue_account_id: normalizeOptionalString(parsed.misc_revenue_account_id) ?? undefined,
    tax_liability_account_id: normalizeOptionalString(parsed.tax_liability_account_id) ?? undefined,
  };
}

function countTruthy(values: Array<unknown>): number {
  return values.filter((value) => typeof value === "string" ? value.trim().length > 0 : Boolean(value)).length;
}

export function summarizeQuickBooksConfig(
  integration: QuickBooksIntegrationRow | null,
  draft: QuickBooksConfigDraft | null,
): QuickBooksConfigSummary {
  const environment = draft?.environment === "sandbox" ? "sandbox" : "production";
  const clientId = draft?.client_id ?? null;
  const realmId = draft?.realm_id ?? null;
  const hasClientSecret = typeof draft?.client_secret === "string" && draft.client_secret.trim().length > 0;
  const hasRefreshToken = typeof draft?.refresh_token === "string" && draft.refresh_token.trim().length > 0;

  const accountIds = {
    ar_account_id: draft?.ar_account_id ?? null,
    service_revenue_account_id: draft?.service_revenue_account_id ?? null,
    parts_revenue_account_id: draft?.parts_revenue_account_id ?? null,
    haul_revenue_account_id: draft?.haul_revenue_account_id ?? null,
    shop_supplies_account_id: draft?.shop_supplies_account_id ?? null,
    misc_revenue_account_id: draft?.misc_revenue_account_id ?? null,
    tax_liability_account_id: draft?.tax_liability_account_id ?? null,
  };

  const credentialCount = countTruthy([clientId, realmId, hasClientSecret, hasRefreshToken]);
  const accountMappingCount = countTruthy(Object.values(accountIds));
  const coreReady = credentialCount === 4;
  const readyForSync = coreReady && accountMappingCount === 7;

  return {
    integration: {
      display_name: integration?.display_name ?? "QuickBooks Online GL",
      status: integration?.status ?? "pending_credentials",
      last_test_success: integration?.last_test_success ?? null,
      last_test_error: integration?.last_test_error ?? null,
      last_sync_error: integration?.last_sync_error ?? null,
      updated_at: integration?.updated_at ?? null,
    },
    config: {
      client_id: clientId,
      realm_id: realmId,
      environment,
      has_client_secret: hasClientSecret,
      has_refresh_token: hasRefreshToken,
      account_ids: accountIds,
      credential_count: credentialCount,
      account_mapping_count: accountMappingCount,
      core_ready: coreReady,
      ready_for_sync: readyForSync,
    },
  };
}

export async function loadQuickBooksConfigSummary(
  supabaseAdmin: AdminDb,
  workspaceId = "default",
): Promise<QuickBooksConfigSummary> {
  const { data, error } = await (supabaseAdmin as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => {
            maybeSingle: () => Promise<{ data: QuickBooksIntegrationRow | null; error: unknown }>;
          };
        };
      };
    };
  })
    .from("integration_status")
    .select("display_name, status, last_test_success, last_test_error, last_sync_error, updated_at, credentials_encrypted")
    .eq("workspace_id", workspaceId)
    .eq("integration_key", "quickbooks")
    .maybeSingle();

  if (error) {
    throw new Error("QuickBooks integration summary unavailable");
  }

  let draft: QuickBooksConfigDraft | null = null;
  if (data?.credentials_encrypted) {
    const decrypted = await decryptCredential(data.credentials_encrypted, "quickbooks");
    draft = parseDraft(decrypted);
  }

  return summarizeQuickBooksConfig(data, draft);
}

async function loadQuickBooksConfigDraft(
  supabaseAdmin: AdminDb,
  workspaceId = "default",
): Promise<{ integration: QuickBooksIntegrationRow | null; draft: QuickBooksConfigDraft | null }> {
  const { data, error } = await (supabaseAdmin as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => {
            maybeSingle: () => Promise<{ data: QuickBooksIntegrationRow | null; error: unknown }>;
          };
        };
      };
    };
  })
    .from("integration_status")
    .select("display_name, status, last_test_success, last_test_error, last_sync_error, updated_at, credentials_encrypted")
    .eq("workspace_id", workspaceId)
    .eq("integration_key", "quickbooks")
    .maybeSingle();

  if (error) {
    throw new Error("QuickBooks integration summary unavailable");
  }

  if (!data?.credentials_encrypted) {
    return { integration: data, draft: null };
  }

  const decrypted = await decryptCredential(data.credentials_encrypted, "quickbooks");
  return { integration: data, draft: parseDraft(decrypted) };
}

export async function saveQuickBooksConfig(
  supabaseAdmin: AdminDb,
  input: QuickBooksConfigDraft,
  workspaceId = "default",
): Promise<QuickBooksConfigSummary> {
  const { integration, draft: existingDraft } = await loadQuickBooksConfigDraft(supabaseAdmin, workspaceId);
  const summary = summarizeQuickBooksConfig(integration, existingDraft);

  const merged: QuickBooksConfigDraft = {
    client_id: normalizeOptionalString(input.client_id) ?? summary.config.client_id ?? undefined,
    client_secret: normalizeOptionalString(input.client_secret) ?? existingDraft?.client_secret ?? undefined,
    refresh_token: normalizeOptionalString(input.refresh_token) ?? existingDraft?.refresh_token ?? undefined,
    realm_id: normalizeOptionalString(input.realm_id) ?? summary.config.realm_id ?? undefined,
    environment: input.environment === "sandbox" ? "sandbox" : summary.config.environment,
    ar_account_id: normalizeOptionalString(input.ar_account_id) ?? summary.config.account_ids.ar_account_id ?? undefined,
    service_revenue_account_id: normalizeOptionalString(input.service_revenue_account_id) ?? summary.config.account_ids.service_revenue_account_id ?? undefined,
    parts_revenue_account_id: normalizeOptionalString(input.parts_revenue_account_id) ?? summary.config.account_ids.parts_revenue_account_id ?? undefined,
    haul_revenue_account_id: normalizeOptionalString(input.haul_revenue_account_id) ?? summary.config.account_ids.haul_revenue_account_id ?? undefined,
    shop_supplies_account_id: normalizeOptionalString(input.shop_supplies_account_id) ?? summary.config.account_ids.shop_supplies_account_id ?? undefined,
    misc_revenue_account_id: normalizeOptionalString(input.misc_revenue_account_id) ?? summary.config.account_ids.misc_revenue_account_id ?? undefined,
    tax_liability_account_id: normalizeOptionalString(input.tax_liability_account_id) ?? summary.config.account_ids.tax_liability_account_id ?? undefined,
  };

  const nextEncrypted = await encryptCredential(JSON.stringify(merged), "quickbooks");
  const nextStatus = summarizeQuickBooksConfig(summary.integration, merged).config.ready_for_sync
    ? "connected"
    : "pending_credentials";

  const { error } = await (supabaseAdmin as unknown as {
    from: (table: string) => {
      update: (value: Record<string, unknown>) => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => Promise<{ error: unknown }>;
        };
      };
    };
  })
    .from("integration_status")
    .update({
      credentials_encrypted: nextEncrypted,
      status: nextStatus,
      last_test_success: null,
      last_test_error: null,
      last_test_latency_ms: null,
      last_test_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("integration_key", "quickbooks");

  if (error) {
    throw new Error("QuickBooks configuration save failed");
  }

  return await loadQuickBooksConfigSummary(supabaseAdmin, workspaceId);
}

export async function clearQuickBooksConfig(
  supabaseAdmin: AdminDb,
  workspaceId = "default",
): Promise<QuickBooksConfigSummary> {
  const { error } = await (supabaseAdmin as unknown as {
    from: (table: string) => {
      update: (value: Record<string, unknown>) => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => Promise<{ error: unknown }>;
        };
      };
    };
  })
    .from("integration_status")
    .update({
      credentials_encrypted: null,
      status: "pending_credentials",
      last_test_success: null,
      last_test_error: null,
      last_test_latency_ms: null,
      last_test_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("integration_key", "quickbooks");

  if (error) {
    throw new Error("QuickBooks configuration clear failed");
  }

  return await loadQuickBooksConfigSummary(supabaseAdmin, workspaceId);
}

export async function loadQuickBooksCredentials(
  supabaseAdmin: AdminDb,
  workspaceId = "default",
): Promise<QuickBooksCredentials> {
  const { data, error } = await (supabaseAdmin as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => {
            maybeSingle: () => Promise<{ data: { credentials_encrypted?: string | null } | null; error: unknown }>;
          };
        };
      };
    };
  })
    .from("integration_status")
    .select("credentials_encrypted")
    .eq("workspace_id", workspaceId)
    .eq("integration_key", "quickbooks")
    .maybeSingle();

  if (error || !data?.credentials_encrypted) {
    throw new Error("QuickBooks credentials not configured");
  }

  const decrypted = await decryptCredential(data.credentials_encrypted, "quickbooks");
  return parseCredentials(decrypted);
}

export async function refreshQuickBooksAccessToken(
  supabaseAdmin: AdminDb,
  workspaceId = "default",
): Promise<{ accessToken: string; credentials: QuickBooksCredentials }> {
  const credentials = await loadQuickBooksCredentials(supabaseAdmin, workspaceId);
  const tokenEndpoint = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
  const basic = btoa(`${credentials.client_id}:${credentials.client_secret}`);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: credentials.refresh_token,
  });

  const resp = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`QuickBooks token refresh failed: ${text}`);
  }

  const payload = await resp.json() as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!payload.access_token) {
    throw new Error("QuickBooks token response missing access_token");
  }

  if (payload.refresh_token && payload.refresh_token !== credentials.refresh_token) {
    const nextEncrypted = await encryptCredential(
      JSON.stringify({
        ...credentials,
        refresh_token: payload.refresh_token,
      }),
      "quickbooks",
    );

    await (supabaseAdmin as unknown as {
      from: (table: string) => {
        update: (value: Record<string, unknown>) => {
          eq: (column: string, value: string) => {
            eq: (column: string, value: string) => Promise<{ error: unknown }>;
          };
        };
      };
    })
      .from("integration_status")
      .update({
        credentials_encrypted: nextEncrypted,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId)
      .eq("integration_key", "quickbooks");

    credentials.refresh_token = payload.refresh_token;
  }

  return { accessToken: payload.access_token, credentials };
}

function inferRevenueAccount(
  description: string,
  credentials: QuickBooksCredentials,
): string {
  const lower = description.toLowerCase();
  if (lower.includes("labor")) return credentials.service_revenue_account_id;
  if (lower.includes("haul") || lower.includes("transport")) return credentials.haul_revenue_account_id;
  if (lower.includes("shop supplies")) return credentials.shop_supplies_account_id;
  if (lower.includes("service total")) return credentials.service_revenue_account_id;
  if (/^[a-z0-9-]+\s+—/i.test(description) || /^[a-z0-9-]+$/i.test(description.split(" ")[0] ?? "")) {
    return credentials.parts_revenue_account_id;
  }
  return credentials.misc_revenue_account_id;
}

export function buildQuickBooksJournalEntry(
  invoice: QuickBooksInvoiceContext,
  credentials: QuickBooksCredentials,
): Record<string, unknown> {
  const creditLines: QuickBooksSyncInvoiceLine[] = invoice.line_items.map((line) => ({
    description: line.description,
    amount: Number(line.line_total ?? line.quantity * line.unit_price),
    accountId: inferRevenueAccount(line.description, credentials),
    postingType: "Credit",
  }));

  if ((invoice.tax ?? 0) > 0) {
    creditLines.push({
      description: "Sales tax",
      amount: Number(invoice.tax ?? 0),
      accountId: credentials.tax_liability_account_id,
      postingType: "Credit",
    });
  }

  const debitTotal = creditLines.reduce((sum, line) => sum + line.amount, 0);
  const lines = [
    {
      Description: `QEP invoice ${invoice.invoice_number}`,
      Amount: debitTotal,
      DetailType: "JournalEntryLineDetail",
      JournalEntryLineDetail: {
        PostingType: "Debit",
        AccountRef: { value: credentials.ar_account_id },
      },
    },
    ...creditLines.map((line) => ({
      Description: line.description,
      Amount: line.amount,
      DetailType: "JournalEntryLineDetail",
      JournalEntryLineDetail: {
        PostingType: line.postingType,
        AccountRef: { value: line.accountId },
      },
    })),
  ];

  return {
    TxnDate: invoice.invoice_date,
    DocNumber: invoice.invoice_number,
    PrivateNote: `QEP invoice ${invoice.id}${invoice.company_name ? ` · ${invoice.company_name}` : ""}`,
    Line: lines,
  };
}

export async function postQuickBooksJournalEntry(
  supabaseAdmin: AdminDb,
  invoice: QuickBooksInvoiceContext,
  workspaceId = "default",
): Promise<{ txnId: string | null; requestPayload: Record<string, unknown>; responsePayload: Record<string, unknown> }> {
  const { accessToken, credentials } = await refreshQuickBooksAccessToken(supabaseAdmin, workspaceId);
  const baseUrl = credentials.environment === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
  const payload = buildQuickBooksJournalEntry(invoice, credentials);

  const resp = await fetch(
    `${baseUrl}/v3/company/${encodeURIComponent(credentials.realm_id)}/journalentry?requestid=${encodeURIComponent(invoice.id)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  const responsePayload = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`QuickBooks journal entry failed: ${JSON.stringify(responsePayload)}`);
  }

  const txnId = (responsePayload as { JournalEntry?: { Id?: string } }).JournalEntry?.Id ?? null;
  return {
    txnId,
    requestPayload: payload,
    responsePayload: responsePayload as Record<string, unknown>,
  };
}

export async function fetchQuickBooksCompanyInfo(
  supabaseAdmin: AdminDb,
  workspaceId = "default",
): Promise<Record<string, unknown>> {
  const { accessToken, credentials } = await refreshQuickBooksAccessToken(supabaseAdmin, workspaceId);
  const baseUrl = credentials.environment === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
  const resp = await fetch(
    `${baseUrl}/v3/company/${encodeURIComponent(credentials.realm_id)}/companyinfo/${encodeURIComponent(credentials.realm_id)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
  );
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`QuickBooks company info failed: ${JSON.stringify(body)}`);
  }
  return body as Record<string, unknown>;
}
