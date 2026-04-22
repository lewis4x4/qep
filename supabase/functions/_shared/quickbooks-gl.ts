import { decryptCredential, encryptCredential } from "./integration-crypto.ts";

type AdminDb = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{ data: { credentials_encrypted?: string | null } | null; error: unknown }>;
      };
      update: (value: Record<string, unknown>) => {
        eq: (column: string, value: string) => Promise<{ error: unknown }>;
      };
    };
  };
};

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
