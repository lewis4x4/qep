/**
 * Voice Note Intelligence — post-extraction analysis
 *
 * After a voice note is transcribed and structured data extracted, this module:
 * 1. Auto-links mentioned contacts, companies, and deals to QRM records
 * 2. Stores queryable intelligence signals (sentiment, competitor mentions, attention flags)
 * 3. Creates competitive_mentions records for tracking
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { VoiceCaptureExtractedDealData } from "./voice-capture-crm.ts";

interface IntelligenceInput {
  captureId: string;
  userId: string;
  transcript: string;
  extracted: VoiceCaptureExtractedDealData;
  existingDealId: string | null;
}

async function fuzzyMatchContact(
  db: SupabaseClient,
  name: string,
): Promise<string | null> {
  if (!name || name.length < 2) return null;
  const parts = name.trim().split(/\s+/);
  const firstName = parts[0];
  const lastName = parts.length > 1 ? parts[parts.length - 1] : null;

  let query = db
    .from("crm_contacts")
    .select("id")
    .is("deleted_at", null);

  if (lastName) {
    query = query.ilike("last_name", `%${lastName}%`).ilike("first_name", `%${firstName}%`);
  } else {
    query = query.or(`first_name.ilike.%${firstName}%,last_name.ilike.%${firstName}%`);
  }

  const { data } = await query.limit(1).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

async function fuzzyMatchCompany(
  db: SupabaseClient,
  name: string,
): Promise<string | null> {
  if (!name || name.length < 2) return null;

  const { data } = await db
    .from("crm_companies")
    .select("id")
    .is("deleted_at", null)
    .ilike("name", `%${name}%`)
    .limit(1)
    .maybeSingle();

  return (data as { id: string } | null)?.id ?? null;
}

async function fuzzyMatchDeal(
  db: SupabaseClient,
  contactId: string | null,
  companyId: string | null,
): Promise<string | null> {
  if (!contactId && !companyId) return null;

  let query = db
    .from("crm_deals")
    .select("id")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (contactId) {
    query = query.eq("primary_contact_id", contactId);
  } else if (companyId) {
    query = query.eq("company_id", companyId);
  }

  const { data } = await query.maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export async function processVoiceNoteIntelligence(
  db: SupabaseClient,
  input: IntelligenceInput,
): Promise<void> {
  const { captureId, userId, transcript, extracted, existingDealId } = input;

  // 1. Auto-link entities
  let linkedContactId: string | null = null;
  let linkedCompanyId: string | null = null;
  let linkedDealId: string | null = existingDealId;

  const contactName = extracted.record.contactName;
  const companyName = extracted.record.companyName;

  const [matchedContact, matchedCompany] = await Promise.all([
    contactName ? fuzzyMatchContact(db, contactName) : null,
    companyName ? fuzzyMatchCompany(db, companyName) : null,
  ]);

  linkedContactId = matchedContact;
  linkedCompanyId = matchedCompany;

  if (!linkedDealId) {
    linkedDealId = await fuzzyMatchDeal(db, linkedContactId, linkedCompanyId);
  }

  // 2. Extract queryable signals
  const sentiment = extracted.guidance.customerSentiment !== "unknown"
    ? extracted.guidance.customerSentiment
    : null;
  const competitorMentions = extracted.opportunity.competitorsMentioned ?? [];
  const managerAttention = extracted.guidance.managerAttentionFlag;

  // 3. Update voice capture with intelligence data
  await db
    .from("voice_captures")
    .update({
      sentiment,
      competitor_mentions: competitorMentions,
      linked_contact_id: linkedContactId,
      linked_company_id: linkedCompanyId,
      linked_deal_id: linkedDealId,
      manager_attention: managerAttention,
      intelligence_processed_at: new Date().toISOString(),
    })
    .eq("id", captureId);

  // 4. Create competitive_mentions records
  if (competitorMentions.length > 0) {
    const contextSnippet = transcript.length > 300
      ? transcript.slice(0, 300) + "..."
      : transcript;

    const rows = competitorMentions.map((competitor: string) => ({
      voice_capture_id: captureId,
      competitor_name: competitor.trim(),
      context: contextSnippet,
      sentiment,
      user_id: userId,
    }));

    await db.from("competitive_mentions").insert(rows);
  }

  console.log(
    `[voice-note-intelligence] capture=${captureId}: ` +
    `contact=${linkedContactId ?? "none"}, company=${linkedCompanyId ?? "none"}, ` +
    `deal=${linkedDealId ?? "none"}, sentiment=${sentiment ?? "unknown"}, ` +
    `competitors=${competitorMentions.length}, managerFlag=${managerAttention}`,
  );
}
