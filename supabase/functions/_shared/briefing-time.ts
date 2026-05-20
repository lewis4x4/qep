const DEFAULT_TIME_ZONE = "America/New_York";

function partsFor(now: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function getDateInTimeZone(
  now: Date = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
): string {
  const parts = partsFor(now, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getHourInTimeZone(
  now: Date = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
): number {
  const hour = Number(partsFor(now, timeZone).hour);
  return hour === 24 ? 0 : hour;
}

export function shouldRunEtScheduledBatch(
  body: Record<string, unknown>,
  now: Date = new Date(),
): boolean {
  if (body.regenerate === true) return true;

  const enforceHour = body.enforce_et_hour;
  if (enforceHour === undefined || enforceHour === null) return true;

  const expectedHour = typeof enforceHour === "number"
    ? enforceHour
    : typeof enforceHour === "string"
      ? Number(enforceHour)
      : NaN;

  if (!Number.isInteger(expectedHour) || expectedHour < 0 || expectedHour > 23) {
    return false;
  }

  return getHourInTimeZone(now, DEFAULT_TIME_ZONE) === expectedHour;
}
