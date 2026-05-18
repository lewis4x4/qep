const PLACEHOLDER_NAMES = new Set([
  "sales",
  "demo",
  "admin",
  "test",
  "user",
  "support",
  "rep",
  "owner",
  "manager",
]);

export function formatRepFirstName(input: {
  full_name?: string | null;
  email?: string | null;
}): string | null {
  const first = (input.full_name ?? "").trim().split(/\s+/)[0];
  if (first && !PLACEHOLDER_NAMES.has(first.toLowerCase())) {
    return first;
  }
  const local = (input.email ?? "").split("@")[0] ?? "";
  const cleaned = local
    .replace(/[._\-+0-9]+/g, " ")
    .trim()
    .split(/\s+/)[0];
  if (cleaned && !PLACEHOLDER_NAMES.has(cleaned.toLowerCase())) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
  }
  return null;
}
