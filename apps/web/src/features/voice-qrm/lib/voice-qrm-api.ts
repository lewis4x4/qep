import { supabase } from "@/lib/supabase";

const VOICE_QRM_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-to-qrm`;

export type VoiceContentType = "sales" | "parts" | "service" | "process_improvement" | "general";
export type VoiceMatchMethod = "exact" | "fuzzy" | "created" | null;
export type VoiceDealAction = "created" | "updated" | "matched" | null;

export interface VoiceQrmContactResult {
  id: string | null;
  match_method: VoiceMatchMethod;
  confidence: number | null;
  name: string;
}

export interface VoiceQrmCompanyResult {
  id: string | null;
  match_method: VoiceMatchMethod;
  confidence: number | null;
  name: string | null;
}

export interface VoiceQrmDealResult {
  id: string | null;
  action: VoiceDealAction;
  stage_suggestion: number | null;
}

export interface VoiceQrmNeedsAssessmentResult {
  id: string | null;
  completeness: number;
}

export interface VoiceQrmCountResult {
  count: number;
  ids: string[];
  crm_equipment_ids?: string[];
}

export interface VoiceQrmEntities {
  contact: VoiceQrmContactResult;
  company: VoiceQrmCompanyResult;
  deal: VoiceQrmDealResult;
  needs_assessment: VoiceQrmNeedsAssessmentResult;
  cadence: { id: string | null };
  additional_deals: VoiceQrmCountResult;
  equipment: VoiceQrmCountResult;
  scheduled_follow_ups: VoiceQrmCountResult;
  budget_timeline_captured: boolean;
}

export interface VoiceQrmIntelligence {
  competitor_mentions?: Array<{ brand?: string; context?: string }>;
  sentiment?: "positive" | "neutral" | "negative" | null;
  buying_intent?: "high" | "medium" | "low" | null;
}

export interface VoiceQrmResponse {
  success: boolean;
  pipeline_duration_ms: number;
  transcript: string;
  qrm_narrative: string | null;
  entities: VoiceQrmEntities;
  intelligence: VoiceQrmIntelligence | null;
  content_type: VoiceContentType;
  follow_up_suggestions: string[];
  sentiment_score: number | null;
  voice_capture_id: string | null;
  errors?: string[];
}

/** Short-circuit response returned when voice-to-qrm detects an idea
 *  lead phrase in the transcript and routes it to qrm_idea_backlog. */
export interface VoiceIdeaBacklogResponse {
  routed_to: "idea_backlog";
  idea_id: string | null;
  title: string;
  transcript: string;
  matched_pattern: string;
}

export type VoiceQrmResult = VoiceQrmResponse | VoiceIdeaBacklogResponse;

export function isIdeaBacklogResponse(r: VoiceQrmResult): r is VoiceIdeaBacklogResponse {
  return (r as VoiceIdeaBacklogResponse).routed_to === "idea_backlog";
}

export interface SubmitVoiceOptions {
  audioBlob: Blob;
  fileName?: string;
  dealId?: string;
}

export async function submitVoiceToQrm(opts: SubmitVoiceOptions): Promise<VoiceQrmResult> {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) {
    throw new Error("Not signed in");
  }

  const form = new FormData();
  form.append("audio", opts.audioBlob, opts.fileName ?? "recording.webm");
  if (opts.dealId) {
    form.append("deal_id", opts.dealId);
  }

  const res = await fetch(VOICE_QRM_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Voice-to-QRM pipeline failed" }));
    throw new Error((err as { error?: string }).error ?? `Voice-to-QRM failed (${res.status})`);
  }

  return res.json();
}
