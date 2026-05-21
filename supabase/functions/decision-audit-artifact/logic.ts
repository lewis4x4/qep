export type AuditGrade = "auto" | "ratify" | "authorize";
export type ArtifactKind = "row" | "html" | "pdf";

export type DecisionRow = {
  id: string;
  code: string;
  question_plain: string;
  lane: string;
  owner_role: string;
  requires_two_sigs: string[] | null;
  options: unknown;
  recommended_option: string | null;
  recommended_rationale: string | null;
  ai_prep_packet: unknown;
  citations: unknown;
  reversal_cost: string | null;
  status: string;
  answered_by: string | null;
  answered_at: string | null;
  answered_option: string | null;
  answered_rationale: string | null;
  audit_url?: string | null;
  created_at: string;
  updated_at: string;
};

export type AuthorizationRow = {
  id: string;
  signer_role: string;
  signer_name: string;
  signer_email: string | null;
  signature_hash: string;
  terms_version: string;
  signed_at: string;
  metadata: unknown;
  revoked_at: string | null;
};

export type AuditArtifactPlan = {
  auditGrade: AuditGrade;
  artifactKind: ArtifactKind;
  contentType: string | null;
  extension: string | null;
  retentionUntil: string | null;
};

export type Citation = {
  source: string;
  ref: string | null;
  excerpt: string;
};

export type DecisionOption = {
  label: string;
  description: string | null;
  implication: string | null;
  isRecommended: boolean;
};

const encoder = new TextEncoder();
const RESOLVED_STATUSES = new Set(["answered", "shadow_ship", "superseded"]);

export function isResolvedDecisionStatus(status: string): boolean {
  return RESOLVED_STATUSES.has(status.trim().toLowerCase());
}

export function deriveAuditArtifactPlan(
  decision: Pick<DecisionRow, "lane">,
  generatedAt: Date,
): AuditArtifactPlan {
  const auditGrade = normalizeLane(decision.lane);
  if (auditGrade === "auto") {
    return {
      auditGrade,
      artifactKind: "row",
      contentType: null,
      extension: null,
      retentionUntil: null,
    };
  }

  if (auditGrade === "ratify") {
    return {
      auditGrade,
      artifactKind: "html",
      contentType: "text/html; charset=utf-8",
      extension: "html",
      retentionUntil: null,
    };
  }

  return {
    auditGrade,
    artifactKind: "pdf",
    contentType: "application/pdf",
    extension: "pdf",
    retentionUntil: addYears(generatedAt, 7).toISOString(),
  };
}

export function buildDecisionAuditStorageKey(input: {
  decision: Pick<DecisionRow, "id" | "code">;
  plan: Pick<AuditArtifactPlan, "auditGrade" | "extension">;
  generatedAt: Date;
}): string | null {
  if (!input.plan.extension) return null;
  const code = slug(input.decision.code || input.decision.id);
  const stamp = input.generatedAt.toISOString().replace(/[:.]/g, "-");
  return `qep-decisions/${input.plan.auditGrade}/${code}/${stamp}.${input.plan.extension}`;
}

export function renderDecisionCardHtml(input: {
  decision: DecisionRow;
  authorizations?: AuthorizationRow[];
  generatedAt: Date;
}): string {
  const { decision, generatedAt } = input;
  const citations = normalizeCitations(decision.citations);
  const options = normalizeOptions(decision.options);
  const authorizations = (input.authorizations ?? []).filter((row) =>
    !row.revoked_at
  );

  const optionList = options.length
    ? `<ol>${
      options.map((option) =>
        `<li><strong>${escapeHtml(option.label)}</strong>${
          option.isRecommended ? " <em>(recommended)</em>" : ""
        }${option.description ? ` — ${escapeHtml(option.description)}` : ""}${
          option.implication
            ? `<br/><span>${escapeHtml(option.implication)}</span>`
            : ""
        }</li>`
      ).join("")
    }</ol>`
    : "<p>No options captured.</p>";

  const citationList = citations.length
    ? `<ol>${
      citations.map((citation) =>
        `<li><strong>${escapeHtml(citation.source)}</strong>${
          citation.ref ? ` · ${escapeHtml(citation.ref)}` : ""
        }<br/>${escapeHtml(citation.excerpt)}</li>`
      ).join("")
    }</ol>`
    : "<p>No citations captured.</p>";

  const signatureList = authorizations.length
    ? `<ol>${
      authorizations.map((auth) =>
        `<li><strong>${escapeHtml(auth.signer_name)}</strong> (${
          escapeHtml(auth.signer_role)
        })${
          auth.signer_email ? ` · ${escapeHtml(auth.signer_email)}` : ""
        }<br/>Signed: ${escapeHtml(auth.signed_at)} · Terms: ${
          escapeHtml(auth.terms_version)
        }<br/>Signature hash: ${escapeHtml(auth.signature_hash)}</li>`
      ).join("")
    }</ol>`
    : "<p>No active signature evidence captured.</p>";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>QEP Decision Audit ${escapeHtml(decision.code)}</title>
  </head>
  <body style="font-family: Arial, sans-serif; color: #111827; line-height: 1.45;">
    <main style="max-width: 760px; margin: 0 auto; padding: 24px; border: 1px solid #d1d5db; border-radius: 14px;">
      <p style="text-transform: uppercase; letter-spacing: .08em; color: #6b7280; margin: 0 0 8px;">QEP decision audit snapshot</p>
      <h1 style="margin: 0 0 12px;">${escapeHtml(decision.code)}</h1>
      <p><strong>Question:</strong> ${escapeHtml(decision.question_plain)}</p>
      <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
        ${tableRow("Lane", decision.lane)}
        ${tableRow("Status", decision.status)}
        ${tableRow("Owner role", decision.owner_role)}
        ${tableRow("Created", decision.created_at)}
        ${tableRow("Answered at", decision.answered_at ?? "n/a")}
        ${tableRow("Answered by", decision.answered_by ?? "n/a")}
        ${tableRow("Generated at", generatedAt.toISOString())}
      </table>
      <h2>Decision card</h2>
      <p><strong>Recommended option:</strong> ${
    escapeHtml(decision.recommended_option ?? "n/a")
  }</p>
      <p><strong>Recommended rationale:</strong> ${
    escapeHtml(decision.recommended_rationale ?? "n/a")
  }</p>
      <p><strong>Answered option:</strong> ${
    escapeHtml(decision.answered_option ?? "n/a")
  }</p>
      <p><strong>Answered rationale:</strong> ${
    escapeHtml(decision.answered_rationale ?? "n/a")
  }</p>
      <p><strong>Reversal cost:</strong> ${
    escapeHtml(decision.reversal_cost ?? "n/a")
  }</p>
      <h2>Options</h2>
      ${optionList}
      <h2>Citations</h2>
      ${citationList}
      <h2>Authorization signature evidence</h2>
      ${signatureList}
    </main>
  </body>
</html>`;
}

export function renderAuthorizePdfBytes(input: {
  decision: DecisionRow;
  authorizations: AuthorizationRow[];
  generatedAt: Date;
}): Uint8Array {
  const lines = buildPdfTextLines(input);
  return buildMinimalTextPdf(lines);
}

export function missingRequiredAuthorizeSignerRoles(
  decision: Pick<DecisionRow, "requires_two_sigs" | "owner_role">,
  authorizations: AuthorizationRow[],
): string[] {
  const required = normalizeRequiredSignerRoles(decision);
  const signed = new Set(
    authorizations
      .filter((row) => !row.revoked_at)
      .map((row) => row.signer_role.trim())
      .filter(Boolean),
  );
  return required.filter((role) => !signed.has(role));
}

export function buildPdfTextLines(input: {
  decision: DecisionRow;
  authorizations: AuthorizationRow[];
  generatedAt: Date;
}): string[] {
  const { decision, generatedAt } = input;
  const citations = normalizeCitations(decision.citations);
  const authorizations = input.authorizations.filter((row) => !row.revoked_at);
  const lines: string[] = [
    `QEP AUTHORIZE Decision Audit: ${decision.code}`,
    `Generated at: ${generatedAt.toISOString()}`,
    `Decision ID: ${decision.id}`,
    `Lane: ${decision.lane}`,
    `Status: ${decision.status}`,
    `Owner role: ${decision.owner_role}`,
    `Question: ${decision.question_plain}`,
    `Recommended option: ${decision.recommended_option ?? "n/a"}`,
    `Recommended rationale: ${decision.recommended_rationale ?? "n/a"}`,
    `Answered option: ${decision.answered_option ?? "n/a"}`,
    `Answered rationale: ${decision.answered_rationale ?? "n/a"}`,
    `Answered by: ${decision.answered_by ?? "n/a"}`,
    `Answered at: ${decision.answered_at ?? "n/a"}`,
    "",
    "Citations:",
  ];

  if (citations.length === 0) {
    lines.push("- No citations captured.");
  } else {
    citations.forEach((citation, index) => {
      lines.push(
        `- ${index + 1}. ${citation.source}${
          citation.ref ? ` (${citation.ref})` : ""
        }: ${citation.excerpt}`,
      );
    });
  }

  lines.push("", "Authorization signature evidence:");
  if (authorizations.length === 0) {
    lines.push("- No active signature evidence captured.");
  } else {
    authorizations.forEach((auth, index) => {
      lines.push(
        `- ${
          index + 1
        }. ${auth.signer_name} (${auth.signer_role}) signed at ${auth.signed_at}; terms ${auth.terms_version}; signature hash ${auth.signature_hash}`,
      );
      if (auth.signer_email) lines.push(`  Email: ${auth.signer_email}`);
    });
  }

  return wrapLines(lines, 92).slice(0, 58);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const stableBytes = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stableBytes.buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function normalizeCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) return [];
  const rows: Citation[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const source = readString(record, ["source", "kind", "type"]) ?? "citation";
    const ref = readString(record, ["ref", "reference", "url", "path"]);
    const excerpt =
      readString(record, ["excerpt", "text", "summary", "quote"]) ??
        JSON.stringify(record);
    rows.push({ source, ref, excerpt });
  }
  return rows;
}

export function normalizeOptions(value: unknown): DecisionOption[] {
  if (!Array.isArray(value)) return [];
  const rows: DecisionOption[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const label = readString(record, ["label", "option", "value"]);
    if (!label) continue;
    rows.push({
      label,
      description: readString(record, ["description", "summary"]),
      implication: readString(record, ["implication", "impact"]),
      isRecommended: record.is_recommended === true ||
        record.isRecommended === true,
    });
  }
  return rows;
}

function normalizeLane(value: string): AuditGrade {
  const lane = value.trim().toLowerCase();
  if (lane === "auto" || lane === "ratify" || lane === "authorize") return lane;
  throw new Error(`Unsupported decision lane: ${value}`);
}

function normalizeRequiredSignerRoles(
  decision: Pick<DecisionRow, "requires_two_sigs" | "owner_role">,
): string[] {
  const rawRoles = decision.requires_two_sigs?.length
    ? decision.requires_two_sigs
    : [decision.owner_role];
  return Array.from(
    new Set(rawRoles.map((role) => role.trim()).filter(Boolean)),
  ).sort();
}

function tableRow(label: string, value: string): string {
  return `<tr><th style="text-align:left;border-top:1px solid #e5e7eb;padding:8px;width:160px;">${
    escapeHtml(label)
  }</th><td style="border-top:1px solid #e5e7eb;padding:8px;">${
    escapeHtml(value)
  }</td></tr>`;
}

function readString(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function addYears(date: Date, years: number): Date {
  const next = new Date(date.getTime());
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

function slug(value: string): string {
  const out = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(
    /^-+|-+$/g,
    "",
  );
  return out || "decision";
}

function wrapLines(lines: string[], width: number): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const clean = line.replace(/\s+/g, " ").trim();
    if (!clean) {
      out.push("");
      continue;
    }
    let rest = clean;
    while (rest.length > width) {
      const cut = rest.lastIndexOf(" ", width);
      const idx = cut > 24 ? cut : width;
      out.push(rest.slice(0, idx).trimEnd());
      rest = rest.slice(idx).trimStart();
    }
    out.push(rest);
  }
  return out;
}

function buildMinimalTextPdf(lines: string[]): Uint8Array {
  const contentLines = ["BT", "/F1 10 Tf", "48 744 Td", "12 TL"];
  for (const line of lines) {
    contentLines.push(`(${escapePdfLiteral(toPdfAscii(line))}) Tj`, "T*");
  }
  contentLines.push("ET");
  const stream = `${contentLines.join("\n")}\n`;

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${
      encoder.encode(stream).length
    } >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n% QEP decision audit artifact\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(encoder.encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = encoder.encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${
    objects.length + 1
  } /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(pdf);
}

function toPdfAscii(value: string): string {
  return value.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "?");
}

function escapePdfLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(
    /\)/g,
    "\\)",
  );
}
