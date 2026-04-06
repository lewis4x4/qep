import { toDateTimeLocalValue } from "./deal-date";
import type { QrmActivityTemplate, QrmActivityType } from "./types";

export const CRM_ACTIVITY_TEMPLATES: Record<QrmActivityType, QrmActivityTemplate[]> = {
  call: [
    {
      id: "call-quote-check-in",
      activityType: "call",
      label: "Quote check-in",
      description: "Recap quote review and lock the next callback.",
      body: "Checked in on the quote. Customer is reviewing it with the team and asked for a follow-up after they compare options.",
      source: "system",
    },
    {
      id: "call-voicemail",
      activityType: "call",
      label: "Left voicemail",
      description: "Log a clean outbound touch with a callback ask.",
      body: "Left a voicemail with current availability and asked for the best time to reconnect today or tomorrow.",
      source: "system",
    },
    {
      id: "call-trade-discussion",
      activityType: "call",
      label: "Trade discussion",
      description: "Capture trade expectations and next pricing step.",
      body: "Talked through current trade expectations, machine condition, and timing. Next step is updated numbers once photos and hours come in.",
      source: "system",
    },
  ],
  email: [
    {
      id: "email-send-specs",
      activityType: "email",
      label: "Send specs",
      description: "Follow up with machine details and next step.",
      body: "Appreciate the time today. I sent over the machine details we discussed so your team can review specs, availability, and the next step.",
      source: "system",
    },
    {
      id: "email-quote-follow-up",
      activityType: "email",
      label: "Quote follow-up",
      description: "Keep the deal moving without sounding canned.",
      body: "Checking back on the quote we sent over. If timing, budget, or machine requirements changed, send me the update and I will tighten it up.",
      source: "system",
    },
    {
      id: "email-pricing-update",
      activityType: "email",
      label: "Pricing update",
      description: "Summarize updated numbers and offer a walkthrough.",
      body: "Sending the updated numbers and current availability. If you want, I can walk through trade, delivery, and financing options with you this afternoon.",
      source: "system",
    },
  ],
  meeting: [
    {
      id: "meeting-yard-visit",
      activityType: "meeting",
      label: "Yard visit recap",
      description: "Capture on-site findings and next actions.",
      body: "Met on site to review the unit needs, current fleet, and job requirements. Customer wants pricing and lead-time options before the next internal review.",
      source: "system",
    },
    {
      id: "meeting-demo-plan",
      activityType: "meeting",
      label: "Demo planning",
      description: "Log demo scope, attendees, and follow-up.",
      body: "Walked through the demo plan, key decision makers, and what the team wants to see in the field before moving forward.",
      source: "system",
    },
    {
      id: "meeting-owner-review",
      activityType: "meeting",
      label: "Owner review",
      description: "Document ownership-level conversation and open items.",
      body: "Reviewed purchase timing, equipment priorities, and budget guardrails with ownership. Open items are final trade numbers and delivery timing.",
      source: "system",
    },
  ],
  note: [
    {
      id: "note-customer-signal",
      activityType: "note",
      label: "Customer signal",
      description: "Capture intent and urgency without over-writing.",
      body: "Customer interest is active. Main signal is timing around current fleet needs and whether a trade can close the gap.",
      source: "system",
    },
    {
      id: "note-branch-context",
      activityType: "note",
      label: "Branch context",
      description: "Save location-specific context for the next rep touch.",
      body: "Added branch context, equipment preference, and who needs to be looped in before the next quote revision goes out.",
      source: "system",
    },
    {
      id: "note-service-cross-sell",
      activityType: "note",
      label: "Service cross-sell",
      description: "Note downstream service or parts opportunity.",
      body: "Flagged a service and parts follow-up opportunity tied to the current machine discussion so the next touch can cover the full account.",
      source: "system",
    },
  ],
  task: [
    {
      id: "task-call-back",
      activityType: "task",
      label: "Call back tomorrow",
      description: "Simple callback task with a 24-hour due window.",
      body: "Call the customer back with updated pricing, current availability, and the next best step.",
      taskDueMinutes: 24 * 60,
      taskStatus: "open",
      source: "system",
    },
    {
      id: "task-send-specs",
      activityType: "task",
      label: "Send specs today",
      description: "Queue a same-day spec and quote follow-up.",
      body: "Send the spec sheet, quote recap, and any open delivery details before end of day.",
      taskDueMinutes: 4 * 60,
      taskStatus: "open",
      source: "system",
    },
    {
      id: "task-confirm-demo",
      activityType: "task",
      label: "Confirm demo",
      description: "Lock down demo timing and attendees.",
      body: "Confirm the field demo date, location, attendees, and the machine setup the customer wants to see.",
      taskDueMinutes: 2 * 24 * 60,
      taskStatus: "open",
      source: "system",
    },
  ],
  sms: [
    {
      id: "sms-quick-check-in",
      activityType: "sms",
      label: "Quick check-in",
      description: "Short text that feels like a rep sent it.",
      body: "Checking in on the machine we talked about. If you want updated numbers or current availability, send me a good time.",
      source: "system",
    },
    {
      id: "sms-arrival-window",
      activityType: "sms",
      label: "Arrival update",
      description: "Confirm ETA or visit timing from the field.",
      body: "I am on the way and should be there shortly. If anything changed on the unit or location, send it over before I pull in.",
      source: "system",
    },
    {
      id: "sms-follow-up-nudge",
      activityType: "sms",
      label: "Follow-up nudge",
      description: "Keep momentum without sounding automated.",
      body: "Wanted to keep this moving for you. If the team has questions on price, trade, or timing, text me back and I will get it handled.",
      source: "system",
    },
  ],
};

export function mergeActivityTemplates(
  activityType: QrmActivityType,
  workspaceTemplates: QrmActivityTemplate[],
): QrmActivityTemplate[] {
  const systemTemplates = CRM_ACTIVITY_TEMPLATES[activityType] ?? [];
  const workspaceItems = workspaceTemplates
    .filter((template) => template.activityType === activityType && template.isActive !== false)
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));

  return [...workspaceItems, ...systemTemplates];
}

export function toRelativeDateTimeLocalValue(minutesFromNow: number): string {
  return toDateTimeLocalValue(new Date(Date.now() + minutesFromNow * 60_000).toISOString());
}
