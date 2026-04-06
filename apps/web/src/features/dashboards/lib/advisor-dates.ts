/** Calendar-day delta from local "today" to a YYYY-MM-DD scheduled date (no UTC drift). */
export function calendarDaysFromToday(scheduledDate: string, today: Date = new Date()): number {
  const [y, m, d] = scheduledDate.split("-").map((x) => Number(x));
  if (!y || !m || !d) return 0;
  const sched = new Date(y, m - 1, d);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((sched.getTime() - t.getTime()) / (24 * 60 * 60 * 1000));
}

export function followUpDueBadge(days: number): { label: string; tone: "overdue" | "today" | "soon" } {
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: "overdue" };
  if (days === 0) return { label: "Today", tone: "today" };
  if (days === 1) return { label: "Tomorrow", tone: "soon" };
  return { label: `In ${days} days`, tone: "soon" };
}
