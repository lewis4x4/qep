import { supabase } from "@/lib/supabase";

const DRAFT_EMAIL_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/draft-email`;

export type DraftScenario =
  | "budget_cycle"
  | "price_increase"
  | "tariff"
  | "requote"
  | "trade_up"
  | "custom";

export type DraftStatus = "pending" | "edited" | "sent" | "dismissed" | "failed";

export interface EmailDraft {
  id: string;
  workspace_id: string;
  scenario: DraftScenario;
  tone: "urgent" | "consultative" | "friendly";
  deal_id: string | null;
  contact_id: string | null;
  company_id: string | null;
  equipment_id: string | null;
  subject: string;
  body: string;
  to_email: string | null;
  preview: string | null;
  urgency_score: number | null;
  context: Record<string, unknown>;
  status: DraftStatus;
  sent_at: string | null;
  sent_via: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SendEmailDraftResult {
  sent: boolean;
  to_email: string;
}

const DRAFT_SCENARIOS = new Set<DraftScenario>([
  "budget_cycle",
  "price_increase",
  "tariff",
  "requote",
  "trade_up",
  "custom",
]);

const DRAFT_STATUSES = new Set<DraftStatus>([
  "pending",
  "edited",
  "sent",
  "dismissed",
  "failed",
]);

const DRAFT_TONES = new Set<EmailDraft["tone"]>([
  "urgent",
  "consultative",
  "friendly",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function finiteNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function validDateStringOrNull(value: unknown): string | null {
  const text = stringOrNull(value);
  return text && Number.isFinite(new Date(text).getTime()) ? text : null;
}

function errorMessage(payload: unknown, fallback: string): string {
  return isRecord(payload) && typeof payload.error === "string" && payload.error.trim().length > 0
    ? payload.error
    : fallback;
}

export function normalizeEmailDraftRows(rows: unknown): EmailDraft[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = stringOrNull(row.id);
    const workspaceId = stringOrNull(row.workspace_id);
    const subject = stringOrNull(row.subject);
    const body = stringOrNull(row.body);
    const createdAt = validDateStringOrNull(row.created_at);
    const updatedAt = validDateStringOrNull(row.updated_at);
    if (!id || !workspaceId || !subject || !body || !createdAt || !updatedAt) return [];

    const scenario = stringOrNull(row.scenario);
    const tone = stringOrNull(row.tone);
    const status = stringOrNull(row.status);

    return [{
      id,
      workspace_id: workspaceId,
      scenario: scenario && DRAFT_SCENARIOS.has(scenario as DraftScenario) ? scenario as DraftScenario : "custom",
      tone: tone && DRAFT_TONES.has(tone as EmailDraft["tone"]) ? tone as EmailDraft["tone"] : "consultative",
      deal_id: stringOrNull(row.deal_id),
      contact_id: stringOrNull(row.contact_id),
      company_id: stringOrNull(row.company_id),
      equipment_id: stringOrNull(row.equipment_id),
      subject,
      body,
      to_email: stringOrNull(row.to_email),
      preview: stringOrNull(row.preview),
      urgency_score: finiteNumberOrNull(row.urgency_score),
      context: isRecord(row.context) ? row.context : {},
      status: status && DRAFT_STATUSES.has(status as DraftStatus) ? status as DraftStatus : "pending",
      sent_at: validDateStringOrNull(row.sent_at),
      sent_via: stringOrNull(row.sent_via),
      created_by: stringOrNull(row.created_by),
      created_at: createdAt,
      updated_at: updatedAt,
    }];
  });
}

export function normalizeSendEmailDraftResult(payload: unknown): SendEmailDraftResult {
  if (!isRecord(payload)) throw new Error("Malformed send email response");
  const toEmail = stringOrNull(payload.to_email);
  if (payload.sent !== true || !toEmail) throw new Error("Malformed send email response");
  return { sent: true, to_email: toEmail };
}

export async function listEmailDrafts(
  statuses: DraftStatus[] = ["pending", "edited"],
): Promise<EmailDraft[]> {
  const { data, error } = await supabase
    .from("email_drafts")
    .select("*")
    .in("status", statuses)
    .order("urgency_score", { ascending: false })
    .limit(100);
  if (error) throw new Error(String((error as { message?: string }).message ?? "Failed to load drafts"));
  return normalizeEmailDraftRows(data);
}

export async function updateEmailDraft(
  id: string,
  patch: { subject?: string; body?: string; status?: DraftStatus },
): Promise<void> {
  const payload: Record<string, unknown> = { ...patch };
  // Track edited status automatically if body/subject changed without explicit status
  if ((patch.subject || patch.body) && !patch.status) payload.status = "edited";
  const { error } = await supabase.from("email_drafts").update(payload).eq("id", id);
  if (error) throw new Error(String((error as { message?: string }).message ?? "Failed to update draft"));
}

export async function dismissEmailDraft(id: string): Promise<void> {
  return updateEmailDraft(id, { status: "dismissed" });
}

/** POST to draft-email /mark-sent. */
export async function markEmailDraftSent(
  draftId: string,
  sentVia: string = "manual",
): Promise<void> {
  const session = (await supabase.auth.getSession()).data.session;
  const res = await fetch(`${DRAFT_EMAIL_URL}/mark-sent`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session?.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ draft_id: draftId, sent_via: sentVia }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to mark sent" }));
    throw new Error(errorMessage(err, "Failed to mark sent"));
  }
}

/** POST to draft-email /send — actually sends the email via Resend. */
export async function sendEmailDraft(
  draftId: string,
): Promise<SendEmailDraftResult> {
  const session = (await supabase.auth.getSession()).data.session;
  const res = await fetch(`${DRAFT_EMAIL_URL}/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session?.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ draft_id: draftId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to send email" }));
    throw new Error(errorMessage(err, "Failed to send email"));
  }
  return normalizeSendEmailDraftResult(await res.json());
}

export const SCENARIO_LABELS: Record<DraftScenario, string> = {
  budget_cycle: "Budget cycle",
  price_increase: "Price increase",
  tariff: "Tariff alert",
  requote: "Requote",
  trade_up: "Trade-up",
  custom: "Custom",
};

export const SCENARIO_COLORS: Record<DraftScenario, string> = {
  budget_cycle: "bg-blue-500/10 text-blue-400",
  price_increase: "bg-amber-500/10 text-amber-400",
  tariff: "bg-red-500/10 text-red-400",
  requote: "bg-violet-500/10 text-violet-400",
  trade_up: "bg-emerald-500/10 text-emerald-400",
  custom: "bg-muted text-muted-foreground",
};
