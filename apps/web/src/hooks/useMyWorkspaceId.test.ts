import { beforeEach, describe, expect, mock, test } from "bun:test";

let authState = {
  profile: { active_workspace_id: "default" },
  loading: false,
  error: null as string | null,
};

mock.module("./useAuth", () => ({
  useAuth: () => authState,
}));

const { useMyWorkspaceId } = await import("./useMyWorkspaceId");

describe("useMyWorkspaceId", () => {
  beforeEach(() => {
    authState = {
      profile: { active_workspace_id: "default" },
      loading: false,
      error: null,
    };
  });

  test("returns the active workspace id from auth profile", () => {
    authState = {
      profile: { active_workspace_id: "ws-42" },
      loading: false,
      error: null,
    };

    expect(useMyWorkspaceId()).toEqual({
      data: "ws-42",
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      isSuccess: true,
    });
  });

  test("surfaces auth failures as workspace errors", () => {
    authState = {
      profile: null,
      loading: false,
      error: "profile missing",
    };

    const result = useMyWorkspaceId();
    expect(result.data).toBeNull();
    expect(result.isError).toBe(true);
    expect(result.error?.message).toBe("profile missing");
    expect(result.isSuccess).toBe(false);
  });
});
