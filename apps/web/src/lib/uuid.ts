/** PostgreSQL uuid text form (RFC 4122 variant). */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(s: string | null | undefined): boolean {
  if (s == null) return false;
  return UUID_RE.test(s.trim());
}
