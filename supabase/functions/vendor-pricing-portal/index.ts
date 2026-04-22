type PortalAction = "session" | "submit";

interface PortalRequest {
  action?: PortalAction;
  accessKey?: string;
  search?: string;
  submittedByName?: string;
  submittedByEmail?: string;
  items?: Array<{
    partNumber?: string;
    description?: string | null;
    proposedListPrice?: number;
    effectiveDate?: string | null;
    submissionNotes?: string | null;
  }>;
}

function corsHeaders(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function jsonResponse(origin: string | null, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin),
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sanitizeAccessKey(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function isFuture(value: string | null): boolean {
  if (!value) return true;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > Date.now();
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const REST_BASE = `${SUPABASE_URL}/rest/v1`;
const ADMIN_HEADERS = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

async function restGet<T>(path: string, query: Record<string, string>): Promise<T> {
  const params = new URLSearchParams(query);
  const response = await fetch(`${REST_BASE}/${path}?${params.toString()}`, {
    headers: ADMIN_HEADERS,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return await response.json() as T;
}

async function restPatch(path: string, query: Record<string, string>, body: unknown): Promise<void> {
  const params = new URLSearchParams(query);
  const response = await fetch(`${REST_BASE}/${path}?${params.toString()}`, {
    method: "PATCH",
    headers: {
      ...ADMIN_HEADERS,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

async function restInsert(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${REST_BASE}/${path}`, {
    method: "POST",
    headers: {
      ...ADMIN_HEADERS,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResponse(origin, 405, { error: "Method not allowed" });
  }

  try {
    const body = (await req.json()) as PortalRequest;
    const action = body.action ?? "session";
    const accessKey = sanitizeAccessKey(body.accessKey);
    if (!accessKey) {
      return jsonResponse(origin, 400, { error: "Access key required" });
    }

    const accessKeyHash = await sha256Hex(accessKey);
    const accessRows = await restGet<Array<{
      id: string;
      workspace_id: string;
      vendor_id: string;
      label: string | null;
      contact_name: string | null;
      contact_email: string | null;
      expires_at: string | null;
      revoked_at: string | null;
      vendor_profiles: { name?: string; supplier_type?: string; notes?: string | null } | Array<{ name?: string; supplier_type?: string; notes?: string | null }> | null;
    }>>("vendor_portal_access_keys", {
      select: "id,workspace_id,vendor_id,label,contact_name,contact_email,expires_at,revoked_at,vendor_profiles(name,supplier_type,notes)",
      access_key_hash: `eq.${accessKeyHash}`,
      limit: "1",
    });

    const accessRow = accessRows[0];
    if (!accessRow || accessRow.revoked_at || !isFuture(accessRow.expires_at)) {
      return jsonResponse(origin, 404, { error: "This vendor pricing link is invalid or expired." });
    }

    await restPatch("vendor_portal_access_keys", { id: `eq.${accessRow.id}` }, {
      last_used_at: new Date().toISOString(),
    });

    if (action === "submit") {
      const items = body.items ?? [];
      if (items.length === 0) {
        return jsonResponse(origin, 400, { error: "At least one price submission item is required." });
      }

      const insertRows = items.map((item) => {
        const partNumber = (item.partNumber ?? "").trim();
        if (!partNumber) throw new Error("Each item needs a part number.");
        if (typeof item.proposedListPrice !== "number" || !Number.isFinite(item.proposedListPrice) || item.proposedListPrice < 0) {
          throw new Error("Each item needs a valid proposed price.");
        }

        return {
          workspace_id: accessRow.workspace_id,
          vendor_id: accessRow.vendor_id,
          access_key_id: accessRow.id,
          part_number: partNumber,
          description: item.description?.trim() || null,
          proposed_list_price: item.proposedListPrice,
          currency: "USD",
          effective_date: item.effectiveDate || new Date().toISOString().slice(0, 10),
          submission_notes: item.submissionNotes?.trim() || null,
          submitted_by_name: body.submittedByName?.trim() || accessRow.contact_name || null,
          submitted_by_email: body.submittedByEmail?.trim() || accessRow.contact_email || null,
        };
      });

      await restInsert("parts_vendor_price_submissions", insertRows);
    }

    const search = (body.search ?? "").trim().toLowerCase();

    const vendorPrices = await restGet<Array<{
      id: string;
      part_number: string;
      description: string | null;
      list_price: number | null;
      currency: string;
      effective_date: string;
    }>>("parts_vendor_prices", {
      select: "id,part_number,description,list_price,currency,effective_date",
      workspace_id: `eq.${accessRow.workspace_id}`,
      vendor_id: `eq.${accessRow.vendor_id}`,
      order: "effective_date.desc",
      limit: "500",
    });

    const latestByPart = new Map<string, typeof vendorPrices[number]>();
    for (const row of vendorPrices) {
      if (!latestByPart.has(row.part_number)) {
        latestByPart.set(row.part_number, row);
      }
    }

    const prices = [...latestByPart.values()]
      .filter((row) => {
        if (!search) return true;
        return row.part_number.toLowerCase().includes(search) || (row.description ?? "").toLowerCase().includes(search);
      })
      .slice(0, 100)
      .map((row) => ({
        id: row.id,
        partNumber: row.part_number,
        description: row.description,
        currentPrice: row.list_price,
        currency: row.currency,
        effectiveDate: row.effective_date,
      }));

    const submissions = await restGet<Array<{
      id: string;
      part_number: string;
      description: string | null;
      proposed_list_price: number;
      currency: string;
      effective_date: string;
      submission_notes: string | null;
      status: string;
      review_notes: string | null;
      created_at: string;
    }>>("parts_vendor_price_submissions", {
      select: "id,part_number,description,proposed_list_price,currency,effective_date,submission_notes,status,review_notes,created_at",
      workspace_id: `eq.${accessRow.workspace_id}`,
      vendor_id: `eq.${accessRow.vendor_id}`,
      order: "created_at.desc",
      limit: "50",
    });

    const vendorJoin = Array.isArray(accessRow.vendor_profiles) ? accessRow.vendor_profiles[0] : accessRow.vendor_profiles;

    return jsonResponse(origin, 200, {
      vendor: {
        id: accessRow.vendor_id,
        name: vendorJoin?.name ?? "Vendor",
        supplierType: vendorJoin?.supplier_type ?? "general",
        notes: vendorJoin?.notes ?? null,
        label: accessRow.label ?? null,
        contactName: accessRow.contact_name ?? null,
        contactEmail: accessRow.contact_email ?? null,
      },
      prices,
      submissions: submissions.map((row) => ({
        id: row.id,
        partNumber: row.part_number,
        description: row.description,
        proposedPrice: row.proposed_list_price,
        currency: row.currency,
        effectiveDate: row.effective_date,
        notes: row.submission_notes,
        status: row.status,
        reviewNotes: row.review_notes,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    console.error("vendor-pricing-portal error:", error);
    return jsonResponse(origin, 500, {
      error: error instanceof Error ? error.message : "Unexpected vendor pricing portal error",
    });
  }
});
