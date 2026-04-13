import { createClient } from "jsr:@supabase/supabase-js@2";
import { encryptCredential } from "../_shared/integration-crypto.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { createEventTracker, emitIntegrationConfigUpdated } from "../_shared/event-tracker.ts";
import { emitAuthzDenialAuditEvent } from "./authz-audit.ts";
const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173"
];
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Vary": "Origin"
  };
}
const INTEGRATION_DEFAULTS = {
  hubspot: {
    displayName: "HubSpot QRM",
    authType: "oauth2",
    syncFrequency: "manual"
  },
  sendgrid: {
    displayName: "SendGrid Email",
    authType: "api_key",
    syncFrequency: "manual"
  },
  twilio: {
    displayName: "Twilio SMS",
    authType: "api_key",
    syncFrequency: "manual"
  },
  intellidealer: {
    displayName: "IntelliDealer (VitalEdge)",
    authType: "oauth2",
    syncFrequency: "manual"
  },
  ironguides: {
    displayName: "Iron Solutions / IronGuides",
    authType: "api_key",
    syncFrequency: "manual"
  },
  rouse: {
    displayName: "Rouse Analytics",
    authType: "api_key",
    syncFrequency: "manual"
  },
  aemp: {
    displayName: "AEMP 2.0 Telematics",
    authType: "oauth2",
    syncFrequency: "manual"
  },
  financing: {
    displayName: "Financing Partners",
    authType: "api_key",
    syncFrequency: "manual"
  },
  manufacturer_incentives: {
    displayName: "Manufacturer Incentives API",
    authType: "api_key",
    syncFrequency: "manual"
  },
  auction_data: {
    displayName: "Auction Data (Rouse/IronPlanet)",
    authType: "api_key",
    syncFrequency: "manual"
  },
  fred_usda: {
    displayName: "FRED / USDA Economic Data",
    authType: "api_key",
    syncFrequency: "daily"
  }
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
// Admin client — bypasses RLS, can access auth.admin API
const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});
function createCallerClient(jwt) {
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!anonKey) {
    throw new Error("SUPABASE_ANON_KEY is required for user-scoped admin-users access.");
  }
  return createClient(SUPABASE_URL, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`
      }
    }
  });
}
async function resolveCallerWorkspaceId(callerDb) {
  const { data, error } = await callerDb.rpc("get_my_workspace");
  if (error || typeof data !== "string" || data.trim().length === 0) {
    throw new Error("WORKSPACE_RESOLUTION_FAILED");
  }
  return data.trim();
}
async function getCallerProfile(jwt) {
  const caller = createCallerClient(jwt);
  const { data: { user }, error } = await caller.auth.getUser();
  if (error || !user) return null;
  const { data: profile } = await adminClient.from("profiles").select("id, role").eq("id", user.id).single();
  const role = profile?.role;
  const parsedRole = role === "rep" || role === "admin" || role === "manager" || role === "owner" ? role : null;
  return {
    id: user.id,
    role: parsedRole
  };
}
function canManageUsers(role) {
  return [
    "admin",
    "manager",
    "owner"
  ].includes(role);
}
function canManageIntegrations(role) {
  return role === "admin" || role === "owner";
}
function isOwner(role) {
  return role === "owner";
}
function deniedResponse({ ch, route, action, callerUserId, reasonCode, status, error }) {
  emitAuthzDenialAuditEvent({
    route,
    action,
    callerUserId: callerUserId ?? null,
    reasonCode,
    status
  });
  return new Response(JSON.stringify({
    error
  }), {
    status,
    headers: {
      ...ch,
      "Content-Type": "application/json"
    }
  });
}
Deno.serve(async (req)=>{
  const ch = corsHeaders(req.headers.get("origin"));
  const url = new URL(req.url);
  const route = url.pathname;
  const queryAction = req.method === "GET" ? url.searchParams.get("action") : null;
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: ch
    });
  }
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return deniedResponse({
      ch,
      route,
      action: queryAction,
      reasonCode: "missing_authorization_header",
      status: 401,
      error: "Missing authorization"
    });
  }
  const jwt = authHeader.replace("Bearer ", "");
  const callerProfile = await getCallerProfile(jwt);
  if (!callerProfile?.role || !canManageUsers(callerProfile.role)) {
    const reasonCode = !callerProfile ? "caller_identity_unresolved" : callerProfile.role === null ? "caller_profile_not_found" : "insufficient_manage_users_role";
    return deniedResponse({
      ch,
      route,
      action: queryAction,
      callerUserId: callerProfile?.id ?? null,
      reasonCode,
      status: 403,
      error: "Insufficient permissions"
    });
  }
  const caller = {
    id: callerProfile.id,
    role: callerProfile.role
  };
  const callerDb = createCallerClient(jwt);
  try {
    const action = req.method === "GET" ? url.searchParams.get("action") : null;
    // ── LIST USERS ──────────────────────────────────────────────────────────
    if (req.method === "GET" && action === "list") {
      // Fetch profiles + auth metadata in parallel for faster response
      const [profileResult, authResult] = await Promise.all([
        adminClient.from("profiles").select("id, full_name, email, role, iron_role, is_active, created_at, updated_at").order("created_at", { ascending: false }),
        adminClient.rpc("get_auth_user_metadata").then(
          (r) => r,
          (e) => { console.warn("[admin-users] get_auth_user_metadata failed:", e); return { data: null, error: e }; }
        ),
      ]);
      if (profileResult.error) throw profileResult.error;
      const profiles = profileResult.data;
      let authUsers: Array<{ id: string; last_sign_in_at?: string | null; email_confirmed_at?: string | null; banned_until?: string | null }> = [];
      if (!authResult.error && authResult.data) {
        authUsers = authResult.data;
      } else if (authResult.error) {
        console.warn("[admin-users] get_auth_user_metadata degraded:", authResult.error?.message ?? "no data");
      }
      const authMap = new Map(authUsers.map((u)=>[
          u.id,
          {
            last_sign_in_at: u.last_sign_in_at ?? null,
            email_confirmed_at: u.email_confirmed_at ?? null,
            banned_until: u.banned_until ?? null
          }
        ]));
      const users = (profiles ?? []).map((p)=>({
          ...p,
          ...authMap.get(p.id) ?? {
            last_sign_in_at: null,
            email_confirmed_at: null,
            banned_until: null
          },
          // "pending" = invite email sent but user hasn't confirmed yet
          status: authMap.get(p.id)?.email_confirmed_at ? "active" : "pending"
        }));
      return new Response(JSON.stringify({
        users
      }), {
        status: 200,
        headers: {
          ...ch,
          "Content-Type": "application/json"
        }
      });
    }
    // ── INVITE USER ─────────────────────────────────────────────────────────
    if (req.method === "POST") {
      const raw = await req.text();
      let parsed;
      try {
        parsed = raw.trim() === "" ? {} : JSON.parse(raw);
      } catch  {
        return new Response(JSON.stringify({
          error: {
            code: "INVALID_JSON",
            message: "Request body must be valid JSON."
          }
        }), {
          status: 400,
          headers: {
            ...ch,
            "Content-Type": "application/json"
          }
        });
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return new Response(JSON.stringify({
          error: {
            code: "INVALID_JSON",
            message: "Request body must be a JSON object."
          }
        }), {
          status: 400,
          headers: {
            ...ch,
            "Content-Type": "application/json"
          }
        });
      }
      const body = parsed;
      if (body.action === "invite") {
        if (!body.email || !body.full_name || !body.role) {
          return new Response(JSON.stringify({
            error: "email, full_name, and role are required"
          }), {
            status: 400,
            headers: {
              ...ch,
              "Content-Type": "application/json"
            }
          });
        }
        // Only owners can invite as owner or manager; admin/manager can only invite reps
        const allowedRoles = isOwner(caller.role) ? [
          "rep",
          "admin",
          "manager",
          "owner"
        ] : [
          "rep"
        ];
        if (!allowedRoles.includes(body.role)) {
          return deniedResponse({
            ch,
            route,
            action: body.action,
            callerUserId: caller.id,
            reasonCode: "invite_role_not_allowed",
            status: 403,
            error: "You can only invite users with role: " + allowedRoles.join(", ")
          });
        }
        const { data: newUser, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(body.email, {
          data: {
            full_name: body.full_name
          },
          redirectTo: `${Deno.env.get("APP_URL") ?? "https://qualityequipmentparts.netlify.app"}/`
        });
        if (inviteErr) {
          if (inviteErr.message.includes("already been registered")) {
            return new Response(JSON.stringify({
              error: "A user with that email already exists."
            }), {
              status: 409,
              headers: {
                ...ch,
                "Content-Type": "application/json"
              }
            });
          }
          throw inviteErr;
        }
        // The trigger auto-creates the profile — update role + department immediately after
        if (newUser?.user) {
          const profilePatch: Record<string, unknown> = {
            role: body.role,
            full_name: body.full_name,
          };
          if (body.iron_role) profilePatch.iron_role = body.iron_role;
          await adminClient.from("profiles").update(profilePatch).eq("id", newUser.user.id);
        }
        return new Response(JSON.stringify({
          success: true,
          userId: newUser?.user?.id
        }), {
          status: 201,
          headers: {
            ...ch,
            "Content-Type": "application/json"
          }
        });
      }
      // ── CREATE USER (direct, no email invite) ─────────────────────────────
      if (body.action === "create") {
        if (!body.email || !body.password || !body.full_name || !body.role) {
          return new Response(JSON.stringify({
            error: "email, password, full_name, and role are required"
          }), {
            status: 400,
            headers: {
              ...ch,
              "Content-Type": "application/json"
            }
          });
        }
        if (body.password.length < 8) {
          return new Response(JSON.stringify({
            error: "Password must be at least 8 characters"
          }), {
            status: 400,
            headers: {
              ...ch,
              "Content-Type": "application/json"
            }
          });
        }
        const allowedRoles = isOwner(caller.role) ? [
          "rep",
          "admin",
          "manager",
          "owner"
        ] : [
          "rep"
        ];
        if (!allowedRoles.includes(body.role)) {
          return deniedResponse({
            ch,
            route,
            action: body.action,
            callerUserId: caller.id,
            reasonCode: "create_role_not_allowed",
            status: 403,
            error: "You can only create users with role: " + allowedRoles.join(", ")
          });
        }
        const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
          email: body.email,
          password: body.password,
          email_confirm: true,
          user_metadata: {
            full_name: body.full_name
          }
        });
        if (createErr) {
          if (createErr.message.includes("already been registered")) {
            return new Response(JSON.stringify({
              error: "A user with that email already exists."
            }), {
              status: 409,
              headers: {
                ...ch,
                "Content-Type": "application/json"
              }
            });
          }
          console.error("[admin-users] create: createUser failed:", createErr.message);
          throw createErr;
        }
        // The on_auth_user_created trigger MAY have created profile + workspace,
        // but it's wrapped in exception handling and may silently fail.
        // Upsert both to guarantee the user can actually sign in.
        if (newUser?.user) {
          // Ensure workspace membership exists
          const { error: pwErr } = await adminClient.from("profile_workspaces").upsert({
            profile_id: newUser.user.id,
            workspace_id: "default"
          }, {
            onConflict: "profile_id,workspace_id"
          });
          if (pwErr) {
            console.error("[admin-users] create: profile_workspaces upsert failed:", pwErr.message);
          }
          // Upsert profile with correct role/name/department
          const profileData: Record<string, unknown> = {
            id: newUser.user.id,
            email: body.email,
            full_name: body.full_name,
            role: body.role,
            active_workspace_id: "default",
            is_active: true,
          };
          if (body.iron_role) profileData.iron_role = body.iron_role;
          const { error: profileErr } = await adminClient.from("profiles").upsert(profileData, {
            onConflict: "id"
          });
          if (profileErr) {
            console.error("[admin-users] create: profile upsert failed:", profileErr.message);
          }
        }
        return new Response(JSON.stringify({
          success: true,
          userId: newUser?.user?.id
        }), {
          status: 201,
          headers: {
            ...ch,
            "Content-Type": "application/json"
          }
        });
      }
      // ── UPDATE ROLE ─────────────────────────────────────────────────────
      if (body.action === "update-role") {
        if (!isOwner(caller.role)) {
          return deniedResponse({
            ch,
            route,
            action: body.action,
            callerUserId: caller.id,
            reasonCode: "owner_role_required_for_update_role",
            status: 403,
            error: "Only owners can change user roles"
          });
        }
        if (!body.userId || !body.role) {
          return new Response(JSON.stringify({
            error: "userId and role are required"
          }), {
            status: 400,
            headers: {
              ...ch,
              "Content-Type": "application/json"
            }
          });
        }
        // Prevent owner from demoting themselves
        if (body.userId === caller.id && body.role !== "owner") {
          return new Response(JSON.stringify({
            error: "You cannot change your own role"
          }), {
            status: 400,
            headers: {
              ...ch,
              "Content-Type": "application/json"
            }
          });
        }
        const { error: updateErr } = await adminClient.from("profiles").update({
          role: body.role,
          updated_at: new Date().toISOString()
        }).eq("id", body.userId);
        if (updateErr) throw updateErr;
        return new Response(JSON.stringify({
          success: true
        }), {
          status: 200,
          headers: {
            ...ch,
            "Content-Type": "application/json"
          }
        });
      }
      // ── DEACTIVATE / REACTIVATE ──────────────────────────────────────────
      if (body.action === "set-active") {
        if (!isOwner(caller.role)) {
          return deniedResponse({
            ch,
            route,
            action: body.action,
            callerUserId: caller.id,
            reasonCode: "owner_role_required_for_set_active",
            status: 403,
            error: "Only owners can deactivate users"
          });
        }
        if (!body.userId || body.is_active === undefined) {
          return new Response(JSON.stringify({
            error: "userId and is_active are required"
          }), {
            status: 400,
            headers: {
              ...ch,
              "Content-Type": "application/json"
            }
          });
        }
        if (body.userId === caller.id) {
          return new Response(JSON.stringify({
            error: "You cannot deactivate your own account"
          }), {
            status: 400,
            headers: {
              ...ch,
              "Content-Type": "application/json"
            }
          });
        }
        // Update profile flag
        const { error: profileErr } = await adminClient.from("profiles").update({
          is_active: body.is_active,
          updated_at: new Date().toISOString()
        }).eq("id", body.userId);
        if (profileErr) throw profileErr;
        // Also ban/unban in Supabase Auth so the user can't log in while deactivated
        const { error: banErr } = await adminClient.auth.admin.updateUserById(body.userId, {
          ban_duration: body.is_active ? "none" : "876600h"
        });
        if (banErr) throw banErr;
        return new Response(JSON.stringify({
          success: true
        }), {
          status: 200,
          headers: {
            ...ch,
            "Content-Type": "application/json"
          }
        });
      }
      // ── TEST INTEGRATION ─────────────────────────────────────────────────
      if (body.action === "test_integration") {
        return new Response(JSON.stringify({
          error: {
            code: "DEPRECATED_ACTION",
            message: "test_integration has moved to the dedicated integration-test-connection function."
          }
        }), {
          status: 410,
          headers: {
            ...ch,
            "Content-Type": "application/json"
          }
        });
      }
      // ── UPDATE INTEGRATION ────────────────────────────────────────────────
      if (body.action === "update_integration") {
        if (!canManageIntegrations(caller.role)) {
          return deniedResponse({
            ch,
            route,
            action: body.action,
            callerUserId: caller.id,
            reasonCode: "admin_or_owner_required_for_update_integration",
            status: 403,
            error: "Only admins or owners can update integration configuration"
          });
        }
        if (!body.integration_key) {
          return new Response(JSON.stringify({
            error: "integration_key is required"
          }), {
            status: 400,
            headers: {
              ...ch,
              "Content-Type": "application/json"
            }
          });
        }
        const workspaceId = await resolveCallerWorkspaceId(callerDb);
        const hasCredentialInput = Boolean(body.credentials?.trim());
        const clearCredentials = body.clear_credentials === true;
        const integrationDefaults = INTEGRATION_DEFAULTS[body.integration_key];
        if (!integrationDefaults) {
          return new Response(JSON.stringify({
            error: {
              code: "INVALID_REQUEST",
              message: "Unsupported integration key."
            }
          }), {
            status: 400,
            headers: {
              ...ch,
              "Content-Type": "application/json"
            }
          });
        }
        if (hasCredentialInput && clearCredentials) {
          return new Response(JSON.stringify({
            error: {
              code: "INVALID_REQUEST",
              message: "Provide credentials or clear_credentials=true, not both."
            }
          }), {
            status: 400,
            headers: {
              ...ch,
              "Content-Type": "application/json"
            }
          });
        }
        let { data: existingRow, error: existErr } = await callerDb.from("integration_status").select("integration_key, workspace_id, auth_type").eq("workspace_id", workspaceId).eq("integration_key", body.integration_key).maybeSingle();
        if (existErr) {
          throw existErr;
        }
        if (!existingRow) {
          const { data: insertedRow, error: insertError } = await callerDb.from("integration_status").insert({
            workspace_id: workspaceId,
            integration_key: body.integration_key,
            display_name: integrationDefaults.displayName,
            status: "pending_credentials",
            auth_type: integrationDefaults.authType,
            sync_frequency: integrationDefaults.syncFrequency,
            config: {}
          }).select("integration_key, workspace_id, auth_type").single();
          if (insertError) {
            throw insertError;
          }
          existingRow = insertedRow;
        }
        if (!existingRow) {
          return new Response(JSON.stringify({
            error: {
              code: "INTEGRATION_NOT_FOUND",
              message: "Integration not configured"
            }
          }), {
            status: 404,
            headers: {
              ...ch,
              "Content-Type": "application/json"
            }
          });
        }
        const updatePayload = {
          updated_at: new Date().toISOString()
        };
        const changedFields = [];
        if (hasCredentialInput) {
          if (!Deno.env.get("INTEGRATION_ENCRYPTION_KEY")) {
            return new Response(JSON.stringify({
              error: {
                code: "SERVICE_UNAVAILABLE",
                message: "Service unavailable. Contact your administrator."
              }
            }), {
              status: 503,
              headers: {
                ...ch,
                "Content-Type": "application/json"
              }
            });
          }
          updatePayload.credentials_encrypted = await encryptCredential(body.credentials, body.integration_key);
          updatePayload.status = "pending_credentials";
          updatePayload.last_test_success = null;
          updatePayload.last_test_error = null;
          updatePayload.last_test_latency_ms = null;
          updatePayload.last_test_at = null;
          changedFields.push("credentials");
        }
        if (clearCredentials) {
          updatePayload.credentials_encrypted = null;
          updatePayload.status = "pending_credentials";
          updatePayload.last_test_success = null;
          updatePayload.last_test_error = null;
          updatePayload.last_test_latency_ms = null;
          updatePayload.last_test_at = null;
          changedFields.push("credentials");
        }
        if (body.endpoint_url !== undefined) {
          updatePayload.endpoint_url = body.endpoint_url;
          changedFields.push("endpoint_url");
        }
        if (body.sync_scopes !== undefined || body.config_patch !== undefined) {
          const { data: existing } = await callerDb.from("integration_status").select("config").eq("workspace_id", workspaceId).eq("integration_key", body.integration_key).maybeSingle();
          const existingConfig = existing?.config ?? {};
          const nextConfig = {
            ...existingConfig
          };
          if (body.sync_scopes !== undefined) {
            nextConfig.sync_scopes = body.sync_scopes;
            changedFields.push("sync_scopes");
          }
          if (body.config_patch !== undefined) {
            for (const [key, value] of Object.entries(body.config_patch)){
              nextConfig[key] = value;
            }
            changedFields.push("config_patch");
          }
          updatePayload.config = nextConfig;
        }
        if (changedFields.length === 0) {
          return new Response(JSON.stringify({
            success: true
          }), {
            status: 200,
            headers: {
              ...ch,
              "Content-Type": "application/json"
            }
          });
        }
        const { data: updatedRow, error: updateErr } = await callerDb.from("integration_status").update(updatePayload).eq("workspace_id", workspaceId).eq("integration_key", body.integration_key).select("workspace_id, integration_key").single();
        if (updateErr) throw updateErr;
        if (!updatedRow || updatedRow.workspace_id !== workspaceId) {
          throw new Error("INTEGRATION_UPDATE_WORKSPACE_MISMATCH");
        }
        const tracker = createEventTracker(adminClient, {
          workspaceId
        });
        await emitIntegrationConfigUpdated(tracker, {
          integration: body.integration_key,
          changedFields,
          updatedByRole: caller.role,
          statusAfter: updatePayload.status ?? null,
          authType: existingRow.auth_type ?? null,
          userId: caller.id,
          requestId: crypto.randomUUID()
        });
        return new Response(JSON.stringify({
          success: true
        }), {
          status: 200,
          headers: {
            ...ch,
            "Content-Type": "application/json"
          }
        });
      }
      return new Response(JSON.stringify({
        error: "Unknown action"
      }), {
        status: 400,
        headers: {
          ...ch,
          "Content-Type": "application/json"
        }
      });
    }
    return new Response(JSON.stringify({
      error: "Method not allowed"
    }), {
      status: 405,
      headers: {
        ...ch,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    captureEdgeException(err, {
      fn: "admin-users",
      req
    });
    const message = err instanceof Error ? err.message : "Internal server error";
    if (message === "WORKSPACE_RESOLUTION_FAILED") {
      return new Response(JSON.stringify({
        error: {
          code: "WORKSPACE_RESOLUTION_FAILED",
          message: "Could not resolve workspace context for this request."
        }
      }), {
        status: 500,
        headers: {
          ...ch,
          "Content-Type": "application/json"
        }
      });
    }
    console.error("[admin-users] error:", message);
    return new Response(JSON.stringify({
      error: message
    }), {
      status: 500,
      headers: {
        ...ch,
        "Content-Type": "application/json"
      }
    });
  }
});
