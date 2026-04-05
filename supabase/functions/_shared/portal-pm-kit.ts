/**
 * Portal PM kit suggestions: ground truth from job_codes.parts_template,
 * optional LLM for narrative only (never invent SKUs).
 */

export type PortalPmLineItem = {
  part_number: string;
  description?: string;
  quantity: number;
  unit_price?: number;
  is_ai_suggested: boolean;
};

export type CustomerFleetRow = {
  id: string;
  make: string;
  model: string;
  serial_number?: string | null;
  current_hours?: number | null;
  next_service_due?: string | null;
  service_interval_hours?: number | null;
};

export type JobCodePmRow = {
  id: string;
  job_name: string;
  make: string;
  model_family: string | null;
  parts_template: unknown;
  common_add_ons: unknown;
  confidence_score: number | null;
};

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Convert job_codes template JSON to portal line_items (same semantics as service-job-router). */
export function templateToPortalLineItems(
  tpl: unknown,
  isAiSuggested: boolean,
): PortalPmLineItem[] {
  const out: PortalPmLineItem[] = [];
  if (!tpl || !Array.isArray(tpl)) return out;
  for (const item of tpl) {
    if (typeof item === "string") {
      const pn = item.trim();
      if (!pn) continue;
      out.push({
        part_number: pn,
        quantity: 1,
        is_ai_suggested: isAiSuggested,
      });
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const pn = String(o.part_number ?? o.partNumber ?? o.sku ?? "").trim();
      if (!pn) continue;
      const qty = Math.max(1, Math.floor(Number(o.quantity ?? o.qty ?? 1)) || 1);
      const line: PortalPmLineItem = {
        part_number: pn,
        quantity: qty,
        is_ai_suggested: isAiSuggested,
      };
      if (o.description != null) line.description = String(o.description);
      if (o.unit_price != null && Number.isFinite(Number(o.unit_price))) {
        line.unit_price = Number(o.unit_price);
      }
      out.push(line);
    }
  }
  return out;
}

function mergeDedupeLines(primary: PortalPmLineItem[], secondary: PortalPmLineItem[]): PortalPmLineItem[] {
  const seen = new Set<string>();
  const merged: PortalPmLineItem[] = [];
  for (const line of [...primary, ...secondary]) {
    const key = `${norm(line.part_number)}:${line.quantity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(line);
  }
  return merged;
}

export function buildPmKitLinesFromJobCode(jc: JobCodePmRow): PortalPmLineItem[] {
  const main = templateToPortalLineItems(jc.parts_template, true);
  const addOns = templateToPortalLineItems(jc.common_add_ons, true);
  return mergeDedupeLines(main, addOns);
}

/** Higher = better match for fleet equipment. */
export function scoreJobCodeForFleet(jc: JobCodePmRow, fleet: CustomerFleetRow): number {
  let score = Number(jc.confidence_score ?? 0.5);
  const mk = norm(jc.make);
  const fk = norm(fleet.make);
  if (mk === fk) score += 2;
  else if (mk.includes(fk) || fk.includes(mk)) score += 1;

  const model = norm(fleet.model);
  const mf = jc.model_family ? norm(jc.model_family) : "";
  if (mf && (model.includes(mf) || mf.includes(model) || model === mf)) {
    score += 2;
  }
  return score;
}

type LlmReasonResult = { customer_reason: string };

/** Narrative only — parts list is always from job_codes (never invented). */
export async function explainPmKitWithLlm(
  apiKey: string | undefined,
  fleet: CustomerFleetRow,
  chosen: JobCodePmRow,
  lineItems: PortalPmLineItem[],
): Promise<string | null> {
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.25,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You write short customer-facing copy for a dealership parts portal. " +
              "Given equipment context and an already-selected PM kit (part numbers are fixed — do not add or change SKUs), " +
              "output JSON: { \"customer_reason\": string } with exactly 2 sentences: why this kit matters for uptime/maintenance, " +
              "and that they should confirm fitment with the dealer. Professional, concise.",
          },
          {
            role: "user",
            content: JSON.stringify({
              fleet: {
                make: fleet.make,
                model: fleet.model,
                serial_number: fleet.serial_number,
                current_hours: fleet.current_hours,
                next_service_due: fleet.next_service_due,
                service_interval_hours: fleet.service_interval_hours,
              },
              matched_job: {
                job_name: chosen.job_name,
                make: chosen.make,
                model_family: chosen.model_family,
              },
              kit_lines: lineItems.map((l) => ({
                part_number: l.part_number,
                quantity: l.quantity,
              })),
            }),
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content as string | undefined;
    if (!text) return null;
    const parsed = JSON.parse(text) as LlmReasonResult;
    const r = parsed.customer_reason?.trim();
    return r ? r.slice(0, 2000) : null;
  } catch (e) {
    console.warn("portal-pm-kit LLM:", e);
    return null;
  }
}

/** Normalize customer-supplied line_items for insert (no trust). */
export function sanitizePortalLineItemsForOrder(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const out: Record<string, unknown>[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const part_number = String(o.part_number ?? "").trim();
    if (!part_number) continue;
    const quantity = Math.max(1, Math.floor(Number(o.quantity ?? 1)) || 1);
    const line: Record<string, unknown> = { part_number, quantity };
    if (o.description != null) line.description = String(o.description).slice(0, 500);
    if (o.unit_price != null && Number.isFinite(Number(o.unit_price))) {
      line.unit_price = Number(o.unit_price);
    }
    if (o.is_ai_suggested === true) line.is_ai_suggested = true;
    out.push(line);
  }
  return out;
}

export function deterministicPmReason(fleet: CustomerFleetRow, jc: JobCodePmRow, lineCount: number): string {
  const modelNote = jc.model_family
    ? ` (${jc.model_family} family)`
    : "";
  return (
    `We matched your ${fleet.make} ${fleet.model}${modelNote} to service job "${jc.job_name}" and loaded the dealership PM template (${lineCount} line${lineCount === 1 ? "" : "s"}). ` +
    `Review quantities and confirm with your parts counter before submitting.`
  );
}
