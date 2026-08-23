import { assertEquals } from "jsr:@std/assert@1";
import { profileIsVisibleInCallerWorkspace } from "./workspace-guard.ts";

class ProfileQuery {
  constructor(
    private visibleProfileId: string | null,
    private readonly queryFails = false,
  ) {}

  select(_columns: string): this {
    return this;
  }

  eq(_column: string, profileId: string): this {
    if (this.visibleProfileId !== profileId) this.visibleProfileId = null;
    return this;
  }

  maybeSingle() {
    return Promise.resolve({
      data: this.visibleProfileId ? { id: this.visibleProfileId } : null,
      error: this.queryFails ? { message: "read failed" } : null,
    });
  }
}

class ProfileClient {
  constructor(
    private readonly visibleProfileId: string | null,
    private readonly queryFails = false,
  ) {}

  from(_table: string) {
    return new ProfileQuery(this.visibleProfileId, this.queryFails);
  }
}

Deno.test("permits a profile visible through the caller workspace RLS", async () => {
  assertEquals(
    await profileIsVisibleInCallerWorkspace(
      new ProfileClient("profile-a"),
      "profile-a",
    ),
    true,
  );
});

Deno.test("rejects a profile hidden by caller workspace RLS", async () => {
  assertEquals(
    await profileIsVisibleInCallerWorkspace(
      new ProfileClient("profile-b"),
      "profile-a",
    ),
    false,
  );
});

Deno.test("fails closed when the workspace-scoped profile read fails", async () => {
  assertEquals(
    await profileIsVisibleInCallerWorkspace(
      new ProfileClient("profile-a", true),
      "profile-a",
    ),
    false,
  );
});
