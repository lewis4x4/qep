/**
 * Decision Room — archetype model and seat inference.
 *
 * Equipment sales decisions are never made by one person. Every deal has a
 * decision room of 4–9 humans, usually some visible in CRM and some entirely
 * invisible ("ghosts"). This module encodes the canonical archetypes and the
 * inference rules that convert raw CRM+voice+signature evidence into a seat
 * map of named + ghost participants.
 *
 * Downstream phases plug in here:
 *   - Phase 2 (try-a-move): each seat carries a stable id + archetype so a
 *     move's per-seat reaction can be addressed and remembered over time.
 *   - Phase 3 (ghost web search): findGuidance on ghost seats feeds directly
 *     into Tavily exec-title lookups and warm-intro path inference.
 *   - Phase 4 (time scrubber): stance + confidence carry timestamps so the
 *     same seat can be replayed at future ticks.
 *   - Phase 5 (loss gym): the seat shape matches historical snapshot rows.
 */
import type { RelationshipMapBoard, RelationshipMapContact, RelationshipRole } from "./relationship-map";
import type { NeedsAssessment } from "./deal-composite-types";

export type SeatArchetype =
  | "champion"
  | "economic_buyer"
  | "operations"
  | "procurement"
  | "operator"
  | "maintenance"
  | "executive_sponsor";

export type SeatStatus = "named" | "ghost";

export type SeatStance = "champion" | "neutral" | "skeptical" | "blocker" | "unknown";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface SeatEvidence {
  kind: "activity" | "voice" | "signature" | "needs_assessment" | "primary_contact" | "archetype_inference" | "stakeholder_mention";
  label: string;
  occurredAt: string | null;
  sourceId: string | null;
}

export interface DecisionRoomSeat {
  /** Stable id — `contact:<uuid>` for named, `ghost:<archetype>` for ghosts, `mention:<slug>` for unmatched name mentions. */
  id: string;
  status: SeatStatus;
  archetype: SeatArchetype;
  archetypeLabel: string;
  /** Display name. Null for pure archetype ghosts; the unmatched-mention string for mentioned ghosts. */
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  /** How confident we are that this seat belongs in this room. */
  confidence: ConfidenceLevel;
  /** How this seat currently leans on the deal. */
  stance: SeatStance;
  /** Relative influence on the final decision (0 minimal → 1 decisive). */
  powerWeight: number;
  /** Influence specifically on the veto axis — ability to kill the deal alone. */
  vetoWeight: number;
  evidence: SeatEvidence[];
  lastSignalAt: string | null;
  /** Present on ghost seats. Tells the rep where to find this person. */
  findGuidance: GhostFindGuidance | null;
}

export interface GhostFindGuidance {
  reason: string;
  searchQuery: string;
  emailHint: string | null;
  nextStep: string;
}

interface ArchetypeDef {
  label: string;
  description: string;
  powerWeight: number;
  vetoWeight: number;
  /** Expected in every equipment decision room, regardless of deal size. */
  alwaysExpected: boolean;
  /** Expected once a deal crosses a mid-market size (amount threshold in dollars). */
  midMarketThreshold: number | null;
  /** Title fragments that, if present in a contact title, pin that contact to this archetype. */
  titleKeywords: string[];
  /** Role hints produced by relationship-map that tilt a contact toward this archetype. */
  roleHints: RelationshipRole[];
}

export const ARCHETYPE_DEFS: Record<SeatArchetype, ArchetypeDef> = {
  champion: {
    label: "Champion",
    description: "Primary rep contact who advocates internally",
    powerWeight: 0.6,
    vetoWeight: 0.15,
    alwaysExpected: true,
    midMarketThreshold: null,
    titleKeywords: ["owner-operator", "buyer rep"],
    roleHints: ["influencer", "signer"],
  },
  economic_buyer: {
    label: "Economic Buyer",
    description: "Approves capex and signs the check",
    powerWeight: 1.0,
    vetoWeight: 1.0,
    alwaysExpected: true,
    midMarketThreshold: null,
    titleKeywords: ["cfo", "owner", "president", "controller", "vp finance", "finance director"],
    roleHints: ["decider", "signer"],
  },
  operations: {
    label: "Operations / Plant Manager",
    description: "Owns install timing, downtime budget, uptime risk",
    powerWeight: 0.8,
    vetoWeight: 0.7,
    alwaysExpected: true,
    midMarketThreshold: null,
    titleKeywords: ["plant manager", "operations manager", "operations director", "coo", "general manager", "branch manager"],
    roleHints: ["blocker", "decider"],
  },
  procurement: {
    label: "Procurement",
    description: "Drives RFP, payment terms, vendor policy",
    powerWeight: 0.55,
    vetoWeight: 0.6,
    alwaysExpected: false,
    midMarketThreshold: 150_000,
    titleKeywords: ["procurement", "purchasing", "buyer", "sourcing"],
    roleHints: ["blocker"],
  },
  operator: {
    label: "Machine Operator",
    description: "Actually runs the equipment; shapes the uptime story",
    powerWeight: 0.25,
    vetoWeight: 0.1,
    alwaysExpected: false,
    midMarketThreshold: null,
    titleKeywords: ["operator", "foreman", "lead hand", "superintendent"],
    roleHints: ["operator"],
  },
  maintenance: {
    label: "Maintenance Lead",
    description: "Judges service and parts story — kills deals on platform risk",
    powerWeight: 0.35,
    vetoWeight: 0.4,
    alwaysExpected: false,
    midMarketThreshold: 75_000,
    titleKeywords: ["maintenance", "mechanic", "shop manager", "service manager", "fleet manager"],
    roleHints: [],
  },
  executive_sponsor: {
    label: "Executive Sponsor",
    description: "Strategic approver at enterprise scale",
    powerWeight: 0.85,
    vetoWeight: 0.7,
    alwaysExpected: false,
    midMarketThreshold: 400_000,
    titleKeywords: ["ceo", "president", "managing director"],
    roleHints: ["decider"],
  },
};

const ARCHETYPE_ORDER: SeatArchetype[] = [
  "economic_buyer",
  "operations",
  "champion",
  "procurement",
  "maintenance",
  "operator",
  "executive_sponsor",
];

function normalizeTitle(title: string | null | undefined): string {
  return (title ?? "").trim().toLowerCase();
}

function slugifyName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function roleMatchScore(archetype: SeatArchetype, roles: RelationshipRole[]): number {
  const def = ARCHETYPE_DEFS[archetype];
  return roles.reduce((acc, role) => (def.roleHints.includes(role) ? acc + 1 : acc), 0);
}

function titleMatch(archetype: SeatArchetype, title: string): SeatArchetype | null {
  const def = ARCHETYPE_DEFS[archetype];
  const normalized = normalizeTitle(title);
  if (!normalized) return null;
  const hit = def.titleKeywords.some((kw) => normalized.includes(kw));
  return hit ? archetype : null;
}

/** Infer which archetype a contact most likely occupies. Title wins; role-based fallback. */
export function inferArchetypeForContact(
  contact: RelationshipMapContact,
): { archetype: SeatArchetype; confidence: ConfidenceLevel; reason: string } {
  const title = normalizeTitle(contact.title);
  if (title) {
    for (const archetype of ARCHETYPE_ORDER) {
      if (titleMatch(archetype, title)) {
        return {
          archetype,
          confidence: "high",
          reason: `Title "${contact.title}" maps to ${ARCHETYPE_DEFS[archetype].label}`,
        };
      }
    }
  }

  let best: { archetype: SeatArchetype; score: number } | null = null;
  for (const archetype of ARCHETYPE_ORDER) {
    const score = roleMatchScore(archetype, contact.roles);
    if (score > 0 && (!best || score > best.score)) {
      best = { archetype, score };
    }
  }

  if (best) {
    return {
      archetype: best.archetype,
      confidence: "medium",
      reason: `Role signal (${contact.roles.join(", ")}) aligns with ${ARCHETYPE_DEFS[best.archetype].label}`,
    };
  }

  // No strong signal. Default to champion — primary touchpoint, low confidence.
  return {
    archetype: "champion",
    confidence: "low",
    reason: "No title or role signal — defaulting to champion position",
  };
}

function stanceFromRoles(roles: RelationshipRole[]): SeatStance {
  if (roles.includes("blocker")) return "blocker";
  if (roles.includes("decider") || roles.includes("signer")) return "champion";
  if (roles.includes("influencer")) return "neutral";
  if (roles.includes("operator")) return "neutral";
  return "unknown";
}

function evidenceFromContact(contact: RelationshipMapContact, archetypeReason: string): SeatEvidence[] {
  const items: SeatEvidence[] = contact.evidence.map((label) => ({
    kind: inferEvidenceKind(label),
    label,
    occurredAt: contact.lastSignalAt,
    sourceId: contact.contactId,
  }));
  items.push({
    kind: "archetype_inference",
    label: archetypeReason,
    occurredAt: null,
    sourceId: null,
  });
  return items;
}

function inferEvidenceKind(label: string): SeatEvidence["kind"] {
  const lower = label.toLowerCase();
  if (lower.includes("signed")) return "signature";
  if (lower.includes("voice")) return "voice";
  if (lower.includes("primary contact") || lower.includes("on deal")) return "primary_contact";
  if (lower.includes("assessment") || lower.includes("decision maker")) return "needs_assessment";
  return "activity";
}

function guessEmailPattern(companyName: string | null, role: string): string | null {
  if (!companyName) return null;
  const slug = slugifyName(companyName).replace(/-/g, "");
  if (!slug) return null;
  return `firstname.lastname@${slug}.com  (likely pattern — confirm on LinkedIn)`;
}

function buildGhostGuidance(
  archetype: SeatArchetype,
  companyName: string | null,
  reason: string,
): GhostFindGuidance {
  const def = ARCHETYPE_DEFS[archetype];
  const company = companyName ?? "target company";
  return {
    reason,
    searchQuery: `site:linkedin.com "${def.label.split(" / ")[0]}" "${company}"`,
    emailHint: guessEmailPattern(companyName, def.label),
    nextStep: nextStepForArchetype(archetype),
  };
}

function nextStepForArchetype(archetype: SeatArchetype): string {
  switch (archetype) {
    case "economic_buyer":
      return "Ask champion: who signs off on capex above the rep's discretion?";
    case "operations":
      return "Ask champion: who controls the install window and downtime budget?";
    case "procurement":
      return "Ask champion: does this go through procurement for vendor approval?";
    case "maintenance":
      return "Propose a walkthrough with the maintenance lead — their sign-off reduces risk.";
    case "operator":
      return "Offer the operators a demo day. They talk to each other across jobsites.";
    case "executive_sponsor":
      return "For a deal this size, an exec sponsor signal protects the floor price.";
    case "champion":
    default:
      return "Confirm a single rep champion who will carry the deal internally.";
  }
}

function mentionSlug(name: string): string {
  return `mention:${slugifyName(name)}`;
}

export interface BuildSeatsInput {
  relationship: RelationshipMapBoard;
  needsAssessment: NeedsAssessment | null;
  companyName: string | null;
  dealAmount: number | null;
  blockerPresent: boolean;
}

export interface BuildSeatsOutput {
  seats: DecisionRoomSeat[];
  expectedArchetypes: SeatArchetype[];
}

/**
 * Build the full seat map: named from CRM contacts, ghosts from archetype gaps,
 * and named-ghost rows from unmatched stakeholder mentions.
 */
export function buildSeats(input: BuildSeatsInput): BuildSeatsOutput {
  const { relationship, needsAssessment, companyName, dealAmount, blockerPresent } = input;

  const dealSize = dealAmount ?? 0;
  const expectedArchetypes = ARCHETYPE_ORDER.filter((archetype) => {
    const def = ARCHETYPE_DEFS[archetype];
    if (def.alwaysExpected) return true;
    if (def.midMarketThreshold != null && dealSize >= def.midMarketThreshold) return true;
    return false;
  });

  const namedSeats: DecisionRoomSeat[] = [];
  const claimedArchetypes = new Set<SeatArchetype>();

  for (const contact of relationship.contacts) {
    const { archetype, confidence, reason } = inferArchetypeForContact(contact);
    const def = ARCHETYPE_DEFS[archetype];
    const stance = stanceFromRoles(contact.roles);
    namedSeats.push({
      id: `contact:${contact.contactId}`,
      status: "named",
      archetype,
      archetypeLabel: def.label,
      name: contact.name || null,
      title: contact.title,
      email: contact.email,
      phone: contact.phone,
      confidence,
      stance,
      powerWeight: def.powerWeight,
      vetoWeight: def.vetoWeight,
      evidence: evidenceFromContact(contact, reason),
      lastSignalAt: contact.lastSignalAt,
      findGuidance: null,
    });
    claimedArchetypes.add(archetype);
  }

  // Named stakeholder mentions that didn't resolve to a contact record. They
  // are "ghosts with names" — the rep heard them, they just aren't in CRM yet.
  const mentionSeats: DecisionRoomSeat[] = relationship.unmatchedStakeholders.map((name) => {
    // Mentioned humans are most often champions or economic buyers in
    // equipment deals (the rep is usually told "I need to check with…" about
    // one of those two). Default to economic_buyer when the stance is
    // explicitly the decision maker, otherwise champion.
    const nameFromAssessment = needsAssessment?.decision_maker_name?.trim();
    const isDecisionMaker = Boolean(
      nameFromAssessment && nameFromAssessment.toLowerCase() === name.toLowerCase(),
    );
    const archetype: SeatArchetype = isDecisionMaker ? "economic_buyer" : "champion";
    const def = ARCHETYPE_DEFS[archetype];
    return {
      id: mentionSlug(name),
      status: "ghost",
      archetype,
      archetypeLabel: def.label,
      name,
      title: null,
      email: null,
      phone: null,
      confidence: isDecisionMaker ? "high" : "medium",
      stance: "unknown",
      powerWeight: def.powerWeight,
      vetoWeight: def.vetoWeight,
      evidence: [{
        kind: "stakeholder_mention",
        label: isDecisionMaker
          ? `Named as decision maker in latest needs assessment`
          : `Named in voice capture or assessment but no CRM contact matches`,
        occurredAt: null,
        sourceId: null,
      }],
      lastSignalAt: null,
      findGuidance: buildGhostGuidance(
        archetype,
        companyName,
        isDecisionMaker
          ? `Assessment names ${name} as decision maker, but they aren't in CRM yet`
          : `${name} was mentioned as a stakeholder but has no CRM record`,
      ),
    };
  });

  // Archetype gap ghosts — slots the room usually has that are empty.
  const gapSeats: DecisionRoomSeat[] = [];
  for (const archetype of expectedArchetypes) {
    if (claimedArchetypes.has(archetype)) continue;
    // If a mention seat already claims this archetype, skip — that ghost is
    // partially named and better than a pure slot.
    const archClaimedByMention = mentionSeats.some((seat) => seat.archetype === archetype);
    if (archClaimedByMention) continue;

    const def = ARCHETYPE_DEFS[archetype];
    gapSeats.push({
      id: `ghost:${archetype}`,
      status: "ghost",
      archetype,
      archetypeLabel: def.label,
      name: null,
      title: null,
      email: null,
      phone: null,
      confidence: def.alwaysExpected ? "high" : "medium",
      stance: "unknown",
      powerWeight: def.powerWeight,
      vetoWeight: def.vetoWeight,
      evidence: [{
        kind: "archetype_inference",
        label: `Deals of this shape typically have a ${def.label}; no one fills this seat yet`,
        occurredAt: null,
        sourceId: null,
      }],
      lastSignalAt: null,
      findGuidance: buildGhostGuidance(
        archetype,
        companyName,
        `${def.label} is expected in equipment deals of this size; not yet identified`,
      ),
    });
  }

  // If the deal has a blocker signal but no blocker-leaning named seat, nudge
  // operations ghost confidence up (or surface as a gap if missing).
  if (blockerPresent) {
    const hasBlockerVoice = namedSeats.some((seat) => seat.stance === "blocker");
    if (!hasBlockerVoice) {
      const opsGhost = gapSeats.find((seat) => seat.archetype === "operations");
      if (opsGhost) {
        opsGhost.evidence.push({
          kind: "archetype_inference",
          label: "Deal has an active blocker signal — unseen ops voice is probable source",
          occurredAt: null,
          sourceId: null,
        });
      }
    }
  }

  // Order: named (by power), named-but-ghost mentions, archetype gaps.
  const orderedNamed = [...namedSeats].sort((a, b) => b.powerWeight - a.powerWeight);
  const orderedMentions = [...mentionSeats].sort((a, b) => b.powerWeight - a.powerWeight);
  const orderedGaps = [...gapSeats].sort((a, b) => b.powerWeight - a.powerWeight);

  return {
    seats: [...orderedNamed, ...orderedMentions, ...orderedGaps],
    expectedArchetypes,
  };
}
