import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("@/hooks/use-toast", () => ({
  toast: () => ({ id: "toast", dismiss: () => undefined, update: () => undefined }),
}));

mock.module("@/lib/auth-recovery", () => ({
  clearCachedProfile: () => undefined,
}));

import { performWorkspaceSwitch } from "./workspace-switcher-actions";

describe("performWorkspaceSwitch", () => {
  let switchingRef: { current: boolean };
  let notifications: Array<{ title?: unknown; description?: unknown; variant?: unknown }>;
  let clearedProfiles: string[];
  let clearedQueries: number;
  let reloads: number;

  beforeEach(() => {
    switchingRef = { current: false };
    notifications = [];
    clearedProfiles = [];
    clearedQueries = 0;
    reloads = 0;
  });

  test("clears cached profile, query cache, and reloads after a successful switch", async () => {
    const supabaseClient = {
      rpc: async () => ({ error: null }),
      auth: {
        getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }),
        refreshSession: async () => ({ error: null }),
      },
    };

    await performWorkspaceSwitch({
      activeWorkspaceId: "default",
      target: "ws-1",
      switchingRef,
      supabaseClient,
      queryClient: {
        clear: () => {
          clearedQueries += 1;
        },
      },
      notify: (toast) => {
        notifications.push(toast);
        return { id: "1", dismiss: () => undefined, update: () => undefined };
      },
      clearProfileCache: (userId) => {
        clearedProfiles.push(userId);
      },
      reload: () => {
        reloads += 1;
      },
    });

    expect(clearedProfiles).toEqual(["user-1"]);
    expect(clearedQueries).toBe(1);
    expect(reloads).toBe(1);
    expect(notifications).toHaveLength(0);
    expect(switchingRef.current).toBe(false);
  });

  test("reloads even when refreshSession fails and notifies the user", async () => {
    const supabaseClient = {
      rpc: async () => ({ error: null }),
      auth: {
        getSession: async () => ({ data: { session: { user: { id: "user-2" } } } }),
        refreshSession: async () => ({ error: { message: "timeout" } }),
      },
    };

    await performWorkspaceSwitch({
      activeWorkspaceId: "default",
      target: "ws-2",
      switchingRef,
      supabaseClient,
      queryClient: {
        clear: () => {
          clearedQueries += 1;
        },
      },
      notify: (toast) => {
        notifications.push(toast);
        return { id: "2", dismiss: () => undefined, update: () => undefined };
      },
      clearProfileCache: (userId) => {
        clearedProfiles.push(userId);
      },
      reload: () => {
        reloads += 1;
      },
    });

    expect(clearedProfiles).toEqual(["user-2"]);
    expect(clearedQueries).toBe(1);
    expect(reloads).toBe(1);
    expect(notifications).toEqual([
      {
        title: "Workspace updated",
        description: "Refreshing your session took too long. Reloading to finish the switch.",
      },
    ]);
  });
});
