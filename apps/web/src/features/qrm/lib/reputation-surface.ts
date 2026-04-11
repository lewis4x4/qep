import type { ExtractedDealData } from "@/lib/voice-capture-extraction.types";

export type ReputationConfidence = "high" | "medium" | "low";

export interface ReputationVoiceSignal {
  createdAt: string;
  transcript: string | null;
  extractedData: ExtractedDealData | null;
}

export interface ReputationFeedbackSignal {
  createdAt: string;
  returnVisitRisk: string | null;
  timeSaverNotes: string | null;
  serialSpecificNote: string | null;
}

export interface ReputationKnowledgeNote {
  createdAt: string;
  noteType: string;
  content: string;
}

export interface ReputationLifecycleEvent {
  eventType: string;
  eventAt: string;
  metadata: Record<string, unknown>;
}

export interface ReputationPortalReview {
  createdAt: string;
  status: string;
  counterNotes: string | null;
  viewedAt: string | null;
  signedAt: string | null;
}

export interface ReputationAuctionSignal {
  make: string;
  model: string;
  year: number | null;
  auctionDate: string;
  hammerPrice: number;
  location: string | null;
}

export interface ReputationRow {
  key: string;
  title: string;
  confidence: ReputationConfidence;
  trace: string[];
  actionLabel: string;
  href: string;
}

export interface ReputationSurfaceBoard {
  summary: {
    customerSignals: number;
    fieldSignals: number;
    shopSignals: number;
    marketSignals: number;
  };
  customerVoice: ReputationRow[];
  fieldTalk: ReputationRow[];
  shopTalk: ReputationRow[];
  marketTalk: ReputationRow[];
}

function titleize(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value
    .replace(/[_-]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function clip(value: string | null | undefined, limit = 120): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 1)}…`;
}

export function buildReputationSurfaceBoard(input: {
  accountId: string;
  voiceSignals: ReputationVoiceSignal[];
  feedbackSignals: ReputationFeedbackSignal[];
  knowledgeNotes: ReputationKnowledgeNote[];
  lifecycleEvents: ReputationLifecycleEvent[];
  portalReviews: ReputationPortalReview[];
  auctionSignals: ReputationAuctionSignal[];
}): ReputationSurfaceBoard {
  const accountHref = `/qrm/accounts/${input.accountId}/command`;
  const strategistHref = `/qrm/accounts/${input.accountId}/strategist`;

  const churnEvents = input.lifecycleEvents.filter((row) => row.eventType === "churn_risk_flag" || row.eventType === "lost");
  const npsEvents = input.lifecycleEvents.filter((row) => row.eventType === "nps_response");
  const wonBackEvents = input.lifecycleEvents.filter((row) => row.eventType === "won_back");

  const customerVoice: ReputationRow[] = [];
  if (npsEvents.length > 0 || churnEvents.length > 0 || wonBackEvents.length > 0) {
    customerVoice.push({
      key: "customer-response-trail",
      title: "Customer response trail is already shaping account reputation",
      confidence: churnEvents.length > 0 ? "high" : npsEvents.length > 0 ? "medium" : "low",
      trace: [
        `${npsEvents.length} NPS/customer-response signal${npsEvents.length === 1 ? "" : "s"} are recorded in the lifecycle ledger.`,
        `${churnEvents.length} churn or loss marker${churnEvents.length === 1 ? "" : "s"} and ${wonBackEvents.length} recovery marker${wonBackEvents.length === 1 ? "" : "s"} are on file.`,
        input.lifecycleEvents[0]?.eventAt ? `Latest reputation event landed ${formatDate(input.lifecycleEvents[0].eventAt)}.` : "No dated reputation event is recorded.",
      ],
      actionLabel: "Open timeline",
      href: `/qrm/accounts/${input.accountId}/timeline`,
    });
  }

  if (input.portalReviews.length > 0) {
    const latestReview = input.portalReviews[0];
    const counterNotes = input.portalReviews.map((row) => clip(row.counterNotes)).filter((value): value is string => Boolean(value));
    customerVoice.push({
      key: "portal-review-pressure",
      title: "Customer review comments are visible in the quote loop",
      confidence: counterNotes.length > 0 ? "high" : "medium",
      trace: [
        `${input.portalReviews.length} portal quote review${input.portalReviews.length === 1 ? "" : "s"} exist on this account.`,
        latestReview.viewedAt ? `Latest review was viewed ${formatDate(latestReview.viewedAt)}.` : `Latest review recorded ${formatDate(latestReview.createdAt)}.`,
        counterNotes[0] ?? `Latest review status: ${titleize(latestReview.status)}.`,
      ],
      actionLabel: "Open account command",
      href: accountHref,
    });
  }

  const fieldTalk: ReputationRow[] = input.voiceSignals
    .slice(0, 4)
    .map((row, index) => {
      const concerns = row.extractedData?.opportunity.keyConcerns ?? null;
      const objections = row.extractedData?.opportunity.objections ?? [];
      const competitorMentions = row.extractedData?.opportunity.competitorsMentioned ?? [];
      const summary = clip(row.transcript ?? concerns ?? objections[0] ?? competitorMentions[0] ?? null);
      const confidence: ReputationConfidence =
        competitorMentions.length > 0 || objections.length > 0
          ? "high"
          : concerns
            ? "medium"
            : "low";
      return {
        key: `voice:${index}:${row.createdAt}`,
        title: "Field talk from voice capture",
        confidence,
        trace: [
          `Captured ${formatDate(row.createdAt)}.`,
          concerns ? `Concern: ${concerns}.` : "No structured concern was extracted.",
          competitorMentions.length > 0
            ? `${competitorMentions.length} competitor mention${competitorMentions.length === 1 ? "" : "s"} surfaced in the capture.`
            : objections.length > 0
              ? `${objections.length} objection${objections.length === 1 ? "" : "s"} surfaced in the capture.`
              : summary ?? "Transcript context is limited.",
        ],
        actionLabel: "Open voice QRM",
        href: "/voice-qrm",
      };
    });

  const shopTalk: ReputationRow[] = [
    ...input.feedbackSignals.slice(0, 3).map((row, index) => {
      const confidence: ReputationConfidence =
        row.returnVisitRisk === "high"
          ? "high"
          : row.returnVisitRisk === "medium"
            ? "medium"
            : "low";
      return {
        key: `feedback:${index}:${row.createdAt}`,
        title: "Technician completion feedback",
        confidence,
        trace: [
          `Recorded ${formatDate(row.createdAt)}.`,
          row.returnVisitRisk ? `Return visit risk: ${titleize(row.returnVisitRisk)}.` : "No return-visit risk was recorded.",
          clip(row.serialSpecificNote) ?? clip(row.timeSaverNotes) ?? "No free-form technician note was recorded.",
        ],
        actionLabel: "Open service",
        href: "/service",
      };
    }),
    ...input.knowledgeNotes.slice(0, 3).map((row, index) => ({
      key: `knowledge:${index}:${row.createdAt}`,
      title: `${titleize(row.noteType)} machine note`,
      confidence: "medium" as const,
      trace: [
        `Captured ${formatDate(row.createdAt)}.`,
        clip(row.content) ?? "No note content available.",
      ],
      actionLabel: "Open operator intel",
      href: "/qrm/operator-intelligence",
    })),
  ];

  const marketTalk: ReputationRow[] = input.auctionSignals
    .slice(0, 4)
    .map((row, index) => ({
      key: `auction:${index}:${row.make}:${row.model}`,
      title: `${row.make} ${row.model}${row.year ? ` ${row.year}` : ""} auction floor signal`,
      confidence: "medium" as const,
      trace: [
        `Hammered for $${Math.round(row.hammerPrice).toLocaleString()} on ${formatDate(row.auctionDate)}.`,
        row.location ? `Auction location: ${row.location}.` : "Auction location was not recorded.",
        "Use this as external reputation and resale context when the market starts talking before the customer does.",
      ],
      actionLabel: "Open price intelligence",
      href: "/price-intelligence",
    }));

  return {
    summary: {
      customerSignals: customerVoice.length,
      fieldSignals: fieldTalk.length,
      shopSignals: shopTalk.length,
      marketSignals: marketTalk.length,
    },
    customerVoice,
    fieldTalk,
    shopTalk,
    marketTalk,
  };
}
