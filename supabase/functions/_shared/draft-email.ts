/**
 * Shared Email Draft Service
 *
 * Generates AI-drafted emails for urgency messaging, requotes, escalations,
 * and notifications. Centralized to avoid duplication across edge functions.
 *
 * Used by:
 * - deal-timing-scan (price increase urgency)
 * - price-file-import (requote notifications)
 * - tax-calculator (tariff urgency)
 * - escalation-router (customer escalations)
 */

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

export interface DraftEmailContext {
  /** Purpose tag: 'price_increase_urgency', 'requote', 'tariff_alert', 'trade_in_opportunity' */
  purpose: string;
  /** Recipient rep/advisor name */
  rep_name?: string;
  /** Customer context */
  customer_name?: string;
  company_name?: string;
  /** Equipment/deal context */
  equipment?: string;
  deal_value?: number;
  /** Pricing context */
  manufacturer?: string;
  effective_date?: string;
  increase_pct?: number;
  /** Free-form additional context */
  extra_context?: Record<string, unknown>;
}

export interface EmailDraft {
  subject: string;
  body: string;
  /** Tone used for generation */
  tone: "urgent" | "professional" | "friendly";
  /** Whether OpenAI was used (vs fallback template) */
  ai_generated: boolean;
}

const FALLBACK_TEMPLATES: Record<string, (ctx: DraftEmailContext) => EmailDraft> = {
  price_increase_urgency: (ctx) => ({
    subject: `Action required: ${ctx.manufacturer || "Manufacturer"} pricing adjustment ${ctx.effective_date || "soon"}`,
    body: `Hi ${ctx.customer_name || "there"},\n\nWanted to give you a heads up — ${ctx.manufacturer || "the manufacturer"} is adjusting pricing effective ${ctx.effective_date || "soon"}${ctx.increase_pct ? ` (approximately ${ctx.increase_pct}%)` : ""}. If you're considering ${ctx.equipment || "equipment from us"}, now's the time to lock in current pricing.\n\nCall me when you get a chance — I want to make sure you don't miss this window.\n\nThanks,\n${ctx.rep_name || "Your QEP Representative"}`,
    tone: "urgent",
    ai_generated: false,
  }),
  requote: (ctx) => ({
    subject: `Updated quote — ${ctx.manufacturer || "new"} pricing effective ${ctx.effective_date || "now"}`,
    body: `Hi ${ctx.customer_name || "there"},\n\nHeads up — ${ctx.manufacturer || "the manufacturer"} adjusted pricing effective ${ctx.effective_date || "recently"}. I've updated your quote with current numbers.\n\nLet me know if you have any questions or want to move forward.\n\nThanks,\n${ctx.rep_name || "Your QEP Representative"}`,
    tone: "professional",
    ai_generated: false,
  }),
  tariff_alert: (ctx) => ({
    subject: `Tariff alert: ${ctx.manufacturer || "equipment"} prices increasing ${ctx.effective_date || "soon"}`,
    body: `Hi ${ctx.customer_name || "there"},\n\nQuick urgent note — a tariff surcharge is hitting ${ctx.manufacturer || "manufacturer"} equipment effective ${ctx.effective_date || "soon"}${ctx.increase_pct ? ` (${ctx.increase_pct}%)` : ""}. Current pricing is locked for a limited window.\n\nIf you've been considering an equipment purchase, let's talk this week.\n\nThanks,\n${ctx.rep_name || "Your QEP Representative"}`,
    tone: "urgent",
    ai_generated: false,
  }),
  trade_in_opportunity: (ctx) => ({
    subject: `Trade-in opportunity for your ${ctx.equipment || "equipment"}`,
    body: `Hi ${ctx.customer_name || "there"},\n\nI noticed you flagged interest in trading your ${ctx.equipment || "equipment"}. I'd love to put together a valuation and some replacement options for you.\n\nWhen's a good time this week to connect?\n\nThanks,\n${ctx.rep_name || "Your QEP Representative"}`,
    tone: "friendly",
    ai_generated: false,
  }),
  generic: (ctx) => ({
    subject: `Follow-up from QEP`,
    body: `Hi ${ctx.customer_name || "there"},\n\nFollowing up with you.\n\nThanks,\n${ctx.rep_name || "Your QEP Representative"}`,
    tone: "professional",
    ai_generated: false,
  }),
};

function fallbackDraft(ctx: DraftEmailContext): EmailDraft {
  const template = FALLBACK_TEMPLATES[ctx.purpose] || FALLBACK_TEMPLATES.generic;
  return template(ctx);
}

/**
 * Generate an email draft using OpenAI (with fallback template).
 */
export async function draftEmail(ctx: DraftEmailContext): Promise<EmailDraft> {
  if (!OPENAI_API_KEY) {
    return fallbackDraft(ctx);
  }

  const systemPrompt = `You draft professional, concise emails for QEP (Quality Equipment Parts), a heavy equipment dealership.

Purpose: ${ctx.purpose.replace(/_/g, " ")}

Rules:
- Warm but direct. No fluff.
- Urgency only when the purpose requires it.
- 2-4 short paragraphs max.
- Sign from the rep by first name.
- Return ONLY valid JSON: { "subject": "...", "body": "...", "tone": "urgent|professional|friendly" }`;

  const userPrompt = `Context:\n${JSON.stringify(ctx, null, 2)}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 450,
        temperature: 0.5,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.error("draft-email OpenAI error:", await res.text());
      return fallbackDraft(ctx);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return fallbackDraft(ctx);

    const parsed = JSON.parse(content);
    return {
      subject: parsed.subject || fallbackDraft(ctx).subject,
      body: parsed.body || fallbackDraft(ctx).body,
      tone: (parsed.tone as "urgent" | "professional" | "friendly") || "professional",
      ai_generated: true,
    };
  } catch (err) {
    console.error("draft-email error:", err);
    return fallbackDraft(ctx);
  }
}

/**
 * Batch-draft emails (rep-specific context for each).
 */
export async function draftEmailsForReps(
  baseCtx: Omit<DraftEmailContext, "rep_name" | "customer_name">,
  recipients: Array<{ rep_name: string; customer_name: string; extra?: Record<string, unknown> }>,
): Promise<EmailDraft[]> {
  const drafts = await Promise.all(
    recipients.map((r) =>
      draftEmail({
        ...baseCtx,
        rep_name: r.rep_name,
        customer_name: r.customer_name,
        extra_context: { ...baseCtx.extra_context, ...r.extra },
      }),
    ),
  );
  return drafts;
}
