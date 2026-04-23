/**
 * Decision Room — team-wide move analytics.
 *
 * Aggregates pure functions over rows from decision_room_moves (joined
 * with profiles + qrm_deals + crm_deal_stages). No mutation, no side
 * effects — the page hydrates the rows via one RLS-scoped query and
 * passes them here for layout.
 *
 * What reps + managers see:
 *   - Top moves this window (frequency + mood mix)
 *   - Rep leaderboard (activity + mood mix per rep)
 *   - Moves that ran on deals later closed won ("working playbook")
 *   - Moves that ran on deals later closed lost ("missed-it patterns")
 *   - Overall mood distribution across the window
 */
export type Mood = "positive" | "mixed" | "negative";

export interface MoveRow {
  id: string;
  moveText: string;
  mood: Mood | null;
  velocityDelta: number | null;
  createdAt: string;
  userId: string | null;
  userName: string | null;
  dealId: string | null;
  dealName: string | null;
  dealStageIsWon: boolean | null;
  dealStageIsLost: boolean | null;
}

export interface MoodDistribution {
  positive: number;
  mixed: number;
  negative: number;
  unknown: number;
  total: number;
}

export interface MoveCluster {
  signature: string;
  exemplar: string;
  count: number;
  mood: MoodDistribution;
  medianVelocityDelta: number | null;
}

export interface RepRow {
  userId: string;
  userName: string;
  moveCount: number;
  mood: MoodDistribution;
  dealsTouched: number;
  lastMoveAt: string | null;
}

export interface StageMovesBucket {
  rows: MoveRow[];
  topClusters: MoveCluster[];
}

export interface AnalyticsAggregate {
  totalMoves: number;
  uniqueReps: number;
  uniqueDeals: number;
  overallMood: MoodDistribution;
  topMoves: MoveCluster[];
  reps: RepRow[];
  winningPlaybook: StageMovesBucket;
  losingPatterns: StageMovesBucket;
  recentDays: number;
}

/**
 * Normalize a move string into a stable cluster signature — lower, punctuation
 * stripped, common filler words removed. Very close moves cluster together so
 * "offer 90 day deferred payment" and "Offer a 90-day deferred payment" land
 * in the same bucket without a vector store.
 */
const STOPWORDS = new Set([
  "a", "an", "the", "to", "for", "and", "or", "of", "on", "in", "with", "at",
  "by", "this", "that", "these", "those", "my", "our", "your",
]);

/**
 * Keep the three most information-dense tokens (longest wins; alpha as
 * tiebreak). Near-duplicate phrasing collapses to a single signature so
 * "Offer a deferred payment" and "offer deferred payment now" both map
 * to the same cluster. Minor filler words don't split the bucket.
 */
export function clusterSignature(moveText: string): string {
  const tokens = moveText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));

  const ranked = [...tokens].sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    return a.localeCompare(b);
  });

  const top = ranked.slice(0, 3);
  return top.sort().join(" ");
}

function emptyMood(): MoodDistribution {
  return { positive: 0, mixed: 0, negative: 0, unknown: 0, total: 0 };
}

function addMood(dist: MoodDistribution, mood: Mood | null): void {
  dist.total += 1;
  if (mood === "positive") dist.positive += 1;
  else if (mood === "negative") dist.negative += 1;
  else if (mood === "mixed") dist.mixed += 1;
  else dist.unknown += 1;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

function buildClusters(rows: MoveRow[], limit: number): MoveCluster[] {
  const buckets = new Map<string, { exemplar: string; rows: MoveRow[] }>();
  for (const row of rows) {
    const sig = clusterSignature(row.moveText);
    if (!sig) continue;
    const existing = buckets.get(sig);
    if (existing) {
      existing.rows.push(row);
      // Prefer the longer / more-descriptive move text as the exemplar.
      if (row.moveText.length > existing.exemplar.length) {
        existing.exemplar = row.moveText;
      }
    } else {
      buckets.set(sig, { exemplar: row.moveText, rows: [row] });
    }
  }

  const clusters: MoveCluster[] = [];
  for (const [signature, bucket] of buckets) {
    const mood = emptyMood();
    const deltas: number[] = [];
    for (const row of bucket.rows) {
      addMood(mood, row.mood);
      if (typeof row.velocityDelta === "number" && Number.isFinite(row.velocityDelta)) {
        deltas.push(row.velocityDelta);
      }
    }
    clusters.push({
      signature,
      exemplar: bucket.exemplar,
      count: bucket.rows.length,
      mood,
      medianVelocityDelta: median(deltas),
    });
  }

  return clusters
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      // Tie-breaker: more positive moves rank higher.
      const aScore = a.mood.positive - a.mood.negative;
      const bScore = b.mood.positive - b.mood.negative;
      return bScore - aScore;
    })
    .slice(0, limit);
}

function buildRepLeaderboard(rows: MoveRow[]): RepRow[] {
  const byUser = new Map<string, { name: string; rows: MoveRow[]; deals: Set<string>; lastAt: string | null }>();
  for (const row of rows) {
    const userId = row.userId ?? "(unknown)";
    const name = row.userName ?? "(unknown rep)";
    const existing = byUser.get(userId);
    if (existing) {
      existing.rows.push(row);
      if (row.dealId) existing.deals.add(row.dealId);
      if (!existing.lastAt || row.createdAt > existing.lastAt) {
        existing.lastAt = row.createdAt;
      }
    } else {
      byUser.set(userId, {
        name,
        rows: [row],
        deals: new Set(row.dealId ? [row.dealId] : []),
        lastAt: row.createdAt,
      });
    }
  }

  const out: RepRow[] = [];
  for (const [userId, bucket] of byUser) {
    const mood = emptyMood();
    for (const r of bucket.rows) addMood(mood, r.mood);
    out.push({
      userId,
      userName: bucket.name,
      moveCount: bucket.rows.length,
      mood,
      dealsTouched: bucket.deals.size,
      lastMoveAt: bucket.lastAt,
    });
  }

  return out.sort((a, b) => {
    if (b.moveCount !== a.moveCount) return b.moveCount - a.moveCount;
    if (b.dealsTouched !== a.dealsTouched) return b.dealsTouched - a.dealsTouched;
    return (b.lastMoveAt ?? "").localeCompare(a.lastMoveAt ?? "");
  });
}

export function aggregateMoves(rows: MoveRow[], recentDays: number): AnalyticsAggregate {
  const overall = emptyMood();
  const deals = new Set<string>();
  const reps = new Set<string>();
  for (const r of rows) {
    addMood(overall, r.mood);
    if (r.dealId) deals.add(r.dealId);
    if (r.userId) reps.add(r.userId);
  }

  const wonRows = rows.filter((r) => r.dealStageIsWon === true);
  const lostRows = rows.filter((r) => r.dealStageIsLost === true);

  return {
    totalMoves: rows.length,
    uniqueReps: reps.size,
    uniqueDeals: deals.size,
    overallMood: overall,
    topMoves: buildClusters(rows, 8),
    reps: buildRepLeaderboard(rows),
    winningPlaybook: { rows: wonRows, topClusters: buildClusters(wonRows, 5) },
    losingPatterns: { rows: lostRows, topClusters: buildClusters(lostRows, 5) },
    recentDays,
  };
}
