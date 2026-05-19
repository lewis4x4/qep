import { assertStringIncludes } from "@std/assert@1";

const migrationPath = new URL(
  "../../migrations/591_voice_capture_same_day_cluster_uniqueness.sql",
  import.meta.url,
);
const migrationSql = await Deno.readTextFile(migrationPath);

Deno.test("voice capture cluster migration keys uniqueness by workspace/type/target/day cluster key", () => {
  assertStringIncludes(
    migrationSql,
    "crm_activities_voice_capture_cluster_unique_idx",
  );
  assertStringIncludes(
    migrationSql,
    "coalesce(deal_id::text, company_id::text, contact_id::text)",
  );
  assertStringIncludes(migrationSql, "metadata ->> 'voiceClusterKey'");
  assertStringIncludes(migrationSql, "metadata ->> 'activityKind'");
});
