export const QUOTE_EXPIRATION_DEFAULT_DAYS = 30;
export const QUOTE_FOLLOW_UP_DEFAULT_DAYS = 3;

function addDaysFrom(baseDate: Date, days: number): string {
  const date = new Date(baseDate.getTime());
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function parseLifecycleDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

export function buildQuoteLifecycleDefaultDates(baseDate = new Date()): {
  expiresAt: string;
  followUpAt: string;
} {
  return {
    expiresAt: addDaysFrom(baseDate, QUOTE_EXPIRATION_DEFAULT_DAYS),
    followUpAt: addDaysFrom(baseDate, QUOTE_FOLLOW_UP_DEFAULT_DAYS),
  };
}

export function isQuoteFollowUpAfterExpiration(input: {
  followUpAt?: string | null;
  expiresAt?: string | null;
}): boolean {
  const followUpTime = parseLifecycleDate(input.followUpAt);
  const expirationTime = parseLifecycleDate(input.expiresAt);
  return followUpTime !== null && expirationTime !== null && followUpTime > expirationTime;
}

export function quoteLifecycleWarning(input: {
  followUpAt?: string | null;
  expiresAt?: string | null;
}): string | null {
  return isQuoteFollowUpAfterExpiration(input)
    ? "Follow-up must be scheduled before the quote expiration date."
    : null;
}
