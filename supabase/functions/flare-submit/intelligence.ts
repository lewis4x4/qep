/**
 * Wave 6.11 Flare — Phase F intelligence layer (server-side).
 *
 * - generateReproducerSteps: convert click_trail + route_trail into a
 *   human-readable markdown "Steps to reproduce" block
 * - detectHypothesisPattern: simple regex-based classifier over the
 *   most recent console errors
 */

interface ClickEvent {
  ts: number;
  selector: string;
  text: string | null;
  x: number;
  y: number;
}

interface RouteChange {
  ts: number;
  from: string;
  to: string;
}

interface ConsoleError {
  ts: number;
  level: string;
  message: string;
  stack: string | null;
}

export function generateReproducerSteps(
  clickTrail: Array<Record<string, unknown>>,
  routeTrail: Array<Record<string, unknown>>,
  finalRoute: string,
): string {
  const clicks = (clickTrail ?? []) as unknown as ClickEvent[];
  const routes = (routeTrail ?? []) as unknown as RouteChange[];

  // Merge + sort by timestamp
  type TimelineEvent = { ts: number; kind: "click" | "route"; data: ClickEvent | RouteChange };
  const timeline: TimelineEvent[] = [];

  for (const c of clicks) {
    if (typeof c.ts === "number") timeline.push({ ts: c.ts, kind: "click", data: c });
  }
  for (const r of routes) {
    if (typeof r.ts === "number") timeline.push({ ts: r.ts, kind: "route", data: r });
  }
  timeline.sort((a, b) => a.ts - b.ts);

  if (timeline.length === 0) {
    return `1. Navigate to \`${finalRoute}\`\n2. (no click trail captured before the report)`;
  }

  const lines: string[] = [];
  let stepNum = 1;

  // Prefix with the starting route if we have a route trail
  if (routes.length > 0) {
    lines.push(`${stepNum}. Navigate to \`${routes[0].from}\``);
    stepNum += 1;
  }

  for (const ev of timeline) {
    if (ev.kind === "route") {
      const r = ev.data as RouteChange;
      lines.push(`${stepNum}. Navigate from \`${r.from}\` → \`${r.to}\``);
      stepNum += 1;
    } else {
      const c = ev.data as ClickEvent;
      const label = c.text ? `"${c.text.slice(0, 40)}"` : `\`${c.selector.slice(0, 60)}\``;
      lines.push(`${stepNum}. Click ${label}`);
      stepNum += 1;
    }
  }

  lines.push(`${stepNum}. (Report submitted at \`${finalRoute}\`)`);

  // Cap at 30 lines
  return lines.slice(0, 30).join("\n");
}

/**
 * Best-effort hypothesis pattern detection from recent console errors.
 * Returns a short human-readable category or null when nothing obvious
 * jumps out.
 */
export function detectHypothesisPattern(
  consoleErrors: Array<Record<string, unknown>>,
): string | null {
  const errs = (consoleErrors ?? []) as unknown as ConsoleError[];
  if (errs.length === 0) return null;

  // Check the most recent 5 errors
  const recent = errs.slice(-5);
  const combined = recent.map((e) => `${e.message ?? ""} ${e.stack ?? ""}`).join("\n");

  if (/TypeError: Cannot read property|Cannot read properties of (null|undefined)/i.test(combined)) {
    return "Null/undefined access — expected data not loaded yet";
  }
  if (/NetworkError|Failed to fetch|ERR_CONNECTION|ECONNREFUSED|net::ERR/i.test(combined)) {
    return "Network failure — API endpoint unreachable or offline";
  }
  if (/row level security|RLS|permission denied|violates row-level security/i.test(combined)) {
    return "RLS policy denial — caller lacks access to a resource";
  }
  if (/duplicate key|unique constraint/i.test(combined)) {
    return "Unique constraint violation — likely race or retry bug";
  }
  if (/SyntaxError|JSON\.parse/i.test(combined)) {
    return "Parse error — malformed response or input";
  }
  if (/401|unauthorized|Invalid JWT|token expired/i.test(combined)) {
    return "Auth failure — session expired or JWT invalid";
  }
  if (/500 Internal Server Error|Internal server error/i.test(combined)) {
    return "Server 500 — upstream edge function or DB error";
  }
  if (/Maximum update depth|infinite loop|too much recursion/i.test(combined)) {
    return "React render loop — component re-renders without termination";
  }

  return null;
}
