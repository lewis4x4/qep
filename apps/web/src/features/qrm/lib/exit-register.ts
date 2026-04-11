import { buildAccountCommandHref, buildAccountTimelineHref } from "./account-command";

export type ExitRegisterConfidence = "high" | "medium" | "low";

export interface ExitLifecycleSignal {
  companyId: string | null;
  companyName: string | null;
  eventType: string;
  eventAt: string;
  sourceTable: string | null;
}

export interface ExitLostDealSignal {
  companyId: string | null;
  companyName: string | null;
  dealId: string;
  dealName: string;
  closedAt: string;
  lossReason: string | null;
  competitor: string | null;
}

export interface ExitRegisterRow {
  companyId: string;
  companyName: string;
  state: "churn_risk" | "lost" | "won_back";
  confidence: ExitRegisterConfidence;
  latestEventAt: string | null;
  trace: string[];
  primaryHref: string;
  secondaryHref: string;
}

export interface ExitRegisterBoard {
  summary: {
    accounts: number;
    churnRisk: number;
    lost: number;
    wonBack: number;
  };
  rows: ExitRegisterRow[];
}

function parseTime(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function latest(a: string | null | undefined, b: string | null | undefined): string | null {
  return parseTime(a) >= parseTime(b) ? (a ?? null) : (b ?? null);
}

export function buildExitRegisterBoard(input: {
  lifecycleSignals: ExitLifecycleSignal[];
  lostDeals: ExitLostDealSignal[];
}): ExitRegisterBoard {
  const grouped = new Map<string, {
    companyName: string;
    churnRisk: number;
    lostEvents: number;
    wonBack: number;
    latestEventAt: string | null;
    lossReasons: string[];
    competitors: string[];
    sourceTables: string[];
    lostDeals: number;
  }>();

  const ensure = (companyId: string, companyName: string | null) => {
    const existing = grouped.get(companyId);
    if (existing) return existing;
    const created = {
      companyName: companyName ?? "Account",
      churnRisk: 0,
      lostEvents: 0,
      wonBack: 0,
      latestEventAt: null as string | null,
      lossReasons: [] as string[],
      competitors: [] as string[],
      sourceTables: [] as string[],
      lostDeals: 0,
    };
    grouped.set(companyId, created);
    return created;
  };

  for (const signal of input.lifecycleSignals) {
    if (!signal.companyId) continue;
    const row = ensure(signal.companyId, signal.companyName);
    if (signal.eventType === "churn_risk_flag") row.churnRisk += 1;
    if (signal.eventType === "lost") row.lostEvents += 1;
    if (signal.eventType === "won_back") row.wonBack += 1;
    row.latestEventAt = latest(row.latestEventAt, signal.eventAt);
    if (signal.sourceTable && !row.sourceTables.includes(signal.sourceTable)) {
      row.sourceTables.push(signal.sourceTable);
    }
  }

  for (const deal of input.lostDeals) {
    if (!deal.companyId) continue;
    const row = ensure(deal.companyId, deal.companyName);
    row.lostDeals += 1;
    row.latestEventAt = latest(row.latestEventAt, deal.closedAt);
    if (deal.lossReason && !row.lossReasons.includes(deal.lossReason)) {
      row.lossReasons.push(deal.lossReason);
    }
    if (deal.competitor && !row.competitors.includes(deal.competitor)) {
      row.competitors.push(deal.competitor);
    }
  }

  const rows = [...grouped.entries()]
    .map(([companyId, row]) => {
      let state: ExitRegisterRow["state"] = "churn_risk";
      if (row.wonBack > 0 && row.lostEvents === 0 && row.lostDeals === 0) {
        state = "won_back";
      } else if (row.lostEvents > 0 || row.lostDeals > 0) {
        state = "lost";
      }

      const confidence: ExitRegisterConfidence =
        state === "lost"
          ? "high"
          : state === "churn_risk"
            ? "medium"
            : "low";

      return {
        companyId,
        companyName: row.companyName,
        state,
        confidence,
        latestEventAt: row.latestEventAt,
        trace: [
          `${row.churnRisk} churn-risk flag${row.churnRisk === 1 ? "" : "s"} · ${row.lostDeals} closed-lost deal${row.lostDeals === 1 ? "" : "s"} · ${row.wonBack} won-back event${row.wonBack === 1 ? "" : "s"}.`,
          row.lossReasons.length > 0
            ? `Latest loss themes: ${row.lossReasons.slice(0, 2).join(", ")}.`
            : "No explicit loss reason is recorded.",
          row.competitors.length > 0
            ? `Competitors mentioned: ${row.competitors.slice(0, 2).join(", ")}.`
            : "No competitor was recorded on current exit signals.",
          row.latestEventAt ? `Latest exit marker: ${formatDate(row.latestEventAt)}.` : "No dated exit marker is recorded.",
        ],
        primaryHref: buildAccountTimelineHref(companyId),
        secondaryHref: buildAccountCommandHref(companyId),
      } satisfies ExitRegisterRow;
    })
    .sort((a, b) => {
      const weight = { lost: 3, churn_risk: 2, won_back: 1 };
      if (weight[b.state] !== weight[a.state]) return weight[b.state] - weight[a.state];
      return parseTime(b.latestEventAt) - parseTime(a.latestEventAt);
    });

  return {
    summary: {
      accounts: rows.length,
      churnRisk: rows.filter((row) => row.state === "churn_risk").length,
      lost: rows.filter((row) => row.state === "lost").length,
      wonBack: rows.filter((row) => row.state === "won_back").length,
    },
    rows,
  };
}
