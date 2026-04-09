import {
  resolveEffectiveWorkspaceId,
  resolveProfileActiveWorkspaceId,
} from "./workspace.ts";

Deno.test("resolveProfileActiveWorkspaceId returns the active workspace from profiles", async () => {
  const adminClient = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: { active_workspace_id: "ws-9" },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };

  const workspaceId = await resolveProfileActiveWorkspaceId(adminClient as never, "user-1");
  if (workspaceId !== "ws-9") {
    throw new Error(`Expected ws-9, got ${workspaceId}`);
  }
});

Deno.test("resolveEffectiveWorkspaceId prefers profile state when JWT resolver disagrees", async () => {
  const adminClient = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: { active_workspace_id: "ws-db" },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };

  const callerClient = {
    rpc: async () => ({
      data: "ws-jwt",
      error: null,
    }),
  };

  const workspaceId = await resolveEffectiveWorkspaceId({
    adminClient: adminClient as never,
    callerClient: callerClient as never,
    userId: "user-2",
  });

  if (workspaceId !== "ws-db") {
    throw new Error(`Expected ws-db, got ${workspaceId}`);
  }
});

Deno.test("resolveEffectiveWorkspaceId falls back to profile state when RPC fails", async () => {
  const adminClient = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: { active_workspace_id: "ws-db" },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };

  const callerClient = {
    rpc: async () => ({
      data: null,
      error: { message: "rpc failed" },
    }),
  };

  const workspaceId = await resolveEffectiveWorkspaceId({
    adminClient: adminClient as never,
    callerClient: callerClient as never,
    userId: "user-3",
  });

  if (workspaceId !== "ws-db") {
    throw new Error(`Expected ws-db, got ${workspaceId}`);
  }
});
