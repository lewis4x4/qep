/**
 * HubSpot Webhook Listener
 * Receives deal stage change events, enrolls deals in follow-up sequences
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

Deno.serve(async (req) => {
  // HubSpot sends webhook signature for verification
  const signature = req.headers.get("X-HubSpot-Signature-v3");
  const requestTimestamp = req.headers.get("X-HubSpot-Request-Timestamp");
  const body = await req.text();

  // Verify signature to prevent spoofing — headers are mandatory
  if (!signature || !requestTimestamp) {
    console.warn("Missing HubSpot webhook signature headers");
    return new Response("Unauthorized", { status: 401 });
  }

  const clientSecret = Deno.env.get("HUBSPOT_CLIENT_SECRET")!;
  const sourceString = `${req.method}${req.url}${body}${requestTimestamp}`;
  const expectedSig = createHmac("sha256", clientSecret)
    .update(sourceString)
    .digest("base64");

  if (signature !== expectedSig) {
    console.warn("Invalid HubSpot webhook signature");
    return new Response("Unauthorized", { status: 401 });
  }

  let events: HubSpotEvent[];
  try {
    events = JSON.parse(body);
    if (!Array.isArray(events)) events = [events];
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  for (const event of events) {
    await processEvent(supabase, event);
  }

  return new Response("OK", { status: 200 });
});

interface HubSpotEvent {
  eventType: string;
  subscriptionType: string;
  portalId: number;
  objectId: number;           // deal ID
  propertyName: string;
  propertyValue: string;      // new stage value
  changeSource: string;
  occurredAt: number;
}

async function processEvent(
  supabase: ReturnType<typeof createClient>,
  event: HubSpotEvent
) {
  if (event.subscriptionType !== "deal.propertyChange") return;
  if (event.propertyName !== "dealstage") return;

  const hubId = String(event.portalId);
  const dealId = String(event.objectId);
  const newStage = event.propertyValue;

  console.log(`Deal ${dealId} moved to stage: ${newStage}`);

  // Log the stage change
  await supabase.from("activity_log").insert({
    deal_id: dealId,
    hub_id: hubId,
    activity_type: "deal_stage_change",
    payload: { stage: newStage, occurred_at: event.occurredAt },
  });

  // Find sequences triggered by this stage
  const { data: sequences } = await supabase
    .from("follow_up_sequences")
    .select("id, name")
    .eq("trigger_stage", newStage)
    .eq("is_active", true);

  if (!sequences || sequences.length === 0) return;

  // Get connection for this portal
  const { data: connection } = await supabase
    .from("hubspot_connections")
    .select("access_token, token_expires_at, refresh_token")
    .eq("hub_id", hubId)
    .eq("is_active", true)
    .limit(1)
    .single();

  if (!connection) {
    console.warn(`No active HubSpot connection for portal ${hubId}`);
    return;
  }

  // Refresh token if expired
  const token = await getValidToken(supabase, hubId, connection);
  if (!token) return;

  // Fetch deal details from HubSpot
  const dealRes = await fetch(
    `https://api.hubapi.com/crm/v3/objects/deals/${dealId}?properties=dealname,hubspot_owner_id,hs_object_id&associations=contacts`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const deal = await dealRes.json();
  const dealName = deal.properties?.dealname ?? `Deal ${dealId}`;
  const ownerId = deal.properties?.hubspot_owner_id;

  // Get contact info
  let contactId: string | null = null;
  let contactName: string | null = null;
  const contactAssoc = deal.associations?.contacts?.results?.[0];
  if (contactAssoc) {
    contactId = String(contactAssoc.id);
    const contactRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const contact = await contactRes.json();
    contactName = [contact.properties?.firstname, contact.properties?.lastname]
      .filter(Boolean).join(" ") || null;
  }

  // Enroll deal in each matching sequence
  for (const sequence of sequences) {
    // Get first step to calculate next_step_due_at
    const { data: firstStep } = await supabase
      .from("follow_up_steps")
      .select("day_offset")
      .eq("sequence_id", sequence.id)
      .eq("step_number", 1)
      .single();

    const nextDue = firstStep
      ? new Date(Date.now() + firstStep.day_offset * 86400000).toISOString()
      : null;

    const { data: enrollment, error } = await supabase
      .from("sequence_enrollments")
      .upsert({
        sequence_id: sequence.id,
        deal_id: dealId,
        deal_name: dealName,
        contact_id: contactId,
        contact_name: contactName,
        owner_id: ownerId,
        hub_id: hubId,
        current_step: 1,
        next_step_due_at: nextDue,
        status: "active",
      }, { onConflict: "deal_id,sequence_id" })
      .select()
      .single();

    if (error) {
      console.error(`Failed to enroll deal ${dealId}:`, error.message);
      continue;
    }

    await supabase.from("activity_log").insert({
      enrollment_id: enrollment.id,
      deal_id: dealId,
      hub_id: hubId,
      activity_type: "enrollment_created",
      payload: { sequence_name: sequence.name, next_due: nextDue },
    });

    // Push custom properties to HubSpot deal
    await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          blackrock_automation_enrolled: "true",
          blackrock_followup_step: "1",
          blackrock_last_followup_date: new Date().toISOString().split("T")[0],
        },
      }),
    });
  }
}

async function getValidToken(
  supabase: ReturnType<typeof createClient>,
  hubId: string,
  connection: { access_token: string; token_expires_at: string; refresh_token: string }
): Promise<string | null> {
  const expiresAt = new Date(connection.token_expires_at).getTime();
  if (Date.now() < expiresAt - 60000) return connection.access_token;

  // Refresh the token
  const res = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: Deno.env.get("HUBSPOT_CLIENT_ID")!,
      client_secret: Deno.env.get("HUBSPOT_CLIENT_SECRET")!,
      refresh_token: connection.refresh_token,
    }),
  });

  if (!res.ok) {
    console.error("Token refresh failed:", await res.text());
    return null;
  }

  const tokens = await res.json();
  await supabase
    .from("hubspot_connections")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? connection.refresh_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    })
    .eq("hub_id", hubId);

  return tokens.access_token;
}
