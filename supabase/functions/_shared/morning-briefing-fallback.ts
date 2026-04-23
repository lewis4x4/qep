export interface MorningBriefingData {
  userId: string;
  fullName: string;
  role: string;
  dealsClosingSoon: Array<{
    name: string;
    amount: number | null;
    expected_close: string;
    stage: string | null;
    company: string | null;
  }>;
  overdueFollowUps: Array<{
    name: string;
    amount: number | null;
    follow_up_date: string;
    company: string | null;
  }>;
  recentActivities: Array<{
    type: string;
    body: string | null;
    date: string;
  }>;
  pipelineTotal: number;
  openDealCount: number;
  newVoiceNotes: number;
}

function formatCurrency(value: number | null): string {
  return `$${(value ?? 0).toLocaleString()}`;
}

function formatShortDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatGreetingDate(now: Date): string {
  return now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function buildPriorityActions(data: MorningBriefingData): string[] {
  const actions: string[] = [];

  if (data.overdueFollowUps.length > 0) {
    const next = data.overdueFollowUps[0];
    actions.push(
      `Call ${next.name}${next.company ? ` at ${next.company}` : ""} first — follow-up slipped past ${formatShortDate(next.follow_up_date)}.`,
    );
  }

  if (data.dealsClosingSoon.length > 0) {
    const nextClose = data.dealsClosingSoon[0];
    actions.push(
      `Pressure-test ${nextClose.name}${nextClose.company ? ` with ${nextClose.company}` : ""} before ${formatShortDate(nextClose.expected_close)}.`,
    );
  }

  if (data.newVoiceNotes > 0) {
    actions.push(
      `Review ${data.newVoiceNotes} new voice note${data.newVoiceNotes === 1 ? "" : "s"} and turn any next steps into CRM activity today.`,
    );
  }

  if (data.recentActivities.length === 0) {
    actions.push("Log at least one meaningful customer touchpoint early so the pipeline does not go stale.");
  }

  if (actions.length === 0) {
    actions.push("Review the top 3 open deals and set a concrete next step on each one before noon.");
  }

  if (actions.length < 4 && data.openDealCount > 0) {
    actions.push("Clean up aging deals that have no immediate path forward so the board reflects reality.");
  }

  return actions.slice(0, 5);
}

function buildDealsToWatch(data: MorningBriefingData): string[] {
  const lines: string[] = [];

  for (const deal of data.dealsClosingSoon.slice(0, 3)) {
    lines.push(
      `- ${deal.name}${deal.company ? ` (${deal.company})` : ""} — ${formatCurrency(deal.amount)} closing ${formatShortDate(deal.expected_close)}${deal.stage ? `, stage ${deal.stage}` : ""}`,
    );
  }

  for (const deal of data.overdueFollowUps.slice(0, 2)) {
    lines.push(
      `- ${deal.name}${deal.company ? ` (${deal.company})` : ""} — follow-up overdue since ${formatShortDate(deal.follow_up_date)}`,
    );
  }

  return lines.length > 0 ? lines : ["- No urgent deals are within the current watch window."];
}

function buildQuickWins(data: MorningBriefingData): string[] {
  const wins: string[] = [];

  if (data.overdueFollowUps.length > 0) {
    wins.push("Clear the oldest overdue follow-up and schedule the next touch while you are in the record.");
  }

  if (data.newVoiceNotes > 0) {
    wins.push("Convert fresh voice notes into follow-up tasks before context goes cold.");
  }

  if (data.recentActivities.length > 0) {
    wins.push("Reuse yesterday's momentum by sending same-day callbacks on the accounts you touched most recently.");
  }

  if (wins.length === 0) {
    wins.push("Tighten next follow-up dates on live deals so tomorrow's queue is already prioritized.");
  }

  return wins.slice(0, 3).map((line) => `- ${line}`);
}

export function buildFallbackMorningBriefing(
  data: MorningBriefingData,
  now: Date = new Date(),
): string {
  const priorityActions = buildPriorityActions(data);
  const dealsToWatch = buildDealsToWatch(data);
  const quickWins = buildQuickWins(data);

  return [
    `# Good morning, ${data.fullName.split(" ")[0] || data.fullName} — ${formatGreetingDate(now)}`,
    "",
    "## Pipeline Snapshot",
    `- **Open deals:** ${data.openDealCount}`,
    `- **Pipeline value:** ${formatCurrency(data.pipelineTotal)}`,
    `- **Closing this week:** ${data.dealsClosingSoon.length}`,
    `- **Overdue follow-ups:** ${data.overdueFollowUps.length}`,
    `- **New voice notes:** ${data.newVoiceNotes}`,
    "",
    "## Priority Actions",
    ...priorityActions.map((line, index) => `${index + 1}. ${line}`),
    "",
    "## Deals to Watch",
    ...dealsToWatch,
    "",
    "## Quick Wins",
    ...quickWins,
  ].join("\n");
}
