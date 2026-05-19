export type TaskRoutingIntent =
  | "follow_up"
  | "quote"
  | "coi_admin"
  | "parts"
  | "service"
  | "process_improvement"
  | "general";

export interface VoiceTaskCandidate {
  title: string;
  description: string | null;
  scheduledFor: string;
  intent: TaskRoutingIntent;
}

interface BuildVoiceTaskCandidatesParams {
  followUpSuggestions?: string[] | null;
  futureTasks?:
    | Array<
      {
        title?: string | null;
        description?: string | null;
        scheduled_for?: string | null;
      }
    >
    | null;
  now?: Date;
}

const NEXT_STEP_PATTERN =
  /\b(tomorrow|today|next week|next month|monday|tuesday|wednesday|thursday|friday)\b/i;

export function buildVoiceTaskCandidates({
  followUpSuggestions,
  futureTasks,
  now = new Date(),
}: BuildVoiceTaskCandidatesParams): VoiceTaskCandidate[] {
  const candidates: VoiceTaskCandidate[] = [];

  if (Array.isArray(futureTasks)) {
    for (const task of futureTasks) {
      if (!task?.title || !task?.scheduled_for) continue;
      if (!isIsoDate(task.scheduled_for)) continue;
      candidates.push({
        title: task.title,
        description: task.description ?? null,
        scheduledFor: task.scheduled_for,
        intent: classifyIntent(`${task.title} ${task.description ?? ""}`),
      });
    }
  }

  if (Array.isArray(followUpSuggestions)) {
    for (const suggestion of followUpSuggestions) {
      const trimmed = suggestion?.trim();
      if (!trimmed) continue;
      candidates.push({
        title: buildTitleFromSuggestion(trimmed),
        description: trimmed,
        scheduledFor: resolveDueDateFromText(trimmed, now),
        intent: classifyIntent(trimmed),
      });
    }
  }

  return dedupeCandidates(candidates);
}

export function intentToRoutingContentType(
  intent: TaskRoutingIntent,
): "parts" | "service" | "process_improvement" | null {
  if (intent === "parts") return "parts";
  if (intent === "service") return "service";
  if (intent === "coi_admin" || intent === "process_improvement") {
    return "process_improvement";
  }
  return null;
}

function classifyIntent(text: string): TaskRoutingIntent {
  const input = text.toLowerCase();

  if (
    /\b(coi|certificate of insurance|insurance cert|admin doc|administrative)\b/
      .test(input)
  ) return "coi_admin";
  if (
    /\b(service|warranty|repair|breakdown|down machine|technician)\b/.test(
      input,
    )
  ) return "service";
  if (/\b(parts?|inventory|order intake|backorder)\b/.test(input)) {
    return "parts";
  }
  if (/\b(quote|send quote|pricing|proposal|estimate)\b/.test(input)) {
    return "quote";
  }
  if (
    /\b(process improvement|workflow|improve process|playbook)\b/.test(input)
  ) return "process_improvement";
  if (
    /\b(follow up|follow-up|call|text|email|check in|reach out)\b/.test(input)
  ) return "follow_up";

  return "general";
}

function resolveDueDateFromText(text: string, now: Date): string {
  if (!NEXT_STEP_PATTERN.test(text)) {
    return nextBusinessDay(now);
  }

  const lower = text.toLowerCase();
  if (lower.includes("today")) return toIsoDate(now);
  if (lower.includes("tomorrow")) return toIsoDate(addDays(now, 1));
  if (lower.includes("next week")) return toIsoDate(addDays(now, 7));
  if (lower.includes("next month")) return toIsoDate(addDays(now, 30));

  const weekdayMap: Record<string, number> = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
  };

  for (const [day, targetDow] of Object.entries(weekdayMap)) {
    if (!lower.includes(day)) continue;
    const currentDow = now.getUTCDay();
    const delta = (targetDow - currentDow + 7) % 7 || 7;
    return toIsoDate(addDays(now, delta));
  }

  return nextBusinessDay(now);
}

function buildTitleFromSuggestion(suggestion: string): string {
  if (suggestion.length <= 100) return suggestion;
  return `${suggestion.slice(0, 97).trimEnd()}...`;
}

function nextBusinessDay(now: Date): string {
  let date = addDays(now, 1);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date = addDays(date, 1);
  }
  return toIsoDate(date);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function toIsoDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(new Date(value).getTime());
}

function dedupeCandidates(
  candidates: VoiceTaskCandidate[],
): VoiceTaskCandidate[] {
  const seen = new Set<string>();
  const deduped: VoiceTaskCandidate[] = [];

  for (const candidate of candidates) {
    const key =
      `${candidate.intent}|${candidate.scheduledFor}|${candidate.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}
