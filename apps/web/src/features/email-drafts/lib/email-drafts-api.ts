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

type SbTable = {
  select: (c: string) => SbSelect;
  update: (v: Record<string, unknown>) => SbUpdate;
};
type SbSelect = {
  eq: (c: string, v: string) => SbSelect;
  in: (c: string, v: string[]) => SbSelect;
  order: (c: string, o: Record<string, boolean>) => SbSelect;
  limit: (n: number) => Promise<{ data: EmailDraft[] | null; error: unknown }>;
};
type SbUpdate = {
  eq: (c: string, v: string) => Promise<{ data: unknown; error: unknown }>;
};

function sb() {
  return (supabase as unknown as { from: (t: string) => SbTable }).from("email_drafts");
}

export async function listEmailDrafts(
  statuses: DraftStatus[] = ["pending", "edited"],
): Promise<EmailDraft[]> {
  const { data, error } = await sb()
    .select("*")
    .in("status", statuses)
    .order("urgency_score", { ascending: false })
    .limit(100);
  if (error) throw new Error(String((error as { message?: string }).message ?? "Failed to load drafts"));
  return data ?? [];
}

export async function updateEmailDraft(
  id: string,
  patch: { subject?: string; body?: string; status?: DraftStatus },
): Promise<void> {
  const payload: Record<string, unknown> = { ...patch };
  // Track edited status automatically if body/subject changed without explicit status
  if ((patch.subject || patch.body) && !patch.status) payload.status = "edited";
  const { error } = await sb().update(payload).eq("id", id);
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
    throw new Error((err as { error?: string }).error ?? "Failed to mark sent");
  }
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
