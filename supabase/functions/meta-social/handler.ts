import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export interface MetaSocialPostBody {
  workspace_id?: string;
  campaign_id?: string | null;
  equipment_id?: string | null;
  platform?: string;
  content_text?: string;
  images?: unknown[];
  link_url?: string | null;
  scheduled_at?: string;
}

export type MetaSocialAuthResult =
  | { ok: false; response?: Response }
  | { ok: true; isServiceRole: true }
  | {
    ok: true;
    isServiceRole: false;
    userId: string;
    workspaceId: string;
    role: string;
  };

export function resolveMetaSocialWorkspace(params: {
  isServiceRole: boolean;
  authWorkspaceId?: string | null;
  requestedWorkspaceId?: string | null;
}): string {
  if (params.isServiceRole) {
    return params.requestedWorkspaceId ?? "default";
  }
  return params.authWorkspaceId ?? "default";
}

export async function authenticateMetaSocial(
  authHeader: string | null,
  origin: string | null,
): Promise<MetaSocialAuthResult> {
  if (!authHeader) {
    return { ok: false };
  }

  if (SERVICE_ROLE_KEY && authHeader === `Bearer ${SERVICE_ROLE_KEY}`) {
    return { ok: true, isServiceRole: true };
  }

  const auth = await requireServiceUser(authHeader, origin, ["admin", "owner"]);
  if (!auth.ok) {
    return { ok: false, response: auth.response };
  }

  return {
    ok: true,
    isServiceRole: false,
    userId: auth.userId,
    workspaceId: auth.workspaceId,
    role: auth.role,
  };
}

export interface MetaSocialHandlerDependencies {
  createAdminClient: () => SupabaseClient;
  authenticate: (
    authHeader: string | null,
    origin: string | null,
  ) => Promise<MetaSocialAuthResult>;
}

function defaultCreateAdminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

const defaultDependencies: MetaSocialHandlerDependencies = {
  createAdminClient: defaultCreateAdminClient,
  authenticate: authenticateMetaSocial,
};

export async function handleMetaSocial(
  req: Request,
  overrides: Partial<MetaSocialHandlerDependencies> = {},
): Promise<Response> {
  const { createAdminClient, authenticate } = {
    ...defaultDependencies,
    ...overrides,
  };

  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const auth = await authenticate(authHeader, origin);
    if (!auth.ok) {
      if (auth.response) return auth.response;
      return safeJsonError("Unauthorized", 401, origin);
    }

    const supabaseAdmin = createAdminClient();
    const url = new URL(req.url);
    const action = url.pathname.split("/").pop() || "";

    const resolveWorkspace = (requestedWorkspaceId?: string | null): string =>
      resolveMetaSocialWorkspace({
        isServiceRole: auth.isServiceRole,
        authWorkspaceId: auth.isServiceRole ? null : auth.workspaceId,
        requestedWorkspaceId,
      });

    if (req.method === "GET" && action === "accounts") {
      const workspaceId = resolveWorkspace();
      const { data, error } = await supabaseAdmin
        .from("social_accounts")
        .select("id, platform, account_name, is_active, last_posted_at")
        .eq("workspace_id", workspaceId)
        .order("platform");
      if (error) return safeJsonError("Failed to load accounts", 500, origin);
      return safeJsonOk({ accounts: data }, origin);
    }

    if (req.method !== "POST") {
      return safeJsonError("Method not allowed", 405, origin);
    }

    const body = (await req.json()) as MetaSocialPostBody;
    const workspaceId = resolveWorkspace(body.workspace_id);

    if (action === "post") {
      if (!body.platform || !body.content_text) {
        return safeJsonError("platform and content_text required", 400, origin);
      }

      const { data: post, error: postError } = await supabaseAdmin
        .from("social_media_posts")
        .insert({
          workspace_id: workspaceId,
          campaign_id: body.campaign_id || null,
          equipment_id: body.equipment_id || null,
          platform: body.platform,
          content_text: body.content_text,
          images: body.images || [],
          link_url: body.link_url || null,
          status: "posted",
          posted_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (postError) {
        return safeJsonError("Failed to create post record", 500, origin);
      }

      return safeJsonOk(
        { post, meta_api: "pending_integration" },
        origin,
        201,
      );
    }

    if (action === "schedule") {
      if (!body.platform || !body.content_text || !body.scheduled_at) {
        return safeJsonError(
          "platform, content_text, and scheduled_at required",
          400,
          origin,
        );
      }

      const { data: post, error: postError } = await supabaseAdmin
        .from("social_media_posts")
        .insert({
          workspace_id: workspaceId,
          campaign_id: body.campaign_id || null,
          equipment_id: body.equipment_id || null,
          platform: body.platform,
          content_text: body.content_text,
          images: body.images || [],
          link_url: body.link_url || null,
          status: "scheduled",
          scheduled_at: body.scheduled_at,
        })
        .select()
        .single();

      if (postError) {
        return safeJsonError("Failed to schedule post", 500, origin);
      }

      return safeJsonOk({ post }, origin, 201);
    }

    return safeJsonError("Unknown action", 400, origin);
  } catch (err) {
    console.error("meta-social error:", err);
    return safeJsonError(
      "Internal server error",
      500,
      req.headers.get("origin"),
    );
  }
}
