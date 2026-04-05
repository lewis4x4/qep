/**
 * Suggest appointment start times from branch business_hours + slot length.
 * Auth: user JWT (internal staff).
 */
import { parseJsonBody } from "../_shared/parse-json-body.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

interface WeekdayRule {
  dow: number;
  open: string;
  close: string;
}

function parseHm(s: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, m: min };
}

function minutesSinceMidnight(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function setUtcTime(d: Date, h: number, m: number): Date {
  const x = new Date(d);
  x.setUTCHours(h, m, 0, 0);
  return x;
}

/** JS: Monday=1 .. Sunday=0 from getUTCDay() Sunday=0, Monday=1 — map Monday=1..Friday=5 */
function businessDow(utcDay: number): number {
  return utcDay === 0 ? 7 : utcDay;
}

function collectSlots(
  rules: WeekdayRule[],
  slotMinutes: number,
  from: Date,
  count: number,
): string[] {
  const byDow = new Map<number, WeekdayRule>();
  for (const r of rules) {
    if (r.dow >= 1 && r.dow <= 7) byDow.set(r.dow, r);
  }
  const out: string[] = [];
  const day = new Date(from);
  day.setUTCHours(0, 0, 0, 0);
  for (let add = 0; add < 21 && out.length < count; add++) {
    const cur = new Date(day);
    cur.setUTCDate(day.getUTCDate() + add);
    const dow = businessDow(cur.getUTCDay());
    const rule = byDow.get(dow);
    if (!rule) continue;
    const o = parseHm(rule.open);
    const c = parseHm(rule.close);
    if (!o || !c) continue;
    let t = minutesSinceMidnight(setUtcTime(cur, o.h, o.m));
    const endM = minutesSinceMidnight(setUtcTime(cur, c.h, c.m));
    if (endM <= t) continue;
    while (t + slotMinutes <= endM && out.length < count) {
      const slotStart = new Date(cur);
      slotStart.setUTCHours(Math.floor(t / 60), t % 60, 0, 0);
      if (slotStart.getTime() >= from.getTime()) {
        out.push(slotStart.toISOString());
      }
      t += slotMinutes;
    }
  }
  return out;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;
    const supabase = auth.supabase;

    if (req.method !== "POST") {
      return safeJsonError("POST required", 405, origin);
    }

    const parsed = await parseJsonBody(req, origin);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as {
      branch_id?: string;
      from?: string;
      count?: number;
    };
    if (!body.branch_id?.trim()) {
      return safeJsonError("branch_id required", 400, origin);
    }

    const { data: cfg, error } = await supabase
      .from("service_branch_config")
      .select("business_hours, appointment_slot_minutes")
      .eq("branch_id", body.branch_id.trim())
      .maybeSingle();

    if (error) return safeJsonError(error.message, 500, origin);
    if (!cfg) {
      return safeJsonError("Unknown branch_id", 404, origin);
    }

    const slotMinutes = Math.max(
      15,
      Math.min(480, Number(cfg.appointment_slot_minutes) || 60),
    );
    const bh = cfg.business_hours as { weekdays?: WeekdayRule[] } | null;
    const rules = Array.isArray(bh?.weekdays) ? bh!.weekdays as WeekdayRule[] : [];

    const from = body.from ? new Date(body.from) : new Date();
    const count = Math.min(48, Math.max(1, Number(body.count) || 16));

    const slots = collectSlots(rules, slotMinutes, from, count);

    return safeJsonOk(
      {
        branch_id: body.branch_id.trim(),
        slot_minutes: slotMinutes,
        slots,
      },
      origin,
    );
  } catch (err) {
    console.error("service-calendar-slots:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("Origin"));
  }
});
