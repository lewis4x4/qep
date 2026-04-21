import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface RunPlaysInput {
  admin: SupabaseClient;
  documentId: string | null;
  workspaceId: string | null;
}

export interface RunPlaysResult {
  batchId: string;
  workspaceId: string | null;
  documentId: string | null;
  plays: PlaySummary[];
  expiredCount: number;
  fulfilledCount: number;
  exceptionsPushed: number;
}

export interface PlaySummary {
  id: string;
  documentId: string | null;
  businessKey: string;
  playKind: string;
  status: string;
  projectedDueDate: string | null;
  probability: number;
  reason: string;
}

interface ObligationRow {
  id: string;
  workspace_id: string;
  edge_type: string;
  from_document_id: string | null;
  status: string;
  valid_until: string | null;
  confidence: number | null;
  source_fact_ids: string[] | null;
}

interface DocumentOwnerRow {
  id: string;
  workspace_id: string;
  review_owner_user_id: string | null;
  title: string | null;
}

function windowForDays(days: number): "7d" | "14d" | "30d" | "60d" | "90d" {
  if (days <= 7) return "7d";
  if (days <= 14) return "14d";
  if (days <= 30) return "30d";
  if (days <= 60) return "60d";
  return "90d";
}

function probabilityForDays(days: number): number {
  if (days <= 3) return 0.92;
  if (days <= 7) return 0.85;
  if (days <= 14) return 0.72;
  if (days <= 30) return 0.55;
  if (days <= 60) return 0.4;
  return 0.25;
}

function businessKeyFor(obligation: ObligationRow): string {
  return `${obligation.from_document_id ?? "none"}:expiring_rental:${windowForDays(
    daysUntil(obligation.valid_until),
  )}`;
}

function daysUntil(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const ms = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(ms)) return Number.POSITIVE_INFINITY;
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export async function runPlaysEngine(input: RunPlaysInput): Promise<RunPlaysResult> {
  const { admin, documentId, workspaceId } = input;
  const batchId = crypto.randomUUID();

  // Pull candidate obligations: expires_on edges, still active/at_risk,
  // due within 60 days, scoped to the requested document or workspace.
  let query = admin
    .from("document_obligations")
    .select("id, workspace_id, edge_type, from_document_id, status, valid_until, confidence, source_fact_ids")
    .eq("edge_type", "expires_on")
    .in("status", ["active", "at_risk"])
    .gte("valid_until", new Date().toISOString())
    .lte("valid_until", new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString());

  if (documentId) query = query.eq("from_document_id", documentId);
  else if (workspaceId) query = query.eq("workspace_id", workspaceId);

  const { data: obligationRows, error: obligationsError } = await query;
  if (obligationsError) throw new Error(obligationsError.message);

  const obligations = (obligationRows ?? []) as ObligationRow[];

  // Pull the owning documents in one batch so we can attach a
  // suggested_owner_user_id.
  const documentIds = Array.from(
    new Set(obligations.map((o) => o.from_document_id).filter((v): v is string => v !== null)),
  );
  const ownerByDoc = new Map<string, DocumentOwnerRow>();
  if (documentIds.length > 0) {
    const { data: docRows, error: docError } = await admin
      .from("documents")
      .select("id, workspace_id, review_owner_user_id, title")
      .in("id", documentIds);
    if (docError) throw new Error(docError.message);
    for (const row of (docRows ?? []) as DocumentOwnerRow[]) {
      ownerByDoc.set(row.id, row);
    }
  }

  // Upsert plays for each candidate obligation.
  const plays: PlaySummary[] = [];
  let exceptionsPushed = 0;
  for (const obligation of obligations) {
    const days = daysUntil(obligation.valid_until);
    const projectionWindow = windowForDays(days);
    const probability = probabilityForDays(days);
    const businessKey = businessKeyFor(obligation);
    const ownerDoc = obligation.from_document_id ? ownerByDoc.get(obligation.from_document_id) : undefined;

    const reason = `expires in ${days} day${days === 1 ? "" : "s"} with no fulfillment edge`;

    const insertPayload = {
      workspace_id: obligation.workspace_id,
      business_key: businessKey,
      play_kind: "expiring_rental",
      document_id: obligation.from_document_id,
      from_obligation_id: obligation.id,
      projection_window: projectionWindow,
      projected_due_date: obligation.valid_until,
      probability,
      reason,
      signal_type: "obligation.expires_on",
      recommended_action: {
        flow: "renewal_draft",
        severity: days <= 7 ? "high" : days <= 14 ? "medium" : "low",
      },
      suggested_owner_user_id: ownerDoc?.review_owner_user_id ?? null,
      status: "open",
      computation_batch_id: batchId,
      input_signals: {
        obligation_id: obligation.id,
        days_until: days,
        source_fact_ids: obligation.source_fact_ids ?? [],
        confidence: obligation.confidence ?? 0,
      },
      trace_id: batchId,
      updated_at: new Date().toISOString(),
    };

    const { data: upsertRows, error: upsertError } = await admin
      .from("document_plays")
      .upsert(insertPayload, { onConflict: "workspace_id,business_key" })
      .select("id, document_id, business_key, play_kind, status, projected_due_date, probability, reason")
      .limit(1);
    if (upsertError) {
      console.warn("[document-plays-run] upsert failed", upsertError.message);
      continue;
    }
    const raw = (upsertRows ?? [])[0] as Record<string, unknown> | undefined;
    if (!raw) continue;
    const play: PlaySummary = {
      id: String(raw.id ?? ""),
      documentId: raw.document_id ? String(raw.document_id) : null,
      businessKey: String(raw.business_key ?? ""),
      playKind: String(raw.play_kind ?? ""),
      status: String(raw.status ?? ""),
      projectedDueDate: raw.projected_due_date ? String(raw.projected_due_date) : null,
      probability: typeof raw.probability === "number" ? raw.probability : 0,
      reason: String(raw.reason ?? ""),
    };
    plays.push(play);

    // High-severity plays (p ≥ 0.75 or within 7d) surface in the
    // exception queue so admins see them outside the Document Center.
    if (probability >= 0.75 || days <= 7) {
      try {
        await admin.from("exception_queue").insert({
          workspace_id: obligation.workspace_id,
          source: "doc_center_review",
          severity: days <= 3 ? "critical" : "high",
          status: "open",
          title: `Play: ${play.playKind.replace(/_/g, " ")} (${days}d)`.slice(0, 200),
          detail: reason.slice(0, 1000),
          payload: {
            slice: "plays",
            play_id: play.id,
            document_id: obligation.from_document_id,
            projection_window: projectionWindow,
            probability,
          },
          entity_table: "document_plays",
          entity_id: play.id,
        });
        exceptionsPushed += 1;
      } catch (err) {
        console.warn("[document-plays-run] exception_queue insert threw", err);
      }
    }

    // Audit row — the title snapshot is useful for the Exception Inbox.
    if (obligation.from_document_id) {
      try {
        await admin.from("document_audit_events").insert({
          document_id: obligation.from_document_id,
          document_title_snapshot: ownerDoc?.title ?? null,
          event_type: "play_generated",
          metadata: {
            play_id: play.id,
            play_kind: play.playKind,
            projection_window: projectionWindow,
            probability,
            batch_id: batchId,
          },
        });
      } catch (err) {
        console.warn("[document-plays-run] audit insert threw", err);
      }
    }
  }

  // Lifecycle sweeps — cheap housekeeping inside the same run so the
  // list endpoint always sees a current table.
  const nowIso = new Date().toISOString();
  let expiredQuery = admin
    .from("document_plays")
    .update({ status: "expired", updated_at: nowIso })
    .eq("status", "open")
    .not("projected_due_date", "is", null)
    .lt("projected_due_date", nowIso);
  if (documentId) expiredQuery = expiredQuery.eq("document_id", documentId);
  else if (workspaceId) expiredQuery = expiredQuery.eq("workspace_id", workspaceId);
  const { data: expiredRows } = await expiredQuery.select("id");
  const expiredCount = Array.isArray(expiredRows) ? expiredRows.length : 0;

  // Fulfilled detection: any play whose source obligation now has a
  // corresponding fulfills edge flips to fulfilled. The projector
  // currently doesn't create fulfills edges, so this always returns 0
  // in MVP — wired up for forward-compat.
  const fulfilledCount = 0;

  return {
    batchId,
    workspaceId,
    documentId,
    plays,
    expiredCount,
    fulfilledCount,
    exceptionsPushed,
  };
}
