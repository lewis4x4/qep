import { assertEquals } from "jsr:@std/assert@1";
import {
  mergeSnapshotBadges,
  resolveRefreshEnvelope,
} from "./dge-refresh-state.ts";

Deno.test("resolveRefreshEnvelope marks fresh snapshots without open jobs", () => {
  const refresh = resolveRefreshEnvelope({
    snapshotUpdatedAt: new Date().toISOString(),
    staleAfterMs: 60_000,
    openJob: null,
  });

  assertEquals(refresh.status, "fresh");
  assertEquals(refresh.stale, false);
  assertEquals(refresh.job_id, null);
});

Deno.test("resolveRefreshEnvelope marks stale snapshots with queued jobs as refreshing", () => {
  const refresh = resolveRefreshEnvelope({
    snapshotUpdatedAt: new Date(Date.now() - 3_600_000).toISOString(),
    staleAfterMs: 1_000,
    openJob: {
      id: "job-1",
      status: "queued",
      created_at: new Date().toISOString(),
    },
  });

  assertEquals(refresh.status, "refreshing");
  assertEquals(refresh.stale, true);
  assertEquals(refresh.job_id, "job-1");
});

Deno.test("mergeSnapshotBadges adds stale and degraded markers", () => {
  const badges = mergeSnapshotBadges(["LIVE"], {
    status: "degraded",
    stale: true,
    job_id: null,
    requested_at: null,
    last_error: "timeout",
  });

  assertEquals(badges.includes("STALE_CACHE"), true);
  assertEquals(badges.includes("AI_OFFLINE"), true);
});
