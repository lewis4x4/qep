import type { ExtractedDealData } from "@/lib/voice-capture-extraction.types";

export type RelationshipRole = "signer" | "decider" | "influencer" | "operator" | "blocker";

export interface RelationshipContactInput {
  id: string;
  firstName: string;
  lastName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
}

export interface RelationshipDealInput {
  id: string;
  name: string;
  primaryContactId: string | null;
}

export interface RelationshipAssessmentInput {
  contactId: string | null;
  decisionMakerName: string | null;
  isDecisionMaker: boolean | null;
  createdAt: string;
}

export interface RelationshipVoiceInput {
  linkedContactId: string | null;
  createdAt: string;
  extractedData: ExtractedDealData | null;
}

export interface RelationshipSignatureInput {
  dealId: string | null;
  signerName: string;
  signerEmail: string | null;
  signedAt: string;
}

export interface RelationshipMapContact {
  contactId: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  roles: RelationshipRole[];
  evidence: string[];
  lastSignalAt: string | null;
}

export interface RelationshipMapBoard {
  summary: {
    contacts: number;
    signers: number;
    deciders: number;
    influencers: number;
    operators: number;
    blockers: number;
  };
  contacts: RelationshipMapContact[];
  unmatchedStakeholders: string[];
}

function normalize(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function fullName(contact: RelationshipContactInput): string {
  return `${contact.firstName} ${contact.lastName}`.trim();
}

function parseTime(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pushUnique(list: string[], value: string | null | undefined) {
  if (!value) return;
  const trimmed = value.trim();
  if (!trimmed) return;
  if (!list.includes(trimmed)) list.push(trimmed);
}

function addRole(target: RelationshipMapContact, role: RelationshipRole, evidence: string, occurredAt: string | null) {
  if (!target.roles.includes(role)) target.roles.push(role);
  pushUnique(target.evidence, evidence);
  if (!target.lastSignalAt || parseTime(occurredAt) > parseTime(target.lastSignalAt)) {
    target.lastSignalAt = occurredAt;
  }
}

function matchContactByName(
  name: string | null | undefined,
  contacts: RelationshipContactInput[],
): RelationshipContactInput | null {
  const normalizedName = normalize(name);
  if (!normalizedName) return null;
  return contacts.find((contact) => normalize(fullName(contact)) === normalizedName) ?? null;
}

function roleFromDecisionStatus(value: string | null | undefined): RelationshipRole | null {
  switch (normalize(value)) {
    case "decision_maker":
      return "decider";
    case "influencer":
      return "influencer";
    case "operator":
      return "operator";
    case "gatekeeper":
      return "blocker";
    default:
      return null;
  }
}

export function buildRelationshipMapBoard(input: {
  contacts: RelationshipContactInput[];
  deals: RelationshipDealInput[];
  assessments: RelationshipAssessmentInput[];
  voiceSignals: RelationshipVoiceInput[];
  signatures: RelationshipSignatureInput[];
}): RelationshipMapBoard {
  const contactsById = new Map<string, RelationshipMapContact>();
  const contactsByEmail = new Map<string, RelationshipContactInput>();

  for (const contact of input.contacts) {
    const row: RelationshipMapContact = {
      contactId: contact.id,
      name: fullName(contact),
      title: contact.title,
      email: contact.email,
      phone: contact.phone,
      roles: [],
      evidence: [],
      lastSignalAt: null,
    };
    contactsById.set(contact.id, row);
    const email = normalize(contact.email);
    if (email) contactsByEmail.set(email, contact);
  }

  const unmatchedStakeholders: string[] = [];

  for (const deal of input.deals) {
    if (!deal.primaryContactId) continue;
    const contact = contactsById.get(deal.primaryContactId);
    if (!contact) continue;
    addRole(contact, "influencer", `Primary contact on deal: ${deal.name}`, null);
  }

  for (const assessment of input.assessments) {
    const linked = assessment.contactId ? contactsById.get(assessment.contactId) : null;
    if (assessment.isDecisionMaker === true && linked) {
      addRole(linked, "decider", "Marked as decision maker in needs assessment", assessment.createdAt);
    }
    if (assessment.decisionMakerName) {
      const named = matchContactByName(assessment.decisionMakerName, input.contacts);
      if (named) {
        const contact = contactsById.get(named.id);
        if (contact) {
          addRole(contact, "decider", `Named decision maker: ${assessment.decisionMakerName}`, assessment.createdAt);
        }
      } else {
        pushUnique(unmatchedStakeholders, assessment.decisionMakerName);
      }
    }
  }

  for (const signal of input.voiceSignals) {
    const linked = signal.linkedContactId ? contactsById.get(signal.linkedContactId) : null;
    const role = roleFromDecisionStatus(signal.extractedData?.record.decisionMakerStatus);
    const contactName = signal.extractedData?.record.contactName ?? null;
    const named = matchContactByName(contactName, input.contacts);
    const target =
      linked ??
      (named ? contactsById.get(named.id) ?? null : null);

    if (role && target) {
      addRole(target, role, `Voice capture labeled ${role}`, signal.createdAt);
    } else if (role && contactName) {
      pushUnique(unmatchedStakeholders, contactName);
    }

    for (const stakeholder of signal.extractedData?.record.additionalStakeholders ?? []) {
      const matched = matchContactByName(stakeholder, input.contacts);
      if (!matched) {
        pushUnique(unmatchedStakeholders, stakeholder);
      }
    }
  }

  for (const signature of input.signatures) {
    const emailMatch = normalize(signature.signerEmail)
      ? contactsByEmail.get(normalize(signature.signerEmail)!)
      : null;
    const nameMatch = matchContactByName(signature.signerName, input.contacts);
    const matched = emailMatch ?? nameMatch;
    if (!matched) {
      pushUnique(unmatchedStakeholders, signature.signerName);
      continue;
    }
    const target = contactsById.get(matched.id);
    if (!target) continue;
    addRole(target, "signer", `Signed quote as ${signature.signerName}`, signature.signedAt);
  }

  const contacts = [...contactsById.values()].filter((contact) => contact.roles.length > 0);
  const roleWeight: Record<RelationshipRole, number> = {
    signer: 5,
    decider: 4,
    blocker: 3,
    influencer: 2,
    operator: 1,
  };

  contacts.sort((a, b) => {
    const aScore = a.roles.reduce((sum, role) => sum + roleWeight[role], 0);
    const bScore = b.roles.reduce((sum, role) => sum + roleWeight[role], 0);
    if (bScore !== aScore) return bScore - aScore;
    return parseTime(b.lastSignalAt) - parseTime(a.lastSignalAt);
  });

  return {
    summary: {
      contacts: contacts.length,
      signers: contacts.filter((contact) => contact.roles.includes("signer")).length,
      deciders: contacts.filter((contact) => contact.roles.includes("decider")).length,
      influencers: contacts.filter((contact) => contact.roles.includes("influencer")).length,
      operators: contacts.filter((contact) => contact.roles.includes("operator")).length,
      blockers: contacts.filter((contact) => contact.roles.includes("blocker")).length,
    },
    contacts,
    unmatchedStakeholders,
  };
}
