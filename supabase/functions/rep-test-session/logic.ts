export const REP_TEST_SESSION_ALLOWED_ROLES = new Set(["manager", "owner"]);
export const REP_TEST_SESSION_FALLBACK_ORIGIN = "https://qualityequipmentparts.netlify.app";
export const REP_TEST_SESSION_ROUTE = "/sales/today";

type RepProfileRow = {
  id: string | null;
  email: string | null;
  role: string | null;
  active_workspace_id: string | null;
};

function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value || value.trim().length === 0) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function canOpenRepTestSession(role: string): boolean {
  return REP_TEST_SESSION_ALLOWED_ROLES.has(role);
}

export function resolveRepTestSessionOrigin(env: Record<string, string | undefined>): string {
  return normalizeOrigin(env.APP_URL)
    ?? normalizeOrigin(env.PUBLIC_APP_URL)
    ?? normalizeOrigin(env.SITE_URL)
    ?? REP_TEST_SESSION_FALLBACK_ORIGIN;
}

export function buildRepTestSessionRedirectTo(env: Record<string, string | undefined>): string {
  return `${resolveRepTestSessionOrigin(env)}${REP_TEST_SESSION_ROUTE}`;
}

export function pickWorkspaceRep(
  rows: RepProfileRow[] | null | undefined,
  workspaceId: string,
): { id: string; email: string } | null {
  for (const row of rows ?? []) {
    if (row.role !== "rep") continue;
    if (row.active_workspace_id !== workspaceId) continue;
    const email = row.email?.trim();
    if (!row.id || !email) continue;
    return { id: row.id, email };
  }
  return null;
}
