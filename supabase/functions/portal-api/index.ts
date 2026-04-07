/**
 * Customer Portal API Edge Function
 *
 * Unified API for the customer self-service portal.
 * Routes: /fleet, /service-requests, /parts, /invoices, /quotes
 *
 * Auth: Portal customer (via auth_user_id → portal_customers mapping)
 * OR internal staff with workspace access.
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { parseJsonBody } from "../_shared/parse-json-body.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  buildPmKitLinesFromJobCode,
  deterministicPmReason,
  explainPmKitWithLlm,
  sanitizePortalLineItemsForOrder,
  scoreJobCodeForFleet,
  type CustomerFleetRow,
  type JobCodePmRow,
} from "../_shared/portal-pm-kit.ts";
import { sendResendEmail } from "../_shared/resend-email.ts";

/** Strip angle brackets for safe notification copy (names are still escaped in UI). */
function safePortalDisplayLabel(raw: string): string {
  return raw.replace(/[<>]/g, "").trim().slice(0, 120);
}

const STAFF_NOTIFY_CHUNK = 80;

const STAFF_NOTIFY_ROLES = ["rep", "admin", "manager", "owner"] as const;

const PORTAL_JOB_STAGE_LABELS: Record<string, string> = {
  request_received: "Request received",
  triaging: "Being reviewed",
  diagnosis_selected: "Diagnosis confirmed",
  quote_drafted: "Quote in progress",
  quote_sent: "Quote sent",
  approved: "Approved",
  parts_pending: "Waiting on parts",
  parts_staged: "Parts ready",
  haul_scheduled: "Transport scheduled",
  scheduled: "Appointment scheduled",
  in_progress: "In progress",
  blocked_waiting: "Waiting",
  quality_check: "Quality review",
  ready_for_pickup: "Ready for pickup",
  invoice_ready: "Invoice ready",
  invoiced: "Invoiced",
  paid_closed: "Completed",
};

const PORTAL_REQUEST_STATUS_LABELS: Record<string, string> = {
  submitted: "Request received",
  received: "Request received",
  triaging: "Being reviewed",
  in_review: "Being reviewed",
  scheduled: "Appointment scheduled",
  in_progress: "In progress",
  waiting: "Waiting",
  completed: "Completed",
  cancelled: "Cancelled",
};

interface PortalDealRow {
  id: string;
  name: string;
  amount: number | null;
  expected_close_on: string | null;
  next_follow_up_at: string | null;
  updated_at: string;
  stage_id: string | null;
  primary_contact_id: string | null;
  company_id: string | null;
  closed_at?: string | null;
}

interface PortalDealStageRow {
  id: string;
  name: string;
  is_closed_won: boolean;
  is_closed_lost: boolean;
}

interface PortalQuoteReviewRow {
  id: string;
  deal_id: string | null;
  status: string;
  viewed_at: string | null;
  signed_at: string | null;
  expires_at: string | null;
  updated_at: string;
  signer_name: string | null;
}

interface PortalPaymentIntentRow {
  id: string;
  invoice_id: string | null;
  status: string;
  webhook_signature_verified: boolean;
  created_at: string;
  updated_at: string;
  succeeded_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
}

interface DocumentVisibilityAuditRow {
  document_id: string;
  visibility_after: boolean | null;
  created_at: string;
  reason: string | null;
}

function titleCaseStatus(raw: string | null | undefined): string {
  if (!raw) return "Status unavailable";
  return raw.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizePortalStatus(input: {
  requestStatus?: string | null;
  requestEta?: string | null;
  requestUpdatedAt?: string | null;
  jobStage?: string | null;
  jobEta?: string | null;
  jobUpdatedAt?: string | null;
  idleUpdatedAt?: string | null;
}): {
  label: string;
  source: "service_job" | "portal_request" | "default";
  source_label: string;
  eta: string | null;
  last_updated_at: string | null;
} {
  if (input.jobStage) {
    return {
      label: PORTAL_JOB_STAGE_LABELS[input.jobStage] ?? titleCaseStatus(input.jobStage),
      source: "service_job",
      source_label: "Live shop status",
      eta: input.jobEta ?? input.requestEta ?? null,
      last_updated_at: input.jobUpdatedAt ?? input.requestUpdatedAt ?? null,
    };
  }

  if (input.requestStatus) {
    return {
      label: PORTAL_REQUEST_STATUS_LABELS[input.requestStatus] ?? titleCaseStatus(input.requestStatus),
      source: "portal_request",
      source_label: "Portal request",
      eta: input.requestEta ?? null,
      last_updated_at: input.requestUpdatedAt ?? null,
    };
  }

  return {
    label: "Operational",
    source: "default",
    source_label: "Equipment status",
    eta: null,
    last_updated_at: input.idleUpdatedAt ?? null,
  };
}

function normalizePortalDealStatus(input: {
  dealStageName?: string | null;
  isClosedWon?: boolean;
  isClosedLost?: boolean;
  expectedCloseOn?: string | null;
  nextFollowUpAt?: string | null;
  dealUpdatedAt?: string | null;
  quoteStatus?: string | null;
  quoteViewedAt?: string | null;
  quoteSignedAt?: string | null;
  quoteExpiresAt?: string | null;
  quoteUpdatedAt?: string | null;
}): {
  label: string;
  source: "quote_review" | "deal_progress";
  source_label: string;
  eta: string | null;
  last_updated_at: string | null;
  next_action: string | null;
} {
  const quoteStatus = input.quoteStatus?.trim().toLowerCase() ?? "";
  const dealStageName = input.dealStageName?.trim().toLowerCase() ?? "";

  if (quoteStatus === "accepted") {
    return {
      label: "Quote accepted",
      source: "quote_review",
      source_label: "Your quote response",
      eta: input.expectedCloseOn ?? null,
      last_updated_at: input.quoteSignedAt ?? input.quoteUpdatedAt ?? input.dealUpdatedAt ?? null,
      next_action: "We’re finalizing the paperwork and next dealership steps.",
    };
  }

  if (quoteStatus === "rejected") {
    return {
      label: "Quote declined",
      source: "quote_review",
      source_label: "Your quote response",
      eta: null,
      last_updated_at: input.quoteUpdatedAt ?? input.dealUpdatedAt ?? null,
      next_action: "Contact the dealership if you want a revised option or updated quote.",
    };
  }

  if (quoteStatus === "countered") {
    return {
      label: "Changes requested",
      source: "quote_review",
      source_label: "Your quote response",
      eta: input.quoteExpiresAt ?? input.expectedCloseOn ?? null,
      last_updated_at: input.quoteUpdatedAt ?? input.dealUpdatedAt ?? null,
      next_action: "We’re reviewing your requested changes.",
    };
  }

  if (quoteStatus === "viewed") {
    return {
      label: "Quote reviewed",
      source: "quote_review",
      source_label: "Your quote response",
      eta: input.quoteExpiresAt ?? input.expectedCloseOn ?? null,
      last_updated_at: input.quoteViewedAt ?? input.quoteUpdatedAt ?? input.dealUpdatedAt ?? null,
      next_action: "Review the quote details and sign when you're ready.",
    };
  }

  if (quoteStatus === "sent") {
    return {
      label: "Quote ready for review",
      source: "quote_review",
      source_label: "Quote review",
      eta: input.quoteExpiresAt ?? input.expectedCloseOn ?? null,
      last_updated_at: input.quoteUpdatedAt ?? input.dealUpdatedAt ?? null,
      next_action: "Open the quote to review pricing and next steps.",
    };
  }

  if (input.isClosedWon) {
    return {
      label: "Deal confirmed",
      source: "deal_progress",
      source_label: "Deal progress",
      eta: null,
      last_updated_at: input.dealUpdatedAt ?? null,
      next_action: "Your dealership team is handling the final delivery or paperwork steps.",
    };
  }

  if (input.isClosedLost) {
    return {
      label: "Opportunity closed",
      source: "deal_progress",
      source_label: "Deal progress",
      eta: null,
      last_updated_at: input.dealUpdatedAt ?? null,
      next_action: "Reach back out if you want to reopen this opportunity.",
    };
  }

  if (dealStageName.includes("demo")) {
    return {
      label: "Demo scheduled",
      source: "deal_progress",
      source_label: "Deal progress",
      eta: input.expectedCloseOn ?? input.nextFollowUpAt ?? null,
      last_updated_at: input.dealUpdatedAt ?? null,
      next_action: "We’ll confirm your demo timing and any prep details.",
    };
  }

  if (dealStageName.includes("quote")) {
    return {
      label: "Quote in progress",
      source: "deal_progress",
      source_label: "Deal progress",
      eta: input.expectedCloseOn ?? input.nextFollowUpAt ?? null,
      last_updated_at: input.dealUpdatedAt ?? null,
      next_action: "Your dealership team is preparing the quote details.",
    };
  }

  if (dealStageName.includes("negotiat")) {
    return {
      label: "Finalizing options",
      source: "deal_progress",
      source_label: "Deal progress",
      eta: input.expectedCloseOn ?? input.nextFollowUpAt ?? null,
      last_updated_at: input.dealUpdatedAt ?? null,
      next_action: "We’re working through final options and pricing.",
    };
  }

  if (input.nextFollowUpAt) {
    return {
      label: "In progress with dealership",
      source: "deal_progress",
      source_label: "Deal progress",
      eta: input.nextFollowUpAt,
      last_updated_at: input.dealUpdatedAt ?? null,
      next_action: "Expect the next dealership update on the scheduled follow-up.",
    };
  }

  return {
    label: "In progress with dealership",
    source: "deal_progress",
    source_label: "Deal progress",
    eta: input.expectedCloseOn ?? null,
    last_updated_at: input.dealUpdatedAt ?? null,
    next_action: "Your dealership team is actively working this opportunity.",
  };
}

function normalizePortalPaymentStatus(intent: PortalPaymentIntentRow | null): {
  label: string;
  tone: "blue" | "amber" | "emerald" | "red";
  detail: string;
  last_updated_at: string | null;
} | null {
  if (!intent) return null;

  if (intent.status === "succeeded" && intent.webhook_signature_verified) {
    return {
      label: "Payment verified",
      tone: "emerald",
      detail: "Your payment was received and verified by the dealership payment workflow.",
      last_updated_at: intent.succeeded_at ?? intent.updated_at,
    };
  }

  if (intent.status === "failed") {
    return {
      label: "Payment failed",
      tone: "red",
      detail: intent.failure_reason?.trim() || "The payment attempt did not complete. Try again or contact the dealership.",
      last_updated_at: intent.failed_at ?? intent.updated_at,
    };
  }

  if (intent.status === "processing") {
    return {
      label: "Payment processing",
      tone: "blue",
      detail: "Your payment is still processing with the checkout provider.",
      last_updated_at: intent.updated_at,
    };
  }

  return {
    label: "Checkout started",
    tone: "amber",
    detail: "A payment session was created, but the dealership has not received a verified success event yet.",
    last_updated_at: intent.updated_at ?? intent.created_at,
  };
}

function normalizePortalDocumentVisibility(input: {
  createdAt: string;
  latestAudit: DocumentVisibilityAuditRow | null;
}): {
  label: string;
  detail: string;
  released_at: string;
} {
  const releaseAt = input.latestAudit?.created_at ?? input.createdAt;
  const reason = input.latestAudit?.reason?.trim() || "Shared by your dealership team for portal access.";

  return {
    label: "Visible in customer portal",
    detail: reason,
    released_at: releaseAt,
  };
}

/** Internal users in profile_workspaces for this tenant + eligible roles (no cross-workspace blast). */
async function workspaceStaffRecipientIds(
  admin: SupabaseClient,
  portalWorkspaceId: string,
): Promise<string[]> {
  const { data: pwRows, error: pwErr } = await admin
    .from("profile_workspaces")
    .select("profile_id")
    .eq("workspace_id", portalWorkspaceId);
  if (pwErr) {
    console.warn("portal-api profile_workspaces:", pwErr);
    return [];
  }
  const profileIds = [
    ...new Set(((pwRows ?? []) as { profile_id: string }[]).map((r) => r.profile_id)),
  ];
  if (profileIds.length === 0) {
    console.warn("portal-api: no profile_workspaces for workspace", portalWorkspaceId);
    return [];
  }
  const out: string[] = [];
  for (let i = 0; i < profileIds.length; i += STAFF_NOTIFY_CHUNK) {
    const chunk = profileIds.slice(i, i + STAFF_NOTIFY_CHUNK);
    const { data: rec } = await admin
      .from("profiles")
      .select("id")
      .in("id", chunk)
      .in("role", [...STAFF_NOTIFY_ROLES]);
    for (const r of (rec as { id: string }[] | null) ?? []) {
      out.push(r.id);
    }
  }
  return [...new Set(out)];
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnon) {
      return safeJsonError("Service misconfigured", 503, origin);
    }

    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const supabase = createClient(
      supabaseUrl,
      supabaseAnon,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    // Verify caller is a portal customer (not internal staff using wrong API)
    const { data: portalCustomer } = await supabase
      .from("portal_customers")
      .select("id, is_active, workspace_id, crm_company_id, crm_contact_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (!portalCustomer) {
      return safeJsonError("Not a portal customer. Use internal QRM API.", 403, origin);
    }
    if (!portalCustomer.is_active) {
      return safeJsonError("Portal account is deactivated.", 403, origin);
    }

    const portalWorkspaceId = portalCustomer.workspace_id as string;

    const url = new URL(req.url);
    const rawPath = url.pathname.replace(/^\/functions\/v1\/portal-api\/?/, "");
    const pathParts = rawPath.split("/").filter(Boolean);
    const route = pathParts[0] ?? "";
    const subRoute = pathParts[1] ?? "";

    // ── /fleet — Customer equipment fleet ──────────────────────────────
    if (route === "fleet") {
      if (req.method === "GET") {
        const { data, error } = await supabase
          .from("customer_fleet")
          .select("*, maintenance_schedules(*)")
          .order("created_at", { ascending: false });

        if (error) return safeJsonError("Failed to load fleet", 500, origin);
        return safeJsonOk({ fleet: data }, origin);
      }
    }

    // ── /service-requests — Service request CRUD ───────────────────────
    if (route === "service-requests") {
      // GET /service-requests/:id/timeline — customer-safe shop timeline (P1-D)
      if (
        req.method === "GET" &&
        pathParts.length >= 3 &&
        pathParts[2] === "timeline"
      ) {
        const requestId = pathParts[1]?.trim() ?? "";
        if (!requestId || !/^[0-9a-f-]{36}$/i.test(requestId)) {
          return safeJsonError("Invalid service request id", 400, origin);
        }
        const { data, error } = await supabase.rpc("portal_get_service_job_timeline", {
          p_service_request_id: requestId,
        });
        if (error) {
          console.error("portal_get_service_job_timeline:", error);
          return safeJsonError("Failed to load timeline", 500, origin);
        }
        const payload = data as { ok?: boolean; error?: string } | null;
        if (payload && payload.ok === false && payload.error === "not_found") {
          return safeJsonError("Request not found", 404, origin);
        }
        if (payload && payload.ok === false && payload.error === "not_portal_user") {
          return safeJsonError("Not allowed", 403, origin);
        }
        return safeJsonOk(data ?? {}, origin);
      }

      if (req.method === "GET") {
        const { data, error } = await supabase
          .from("service_requests")
          .select(`
            *,
            internal_job:service_jobs (
              id,
              current_stage,
              priority,
              updated_at,
              closed_at,
              scheduled_end_at
            )
          `)
          .order("created_at", { ascending: false });

        if (error) return safeJsonError("Failed to load requests", 500, origin);
        const requests = ((data ?? []) as Array<Record<string, unknown>>).map((request) => {
          const internalJobRaw = request.internal_job;
          const internalJob = Array.isArray(internalJobRaw)
            ? (internalJobRaw[0] as Record<string, unknown> | undefined)
            : (internalJobRaw as Record<string, unknown> | null);

          const portalStatus = normalizePortalStatus({
            requestStatus: typeof request.status === "string" ? request.status : null,
            requestEta: typeof request.estimated_completion === "string" ? request.estimated_completion : null,
            requestUpdatedAt: typeof request.updated_at === "string" ? request.updated_at : null,
            jobStage: typeof internalJob?.current_stage === "string" ? internalJob.current_stage : null,
            jobEta: typeof internalJob?.scheduled_end_at === "string" ? internalJob.scheduled_end_at : null,
            jobUpdatedAt: typeof internalJob?.updated_at === "string" ? internalJob.updated_at : null,
          });

          return {
            ...request,
            portal_status: portalStatus,
          };
        });

        return safeJsonOk({ requests }, origin);
      }

      if (req.method === "POST") {
        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as Record<string, unknown>;
        if (!body.request_type || !body.description) {
          return safeJsonError("request_type and description required", 400, origin);
        }

        const validTypes = ["repair", "maintenance", "warranty", "parts", "inspection", "emergency"];
        if (!validTypes.includes(String(body.request_type))) {
          return safeJsonError(`request_type must be one of: ${validTypes.join(", ")}`, 400, origin);
        }

        const validUrgencies = ["low", "normal", "high", "emergency"];
        if (body.urgency && !validUrgencies.includes(String(body.urgency))) {
          return safeJsonError(`urgency must be one of: ${validUrgencies.join(", ")}`, 400, origin);
        }

        // Whitelist safe fields — block billing/status manipulation
        const safeBody = {
          workspace_id: portalWorkspaceId,
          portal_customer_id: portalCustomer.id,
          fleet_id: body.fleet_id ?? null,
          request_type: body.request_type,
          description: body.description,
          urgency: (body.urgency as string) || "normal",
          photos: Array.isArray(body.photos) ? body.photos : [],
          preferred_date: body.preferred_date ?? null,
          preferred_branch: body.preferred_branch ?? null,
        };

        const { data, error } = await supabase
          .from("service_requests")
          .insert(safeBody)
          .select()
          .single();

        if (error) return safeJsonError("Failed to create request", 500, origin);
        return safeJsonOk({ request: data }, origin, 201);
      }
    }

    // ── /parts — Parts orders ──────────────────────────────────────────
    if (route === "parts") {
      // POST /parts/suggest-pm-kit — AI-assisted PM kit from job_codes + optional LLM narrative
      if (subRoute === "suggest-pm-kit" && req.method === "POST") {
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!serviceKey) {
          return safeJsonError("PM kit suggestions are not configured on this environment.", 503, origin);
        }

        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as Record<string, unknown>;
        const fleetId = typeof body.fleet_id === "string" ? body.fleet_id.trim() : "";
        if (!fleetId) {
          return safeJsonError("fleet_id is required", 400, origin);
        }

        const admin = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: fleetRow, error: fleetErr } = await admin
          .from("customer_fleet")
          .select(
            "id, make, model, serial_number, current_hours, next_service_due, service_interval_hours, workspace_id, portal_customer_id",
          )
          .eq("id", fleetId)
          .eq("portal_customer_id", portalCustomer.id)
          .eq("workspace_id", portalWorkspaceId)
          .maybeSingle();

        if (fleetErr || !fleetRow) {
          return safeJsonError("Fleet machine not found for this account.", 404, origin);
        }

        const fleet = fleetRow as CustomerFleetRow;
        const makeTrim = fleet.make?.trim() ?? "";
        if (!makeTrim) {
          return safeJsonError("Fleet record is missing equipment make.", 400, origin);
        }

        let { data: jobCodes } = await admin
          .from("job_codes")
          .select("id, job_name, make, model_family, parts_template, common_add_ons, confidence_score")
          .eq("workspace_id", portalWorkspaceId)
          .eq("make", makeTrim)
          .order("confidence_score", { ascending: false })
          .limit(25);

        if (!jobCodes?.length) {
          const { data: fuzzy } = await admin
            .from("job_codes")
            .select("id, job_name, make, model_family, parts_template, common_add_ons, confidence_score")
            .eq("workspace_id", portalWorkspaceId)
            .ilike("make", `%${makeTrim}%`)
            .order("confidence_score", { ascending: false })
            .limit(25);
          jobCodes = fuzzy ?? [];
        }

        const codes = (jobCodes ?? []) as JobCodePmRow[];
        if (codes.length === 0) {
          return safeJsonOk({
            ok: false,
            error: "no_job_code_match",
            message:
              "No dealership PM template is on file for this equipment make yet. Enter part numbers manually or contact parts.",
          }, origin);
        }

        const sorted = [...codes].sort(
          (a, b) => scoreJobCodeForFleet(b, fleet) - scoreJobCodeForFleet(a, fleet),
        );
        const chosen = sorted[0];
        const lineItems = buildPmKitLinesFromJobCode(chosen);
        if (lineItems.length === 0) {
          return safeJsonOk({
            ok: false,
            error: "empty_template",
            message:
              "A job code matched your machine but its PM parts list is empty. Add lines manually or ask your dealer to publish templates.",
            matched_job_code: {
              id: chosen.id,
              job_name: chosen.job_name,
              make: chosen.make,
              model_family: chosen.model_family,
            },
          }, origin);
        }

        const apiKey = Deno.env.get("OPENAI_API_KEY");
        const fallbackReason = deterministicPmReason(fleet, chosen, lineItems.length);
        const aiReason = (await explainPmKitWithLlm(apiKey, fleet, chosen, lineItems)) ?? fallbackReason;

        return safeJsonOk({
          ok: true,
          ai_suggested_pm_kit: true,
          ai_suggestion_reason: aiReason,
          line_items: lineItems.map((l) => ({
            part_number: l.part_number,
            quantity: l.quantity,
            description: l.description,
            unit_price: l.unit_price,
            is_ai_suggested: true,
          })),
          matched_job_code: {
            id: chosen.id,
            job_name: chosen.job_name,
            make: chosen.make,
            model_family: chosen.model_family,
          },
        }, origin);
      }

      // POST /parts/submit — draft → submitted (validated here; RLS blocks naive status bumps)
      if (subRoute === "submit" && req.method === "POST") {
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!serviceKey) {
          return safeJsonError("Order submission is not configured on this environment.", 503, origin);
        }
        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as Record<string, unknown>;
        const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
        if (!orderId) {
          return safeJsonError("order_id is required", 400, origin);
        }

        const admin = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: row, error: fetchErr } = await admin
          .from("parts_orders")
          .select("id, portal_customer_id, status, workspace_id")
          .eq("id", orderId)
          .maybeSingle();

        if (fetchErr || !row) {
          return safeJsonError("Order not found.", 404, origin);
        }
        if (row.portal_customer_id !== portalCustomer.id || row.workspace_id !== portalWorkspaceId) {
          return safeJsonError("Order not found.", 404, origin);
        }
        if (row.status !== "draft") {
          return safeJsonError("Only draft orders can be submitted to the dealership.", 400, origin);
        }

        const { data: run, error: runErr } = await admin
          .from("parts_fulfillment_runs")
          .insert({ workspace_id: portalWorkspaceId, status: "submitted" })
          .select("id")
          .single();

        if (runErr || !run?.id) {
          console.error("portal-api parts fulfillment run:", runErr);
          return safeJsonError("Failed to submit order", 500, origin);
        }

        const { data: updated, error: upErr } = await admin
          .from("parts_orders")
          .update({ status: "submitted", fulfillment_run_id: run.id })
          .eq("id", orderId)
          .select()
          .single();

        if (upErr) {
          console.error("portal-api parts submit:", upErr);
          return safeJsonError("Failed to submit order", 500, origin);
        }

        const { error: evErr } = await admin.from("parts_fulfillment_events").insert({
          workspace_id: portalWorkspaceId,
          fulfillment_run_id: run.id,
          event_type: "portal_submitted",
          payload: { parts_order_id: orderId, audit_channel: "portal" },
        });
        if (evErr) {
          console.warn("portal-api fulfillment event:", evErr);
        }

        const shortRef = orderId.replace(/-/g, "").slice(0, 8).toUpperCase();

        try {
          const { data: pc } = await admin
            .from("portal_customers")
            .select("email, notification_preferences, first_name, last_name")
            .eq("id", portalCustomer.id)
            .maybeSingle();
          const custLabel = safePortalDisplayLabel(
            [pc?.first_name, pc?.last_name].filter(Boolean).join(" ").trim() || "Portal customer",
          );

          const prefs = pc?.notification_preferences as { email?: boolean } | undefined;
          const em = typeof pc?.email === "string" ? pc.email.trim() : "";
          if (prefs?.email !== false && em.includes("@")) {
            await sendResendEmail({
              to: em,
              subject: `QEP — Parts order submitted (${shortRef})`,
              text:
                `Your parts order request was submitted to the dealership.\n\n` +
                `Reference: ${shortRef}\n\n` +
                `We will confirm availability and contact you if anything changes.\n\n` +
                `— Quality Equipment & Parts`,
            });
          }

          const recipientIds = await workspaceStaffRecipientIds(admin, portalWorkspaceId);
          const rows = recipientIds.map((uid) => ({
            workspace_id: portalWorkspaceId,
            user_id: uid,
            kind: "service_portal_parts_submitted",
            title: "Portal parts order submitted",
            body:
              `${custLabel} submitted a parts order (${shortRef}). Open Service → Portal orders to process.`,
            metadata: {
              parts_order_id: orderId,
              fulfillment_run_id: run.id,
              notification_type: "portal_parts_submitted",
            },
          }));
          for (let i = 0; i < rows.length; i += STAFF_NOTIFY_CHUNK) {
            const slice = rows.slice(i, i + STAFF_NOTIFY_CHUNK);
            const { error: niErr } = await admin.from("crm_in_app_notifications").insert(slice);
            if (niErr) {
              console.warn("portal-api staff in-app notify:", niErr);
              break;
            }
          }
        } catch (e) {
          console.warn("portal-api submit notify:", e);
        }

        return safeJsonOk({ order: updated }, origin);
      }

      if (req.method === "GET") {
        const { data, error } = await supabase
          .from("parts_orders")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) return safeJsonError("Failed to load orders", 500, origin);
        return safeJsonOk({ orders: data }, origin);
      }

      if (req.method === "POST") {
        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as Record<string, unknown>;

        const line_items = sanitizePortalLineItemsForOrder(body.line_items);
        if (line_items.length === 0) {
          return safeJsonError("line_items array is required with at least one valid item", 400, origin);
        }

        const aiReason =
          typeof body.ai_suggestion_reason === "string"
            ? body.ai_suggestion_reason.trim().slice(0, 2000)
            : null;

        // Whitelist safe fields — totals computed server-side, not customer-provided
        const safeBody: Record<string, unknown> = {
          workspace_id: portalWorkspaceId,
          portal_customer_id: portalCustomer.id,
          fleet_id: body.fleet_id || null,
          status: "draft", // Always start as draft
          line_items,
          shipping_address: body.shipping_address || null,
        };

        if (body.ai_suggested_pm_kit === true) {
          safeBody.ai_suggested_pm_kit = true;
          safeBody.ai_suggestion_reason = aiReason;
        }

        const { data, error } = await supabase
          .from("parts_orders")
          .insert(safeBody)
          .select()
          .single();

        if (error) return safeJsonError("Failed to create order", 500, origin);
        return safeJsonOk({ order: data }, origin, 201);
      }
    }

    // ── /invoices — Payment portal ─────────────────────────────────────
    if (route === "invoices") {
      if (req.method === "GET" && !subRoute) {
        const { data, error } = await supabase
          .from("customer_invoices")
          .select("*, customer_invoice_line_items(*)")
          .order("invoice_date", { ascending: false });

        if (error) return safeJsonError("Failed to load invoices", 500, origin);

        const invoiceRows = (data ?? []) as Array<Record<string, unknown>>;
        const invoiceIds = invoiceRows
          .map((row) => typeof row.id === "string" ? row.id : null)
          .filter((value): value is string => Boolean(value));

        let intentsByInvoice = new Map<string, PortalPaymentIntentRow>();
        const crmCompanyId = typeof portalCustomer.crm_company_id === "string" ? portalCustomer.crm_company_id : null;
        if (invoiceIds.length > 0 && crmCompanyId) {
          const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: intentRows } = await admin
            .from("portal_payment_intents")
            .select("id, invoice_id, status, webhook_signature_verified, created_at, updated_at, succeeded_at, failed_at, failure_reason")
            .eq("company_id", crmCompanyId)
            .in("invoice_id", invoiceIds)
            .order("created_at", { ascending: false });

          for (const row of ((intentRows ?? []) as PortalPaymentIntentRow[])) {
            if (row.invoice_id && !intentsByInvoice.has(row.invoice_id)) {
              intentsByInvoice.set(row.invoice_id, row);
            }
          }
        }

        const invoices = invoiceRows.map((invoice) => {
          const invoiceId = typeof invoice.id === "string" ? invoice.id : null;
          const latestIntent = invoiceId ? intentsByInvoice.get(invoiceId) ?? null : null;
          return {
            ...invoice,
            portal_payment_status: normalizePortalPaymentStatus(latestIntent),
          };
        });

        return safeJsonOk({ invoices }, origin);
      }

      if (req.method === "POST" && subRoute === "pay") {
        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as {
          invoice_id?: string;
          amount?: number;
          payment_method?: string;
          payment_reference?: string;
        };
        if (!body.invoice_id || body.amount == null) {
          return safeJsonError("invoice_id and amount required", 400, origin);
        }
        const amt = Number(body.amount);
        if (!Number.isFinite(amt) || amt <= 0) {
          return safeJsonError("amount must be a positive number", 400, origin);
        }

        const { data: rpcResult, error: rpcErr } = await supabase.rpc(
          "portal_record_invoice_payment",
          {
            p_invoice_id: body.invoice_id,
            p_amount: amt,
            p_payment_method: body.payment_method ?? null,
            p_payment_reference: body.payment_reference ?? null,
          },
        );
        if (rpcErr) return safeJsonError(rpcErr.message, 400, origin);
        const res = rpcResult as { ok?: boolean; error?: string };
        if (!res?.ok) {
          return safeJsonError(res?.error ?? "payment_failed", 400, origin);
        }
        return safeJsonOk({ ok: true, result: rpcResult }, origin);
      }
    }

    // ── /quotes — Quote review + e-signature ───────────────────────────
    if (route === "quotes") {
      if (req.method === "GET") {
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!serviceKey) {
          return safeJsonError("Quote review is not configured on this environment.", 503, origin);
        }

        const admin = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data, error } = await admin
          .from("portal_quote_reviews")
          .select("*")
          .eq("portal_customer_id", portalCustomer.id)
          .order("created_at", { ascending: false });

        if (error) return safeJsonError("Failed to load quotes", 500, origin);

        const quoteRows = (data ?? []) as PortalQuoteReviewRow[];
        const dealIds = [...new Set(quoteRows.map((row) => row.deal_id).filter((value): value is string => Boolean(value)))];

        let dealsById = new Map<string, PortalDealRow>();
        let stagesById = new Map<string, PortalDealStageRow>();
        if (dealIds.length > 0) {
          const { data: dealRows } = await admin
            .from("crm_deals")
            .select("id, name, amount, expected_close_on, next_follow_up_at, updated_at, stage_id, primary_contact_id, company_id, closed_at")
            .in("id", dealIds)
            .is("deleted_at", null);

          const deals = (dealRows ?? []) as PortalDealRow[];
          dealsById = new Map(deals.map((deal) => [deal.id, deal]));

          const stageIds = [...new Set(deals.map((deal) => deal.stage_id).filter((value): value is string => Boolean(value)))];
          if (stageIds.length > 0) {
            const { data: stageRows } = await admin
              .from("crm_deal_stages")
              .select("id, name, is_closed_won, is_closed_lost")
              .in("id", stageIds);
            const stages = (stageRows ?? []) as PortalDealStageRow[];
            stagesById = new Map(stages.map((stage) => [stage.id, stage]));
          }
        }

        const quotes = quoteRows.map((quote) => {
          const deal = quote.deal_id ? dealsById.get(quote.deal_id) ?? null : null;
          const stage = deal?.stage_id ? stagesById.get(deal.stage_id) ?? null : null;
          const portalStatus = normalizePortalDealStatus({
            dealStageName: stage?.name ?? null,
            isClosedWon: stage?.is_closed_won ?? false,
            isClosedLost: stage?.is_closed_lost ?? false,
            expectedCloseOn: deal?.expected_close_on ?? null,
            nextFollowUpAt: deal?.next_follow_up_at ?? null,
            dealUpdatedAt: deal?.updated_at ?? null,
            quoteStatus: quote.status,
            quoteViewedAt: quote.viewed_at,
            quoteSignedAt: quote.signed_at,
            quoteExpiresAt: quote.expires_at,
            quoteUpdatedAt: quote.updated_at,
          });

          return {
            ...quote,
            deal_name: deal?.name ?? null,
            amount: deal?.amount ?? null,
            portal_status: portalStatus,
          };
        });

        return safeJsonOk({ quotes }, origin);
      }

      if (req.method === "PUT") {
        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as Record<string, unknown>;
        if (!body.id) return safeJsonError("id required", 400, origin);

        const validStatuses = ["viewed", "accepted", "rejected", "countered"];
        if (body.status && !validStatuses.includes(String(body.status))) {
          return safeJsonError(`status must be one of: ${validStatuses.join(", ")}`, 400, origin);
        }

        // Build safe update — customers cannot set signature fields directly
        const safeUpdates: Record<string, unknown> = {};

        if (body.status === "viewed") {
          safeUpdates.status = "viewed";
          safeUpdates.viewed_at = new Date().toISOString();
        } else if (body.status === "accepted") {
          if (!body.signer_name || typeof body.signer_name !== "string") {
            return safeJsonError("signer_name required when accepting", 400, origin);
          }
          // Sanitize: strip HTML tags, limit length
          const cleanName = body.signer_name.replace(/<[^>]*>/g, "").trim().substring(0, 100);
          if (!cleanName) {
            return safeJsonError("signer_name cannot be empty", 400, origin);
          }
          safeUpdates.status = "accepted";
          safeUpdates.signer_name = cleanName;
          safeUpdates.signed_at = new Date().toISOString();
          if (body.signature_png_base64 && typeof body.signature_png_base64 === "string") {
            const raw = String(body.signature_png_base64).replace(/\s/g, "");
            if (raw.length > 400_000) {
              return safeJsonError("signature image too large", 400, origin);
            }
            if (!/^[A-Za-z0-9+/=]+$/.test(raw)) {
              return safeJsonError("signature must be base64 PNG", 400, origin);
            }
            safeUpdates.signature_url = `data:image/png;base64,${raw}`;
          }
          // Use Cloudflare's trusted header, fallback chain for non-CF environments
          safeUpdates.signer_ip = req.headers.get("cf-connecting-ip")
            || req.headers.get("x-real-ip")
            || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || "unknown";
          // signature_url would be set by a separate upload flow
        } else if (body.status === "rejected") {
          safeUpdates.status = "rejected";
        } else if (body.status === "countered") {
          safeUpdates.status = "countered";
          safeUpdates.counter_notes = body.counter_notes || null;
        }

        if (Object.keys(safeUpdates).length === 0) {
          return safeJsonError("No valid fields to update", 400, origin);
        }

        const { data, error } = await supabase
          .from("portal_quote_reviews")
          .update(safeUpdates)
          .eq("id", body.id)
          .select()
          .single();

        if (error) return safeJsonError("Failed to update quote", 500, origin);
        return safeJsonOk({ quote: data }, origin);
      }
    }

    // ── /deals/active — Active portal commercial work ────────────────
    if (route === "deals" && subRoute === "active" && req.method === "GET") {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceKey) {
        return safeJsonError("Active deals are not configured on this environment.", 503, origin);
      }

      const admin = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const crmCompanyId = typeof portalCustomer.crm_company_id === "string" ? portalCustomer.crm_company_id : null;
      const crmContactId = typeof portalCustomer.crm_contact_id === "string" ? portalCustomer.crm_contact_id : null;

      if (!crmCompanyId && !crmContactId) {
        return safeJsonOk({ deals: [] }, origin);
      }

      let dealQuery = admin
        .from("crm_deals")
        .select("id, name, amount, expected_close_on, next_follow_up_at, updated_at, stage_id, primary_contact_id, company_id, closed_at")
        .is("deleted_at", null);

      if (crmCompanyId && crmContactId) {
        dealQuery = dealQuery.or(`company_id.eq.${crmCompanyId},primary_contact_id.eq.${crmContactId}`);
      } else if (crmCompanyId) {
        dealQuery = dealQuery.eq("company_id", crmCompanyId);
      } else if (crmContactId) {
        dealQuery = dealQuery.eq("primary_contact_id", crmContactId);
      }

      const { data: dealRows, error: dealError } = await dealQuery.order("updated_at", { ascending: false }).limit(30);
      if (dealError) return safeJsonError("Failed to load active deals", 500, origin);

      const deals = (dealRows ?? []) as PortalDealRow[];
      if (deals.length === 0) {
        return safeJsonOk({ deals: [] }, origin);
      }

      const stageIds = [...new Set(deals.map((deal) => deal.stage_id).filter((value): value is string => Boolean(value)))];
      const { data: stageRows } = stageIds.length > 0
        ? await admin.from("crm_deal_stages").select("id, name, is_closed_won, is_closed_lost").in("id", stageIds)
        : { data: [] as PortalDealStageRow[] };
      const stagesById = new Map(((stageRows ?? []) as PortalDealStageRow[]).map((stage) => [stage.id, stage]));

      const dealIds = deals.map((deal) => deal.id);
      const { data: quoteRows } = await admin
        .from("portal_quote_reviews")
        .select("id, deal_id, status, viewed_at, signed_at, expires_at, updated_at, signer_name")
        .eq("portal_customer_id", portalCustomer.id)
        .in("deal_id", dealIds)
        .order("updated_at", { ascending: false });
      const latestQuoteByDeal = new Map<string, PortalQuoteReviewRow>();
      for (const row of ((quoteRows ?? []) as PortalQuoteReviewRow[])) {
        if (row.deal_id && !latestQuoteByDeal.has(row.deal_id)) {
          latestQuoteByDeal.set(row.deal_id, row);
        }
      }

      const activeDeals = deals
        .map((deal) => {
          const stage = deal.stage_id ? stagesById.get(deal.stage_id) ?? null : null;
          const quote = latestQuoteByDeal.get(deal.id) ?? null;
          const portalStatus = normalizePortalDealStatus({
            dealStageName: stage?.name ?? null,
            isClosedWon: stage?.is_closed_won ?? false,
            isClosedLost: stage?.is_closed_lost ?? false,
            expectedCloseOn: deal.expected_close_on,
            nextFollowUpAt: deal.next_follow_up_at,
            dealUpdatedAt: deal.updated_at,
            quoteStatus: quote?.status ?? null,
            quoteViewedAt: quote?.viewed_at ?? null,
            quoteSignedAt: quote?.signed_at ?? null,
            quoteExpiresAt: quote?.expires_at ?? null,
            quoteUpdatedAt: quote?.updated_at ?? null,
          });

          return {
            deal_id: deal.id,
            deal_name: deal.name,
            amount: deal.amount,
            expected_close_on: deal.expected_close_on,
            next_follow_up_at: deal.next_follow_up_at,
            quote_review_id: quote?.id ?? null,
            quote_review_status: quote?.status ?? null,
            portal_status: portalStatus,
          };
        })
        .filter((deal) => {
          const stage = deals.find((row) => row.id === deal.deal_id)?.stage_id
            ? stagesById.get(deals.find((row) => row.id === deal.deal_id)!.stage_id!)
            : null;
          if (stage?.is_closed_lost) return false;
          if (stage?.is_closed_won && !["accepted"].includes((deal.quote_review_status ?? "").toLowerCase())) {
            return false;
          }
          if ((deal.quote_review_status ?? "").toLowerCase() === "rejected") return false;
          return true;
        });

      return safeJsonOk({ deals: activeDeals }, origin);
    }

    // ── /subscriptions — EaaS subscriptions ────────────────────────────
    if (route === "subscriptions") {
      if (req.method === "GET") {
        const { data, error } = await supabase
          .from("eaas_subscriptions")
          .select("*, eaas_usage_records(*)")
          .order("created_at", { ascending: false });

        if (error) return safeJsonError("Failed to load subscriptions", 500, origin);
        return safeJsonOk({ subscriptions: data }, origin);
      }
    }

    // ── /warranty-claims — Warranty claim submission ──────────────────
    if (route === "warranty-claims") {
      if (req.method === "GET") {
        const { data, error } = await supabase
          .from("portal_warranty_claims")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) return safeJsonError("Failed to load warranty claims", 500, origin);
        return safeJsonOk({ claims: data }, origin);
      }

      if (req.method === "POST") {
        const body = await req.json();
        if (!body.claim_type || !body.description) {
          return safeJsonError("claim_type and description required", 400, origin);
        }

        const validTypes = ["manufacturer_defect", "premature_failure", "warranty_repair", "recall", "other"];
        if (!validTypes.includes(body.claim_type)) {
          return safeJsonError(`claim_type must be one of: ${validTypes.join(", ")}`, 400, origin);
        }

        const safeBody = {
          portal_customer_id: portalCustomer.id,
          fleet_id: body.fleet_id || null,
          claim_type: body.claim_type,
          description: body.description,
          photos: Array.isArray(body.photos) ? body.photos : [],
        };

        const { data, error } = await supabase
          .from("portal_warranty_claims")
          .insert(safeBody)
          .select()
          .single();

        if (error) return safeJsonError("Failed to submit warranty claim", 500, origin);

        // Notify internal staff
        const supabaseAdmin = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const { data: serviceStaff } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .in("iron_role", ["iron_woman", "iron_man"])
          .limit(5);

        if (serviceStaff) {
          for (const staff of serviceStaff) {
            await supabaseAdmin.from("crm_in_app_notifications").insert({
              workspace_id: "default",
              user_id: staff.id,
              kind: "warranty_claim",
              title: "New Warranty Claim",
              body: `${body.claim_type.replace(/_/g, " ")} claim submitted: ${body.description.substring(0, 100)}`,
              metadata: { claim_id: data.id, portal_customer_id: portalCustomer.id },
            });
          }
        }

        return safeJsonOk({ claim: data }, origin, 201);
      }
    }

    // ── /fleet-with-status — Live service job state per equipment ────
    if (route === "fleet-with-status" && req.method === "GET") {
      const { data, error } = await supabase.rpc("get_portal_fleet_with_status", {
        p_portal_customer_id: portalCustomer.id,
      });
      if (error) return safeJsonError("Failed to load fleet with status", 500, origin);
      const fleet = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
        const activeServiceJob = row.active_service_job as Record<string, unknown> | null;
        const portalStatus = normalizePortalStatus({
          jobStage: typeof activeServiceJob?.current_stage === "string" ? activeServiceJob.current_stage : null,
          jobEta: typeof activeServiceJob?.estimated_completion === "string"
            ? activeServiceJob.estimated_completion
            : null,
          jobUpdatedAt: typeof activeServiceJob?.last_updated_at === "string"
            ? activeServiceJob.last_updated_at
            : null,
          idleUpdatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
        });

        return {
          ...row,
          stage_label: portalStatus.label,
          stage_source: portalStatus.source,
          stage_source_label: portalStatus.source_label,
          eta: portalStatus.eta,
          last_updated_at: portalStatus.last_updated_at,
          portal_status: portalStatus,
        };
      });
      return safeJsonOk({ fleet }, origin);
    }

    // ── /parts/reorder-history — Parts history by machine + one-click ─
    if (route === "parts-history" && req.method === "GET") {
      const { data, error } = await supabase.rpc("get_parts_reorder_history", {
        p_portal_customer_id: portalCustomer.id,
      });
      if (error) return safeJsonError("Failed to load parts history", 500, origin);
      return safeJsonOk({ history: data }, origin);
    }

    // ── /documents — Document library by fleet/serial ────────────────
    if (route === "documents") {
      if (req.method === "GET") {
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!serviceKey) {
          return safeJsonError("Document library is not configured on this environment.", 503, origin);
        }

        const admin = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const url2 = new URL(req.url);
        const fleetId = url2.searchParams.get("fleet_id");
        let query = supabase
          .from("equipment_documents")
          .select("*")
          .eq("customer_visible", true)
          .order("created_at", { ascending: false });

        if (fleetId) query = query.eq("fleet_id", fleetId);

        const { data, error } = await query;
        if (error) return safeJsonError("Failed to load documents", 500, origin);

        const docs = (data ?? []) as Array<Record<string, unknown>>;
        const docIds = docs
          .map((doc) => typeof doc.id === "string" ? doc.id : null)
          .filter((value): value is string => Boolean(value));

        let latestAuditByDocument = new Map<string, DocumentVisibilityAuditRow>();
        if (docIds.length > 0) {
          const { data: auditRows } = await admin
            .from("document_visibility_audit")
            .select("document_id, visibility_after, created_at, reason")
            .in("document_id", docIds)
            .order("created_at", { ascending: false });

          for (const row of ((auditRows ?? []) as DocumentVisibilityAuditRow[])) {
            if (!row.document_id || latestAuditByDocument.has(row.document_id)) continue;
            if (row.visibility_after === false) continue;
            latestAuditByDocument.set(row.document_id, row);
          }
        }

        const documents = docs.map((doc) => {
          const docId = typeof doc.id === "string" ? doc.id : "";
          const latestAudit = latestAuditByDocument.get(docId) ?? null;
          return {
            ...doc,
            portal_visibility: normalizePortalDocumentVisibility({
              createdAt: typeof doc.created_at === "string" ? doc.created_at : new Date().toISOString(),
              latestAudit,
            }),
          };
        });

        return safeJsonOk({ documents }, origin);
      }
    }

    // ── /fleet/:id/trade-interest — Toggle trade-in interest ────────
    if (route === "fleet" && req.method === "PUT") {
      const body = await req.json();
      if (!body.fleet_id) return safeJsonError("fleet_id required", 400, origin);

      const { data, error } = await supabase
        .from("customer_fleet")
        .update({
          trade_in_interest: body.trade_in_interest ?? false,
          trade_in_notes: body.trade_in_notes ?? null,
        })
        .eq("id", body.fleet_id)
        .select()
        .single();

      if (error) return safeJsonError("Failed to update trade-in interest", 500, origin);
      return safeJsonOk({ fleet_item: data }, origin);
    }

    return safeJsonError("Not found", 404, origin);
  } catch (err) {
    console.error("portal-api error:", err);
    captureEdgeException(err, { fn: "portal-api", req });
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
