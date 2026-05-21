export type DecisionRow = {
  id: string;
  code: string;
  question_plain: string;
  owner_role: string;
  recommended_option: string | null;
  recommended_rationale: string | null;
};

export type LinearIssueRef = {
  issueId: string | null;
  issueIdentifier: string | null;
  issueUrl: string | null;
  source: "decision_packet" | "roadmap_task";
  taskId?: string | null;
};

type GenericRecord = Record<string, unknown>;

function readString(record: GenericRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

export function resolveLinearIssueFromPacket(packet: unknown): Omit<LinearIssueRef, "source"> {
  if (!packet || typeof packet !== "object") {
    return { issueId: null, issueIdentifier: null, issueUrl: null };
  }

  const record = packet as GenericRecord;
  const issueId = readString(record, ["linear_issue_id", "linearIssueId", "issueId"]);
  const issueIdentifier = readString(record, [
    "linear_issue_identifier",
    "linearIssueIdentifier",
    "linear_identifier",
    "linearIdentifier",
    "issueIdentifier",
  ]);
  const issueUrl = readString(record, ["linear_issue_url", "linearUrl", "issueUrl", "linear_url"]);

  return { issueId, issueIdentifier, issueUrl };
}

export function identifierFromLinearUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const input = value.trim();
  if (!input) return null;

  try {
    const url = new URL(input);
    const parts = url.pathname.split("/").filter(Boolean);
    const issueIndex = parts.findIndex((part) => part === "issue");
    if (issueIndex < 0) return null;
    return parts[issueIndex + 1] ?? null;
  } catch {
    return null;
  }
}

export function parseOwnerMentionMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") return {};

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as GenericRecord)) {
    if (typeof value !== "string") continue;
    const owner = key.trim().toLowerCase();
    const mention = value.trim();
    if (!owner || !mention) continue;
    out[owner] = mention;
  }

  return out;
}

function clip(value: string, max = 280): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1).trimEnd()}…`;
}

export function buildRecommendationComment(input: {
  decision: DecisionRow;
  ownerMention?: string | null;
  issueRef: Pick<LinearIssueRef, "taskId" | "issueIdentifier">;
}): string {
  const lines: string[] = [];
  if (input.ownerMention) lines.push(`${input.ownerMention} recommendation ready for review.`);
  lines.push(`Decision **${input.decision.code}** requires owner action.`);
  lines.push(`Question: ${clip(input.decision.question_plain, 240)}`);
  lines.push(`Recommended option: **${input.decision.recommended_option ?? "(none set)"}**`);

  if (input.decision.recommended_rationale?.trim()) {
    lines.push(`Rationale: ${clip(input.decision.recommended_rationale, 360)}`);
  }

  const suffixBits: string[] = [];
  if (input.issueRef.taskId) suffixBits.push(`task ${input.issueRef.taskId}`);
  if (input.issueRef.issueIdentifier) suffixBits.push(`issue ${input.issueRef.issueIdentifier}`);
  if (suffixBits.length > 0) lines.push(`Context: ${suffixBits.join(" · ")}`);

  lines.push("Please approve, block, or request more info in the QEP decision inbox.");
  return lines.join("\n");
}
