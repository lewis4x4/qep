import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  buildRepTestSessionRedirectTo,
  canOpenRepTestSession,
  pickWorkspaceRep,
} from "./logic.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  if (req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
  if (!auth.ok) return auth.response;

  if (!canOpenRepTestSession(auth.role)) {
    return safeJsonError("Only manager/owner can open rep test sessions.", 403, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return safeJsonError("Server misconfiguration", 500, origin);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: repCandidates, error: workspaceErr } = await admin
    .from("profiles")
    .select("id, email, role, active_workspace_id, profile_workspaces!inner(workspace_id)")
    .eq("role", "rep")
    .eq("active_workspace_id", auth.workspaceId)
    .eq("profile_workspaces.workspace_id", auth.workspaceId)
    .not("email", "is", null)
    .order("created_at", { ascending: true })
    .limit(500);

  if (workspaceErr) {
    return safeJsonError("Failed to resolve workspace rep", 500, origin);
  }

  const rep = pickWorkspaceRep(
    (repCandidates ?? []) as Array<{ id: string | null; email: string | null; role: string | null; active_workspace_id: string | null }>,
    auth.workspaceId,
  );

  if (!rep?.email) {
    return safeJsonError("No rep user with email found in this workspace.", 404, origin);
  }

  const redirectTo = buildRepTestSessionRedirectTo({
    APP_URL: Deno.env.get("APP_URL") ?? undefined,
    PUBLIC_APP_URL: Deno.env.get("PUBLIC_APP_URL") ?? undefined,
    SITE_URL: Deno.env.get("SITE_URL") ?? undefined,
  });

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: rep.email,
    options: { redirectTo },
  });

  if (linkErr || !linkData?.properties?.action_link) {
    return safeJsonError("Could not generate rep test session link.", 500, origin);
  }

  return safeJsonOk({
    actionLink: linkData.properties.action_link,
    role: "rep",
    email: rep.email,
  }, origin);
});
