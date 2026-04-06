/**
 * Iron Manager — pipeline health by rep (21-step swim lanes: pre / close / post).
 * Punch list: "Pipeline health: query all deals grouped by assigned_to, show per-rep stage distribution and velocity"
 */

export type PipelineDealRow = {
  id: string;
  stage_id: string;
  amount: number | null;
  assigned_rep_id: string | null;
  last_activity_at: string | null;
};

export type DealStageRow = { id: string; sort_order: number; name: string };

export type RepProfileRow = { id: string; full_name: string | null; email: string | null };

export type PipelineHealthRow = {
  repKey: string;
  displayName: string;
  preSale: number;
  close: number;
  postSale: number;
  dealCount: number;
  totalValue: number;
  /** Average whole days since last activity across this rep's sampled deals (velocity signal). */
  avgDaysIdle: number | null;
};

function bucketForSortOrder(sort: number | undefined): "pre" | "close" | "post" {
  if (sort === undefined || !Number.isFinite(sort)) return "pre";
  if (sort <= 12) return "pre";
  if (sort <= 16) return "close";
  return "post";
}

function repDisplayName(repKey: string, profiles: Map<string, RepProfileRow>): string {
  if (repKey === "__unassigned__") return "Unassigned";
  const p = profiles.get(repKey);
  const name = p?.full_name?.trim();
  if (name) return name;
  const em = p?.email?.trim();
  if (em) return em;
  return "Advisor";
}

export function buildPipelineHealthByRep(
  deals: PipelineDealRow[],
  stages: DealStageRow[],
  repProfiles: RepProfileRow[],
): PipelineHealthRow[] {
  const sortByStageId = new Map<string, number>();
  for (const s of stages) {
    sortByStageId.set(s.id, s.sort_order);
  }

  const profileMap = new Map(repProfiles.map((p) => [p.id, p]));

  type Agg = {
    pre: number;
    close: number;
    post: number;
    value: number;
    idleDaysSum: number;
    idleCount: number;
  };

  const byRep = new Map<string, Agg>();

  const now = Date.now();

  for (const d of deals) {
    const repKey = d.assigned_rep_id ?? "__unassigned__";
    const sort = sortByStageId.get(d.stage_id);
    const bucket = bucketForSortOrder(sort);

    let agg = byRep.get(repKey);
    if (!agg) {
      agg = { pre: 0, close: 0, post: 0, value: 0, idleDaysSum: 0, idleCount: 0 };
      byRep.set(repKey, agg);
    }

    if (bucket === "pre") agg.pre += 1;
    else if (bucket === "close") agg.close += 1;
    else agg.post += 1;

    agg.value += d.amount ?? 0;

    if (d.last_activity_at) {
      const t = new Date(d.last_activity_at).getTime();
      if (Number.isFinite(t)) {
        const days = Math.max(0, Math.floor((now - t) / (24 * 60 * 60 * 1000)));
        agg.idleDaysSum += days;
        agg.idleCount += 1;
      }
    }
  }

  const rows: PipelineHealthRow[] = [];
  for (const [repKey, agg] of byRep) {
    const n = agg.pre + agg.close + agg.post;
    rows.push({
      repKey,
      displayName: repDisplayName(repKey, profileMap),
      preSale: agg.pre,
      close: agg.close,
      postSale: agg.post,
      dealCount: n,
      totalValue: agg.value,
      avgDaysIdle: agg.idleCount > 0 ? Math.round((agg.idleDaysSum / agg.idleCount) * 10) / 10 : null,
    });
  }

  rows.sort((a, b) => b.totalValue - a.totalValue || a.displayName.localeCompare(b.displayName));
  return rows;
}
