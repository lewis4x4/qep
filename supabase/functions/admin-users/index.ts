import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type UserRole = "rep" | "admin" | "manager" | "owner";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Admin client — bypasses RLS, can access auth.admin API
const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function getCallerProfile(jwt: string): Promise<{ id: string; role: UserRole } | null> {
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const caller = createClient(SUPABASE_URL, anonKey ?? SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: { user }, error } = await caller.auth.getUser();
  if (error || !user) return null;

  const { data: profile } = await adminClient
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  return profile as { id: string; role: UserRole } | null;
}

function canManageUsers(role: UserRole): boolean {
  return ["admin", "manager", "owner"].includes(role);
}

function isOwner(role: UserRole): boolean {
  return role === "owner";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing authorization" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const jwt = authHeader.replace("Bearer ", "");
  const caller = await getCallerProfile(jwt);

  if (!caller || !canManageUsers(caller.role)) {
    return new Response(JSON.stringify({ error: "Insufficient permissions" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const url = new URL(req.url);
    const action = req.method === "GET" ? url.searchParams.get("action") : null;

    // ── LIST USERS ──────────────────────────────────────────────────────────
    if (req.method === "GET" && action === "list") {
      // Fetch all profiles
      const { data: profiles, error: profileErr } = await adminClient
        .from("profiles")
        .select("id, full_name, email, role, is_active, created_at, updated_at")
        .order("created_at", { ascending: false });

      if (profileErr) throw profileErr;

      // Fetch auth user records to get last_sign_in_at and email_confirmed_at
      const { data: authData, error: authErr } = await adminClient.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });

      if (authErr) throw authErr;

      const authMap = new Map(
        authData.users.map((u) => [
          u.id,
          {
            last_sign_in_at: u.last_sign_in_at ?? null,
            email_confirmed_at: u.email_confirmed_at ?? null,
            banned_until: (u as { banned_until?: string }).banned_until ?? null,
          },
        ])
      );

      const users = (profiles ?? []).map((p) => ({
        ...p,
        ...(authMap.get(p.id) ?? {
          last_sign_in_at: null,
          email_confirmed_at: null,
          banned_until: null,
        }),
        // "pending" = invite email sent but user hasn't confirmed yet
        status: authMap.get(p.id)?.email_confirmed_at ? "active" : "pending",
      }));

      return new Response(JSON.stringify({ users }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── INVITE USER ─────────────────────────────────────────────────────────
    if (req.method === "POST") {
      const body = await req.json() as {
        action: string;
        email?: string;
        full_name?: string;
        role?: UserRole;
        userId?: string;
        is_active?: boolean;
      };

      if (body.action === "invite") {
        if (!body.email || !body.full_name || !body.role) {
          return new Response(JSON.stringify({ error: "email, full_name, and role are required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Only owners can invite as owner or manager; admin/manager can only invite reps
        const allowedRoles: UserRole[] = isOwner(caller.role)
          ? ["rep", "admin", "manager", "owner"]
          : ["rep"];

        if (!allowedRoles.includes(body.role)) {
          return new Response(
            JSON.stringify({ error: "You can only invite users with role: " + allowedRoles.join(", ") }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data: newUser, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
          body.email,
          {
            data: { full_name: body.full_name },
            redirectTo: `${Deno.env.get("APP_URL") ?? "https://qualityequipmentparts.netlify.app"}/`,
          }
        );

        if (inviteErr) {
          if (inviteErr.message.includes("already been registered")) {
            return new Response(JSON.stringify({ error: "A user with that email already exists." }), {
              status: 409,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          throw inviteErr;
        }

        // The trigger auto-creates the profile — update role immediately after
        if (newUser?.user) {
          await adminClient
            .from("profiles")
            .update({ role: body.role, full_name: body.full_name })
            .eq("id", newUser.user.id);
        }

        return new Response(JSON.stringify({ success: true, userId: newUser?.user?.id }), {
          status: 201,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ── UPDATE ROLE ─────────────────────────────────────────────────────
      if (body.action === "update-role") {
        if (!isOwner(caller.role)) {
          return new Response(JSON.stringify({ error: "Only owners can change user roles" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!body.userId || !body.role) {
          return new Response(JSON.stringify({ error: "userId and role are required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Prevent owner from demoting themselves
        if (body.userId === caller.id && body.role !== "owner") {
          return new Response(
            JSON.stringify({ error: "You cannot change your own role" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { error: updateErr } = await adminClient
          .from("profiles")
          .update({ role: body.role, updated_at: new Date().toISOString() })
          .eq("id", body.userId);

        if (updateErr) throw updateErr;

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ── DEACTIVATE / REACTIVATE ──────────────────────────────────────────
      if (body.action === "set-active") {
        if (!isOwner(caller.role)) {
          return new Response(JSON.stringify({ error: "Only owners can deactivate users" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!body.userId || body.is_active === undefined) {
          return new Response(JSON.stringify({ error: "userId and is_active are required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (body.userId === caller.id) {
          return new Response(
            JSON.stringify({ error: "You cannot deactivate your own account" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Update profile flag
        const { error: profileErr } = await adminClient
          .from("profiles")
          .update({ is_active: body.is_active, updated_at: new Date().toISOString() })
          .eq("id", body.userId);

        if (profileErr) throw profileErr;

        // Also ban/unban in Supabase Auth so the user can't log in while deactivated
        const { error: banErr } = await adminClient.auth.admin.updateUserById(body.userId, {
          ban_duration: body.is_active ? "none" : "876600h", // ~100 years = effectively permanent
        });

        if (banErr) throw banErr;

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[admin-users] error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
