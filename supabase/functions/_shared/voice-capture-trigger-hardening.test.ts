import { assertStringIncludes } from "jsr:@std/assert@1";

const migrationPath = new URL("../../migrations/360_voice_capture_trigger_hardening.sql", import.meta.url);
const migrationSql = await Deno.readTextFile(migrationPath);

Deno.test("voice capture hardening migration reads trigger rows through jsonb", () => {
  assertStringIncludes(migrationSql, "v_row := to_jsonb(new);");
  assertStringIncludes(migrationSql, "v_new := to_jsonb(new);");
  assertStringIncludes(migrationSql, "v_old := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;");
});

Deno.test("voice capture hardening migration falls back across legacy and current fields", () => {
  assertStringIncludes(migrationSql, "nullif(v_row #>> '{metadata,company_id}', '')::uuid");
  assertStringIncludes(migrationSql, "nullif(v_row->>'linked_company_id', '')::uuid");
  assertStringIncludes(migrationSql, "coalesce(v_new->'extracted_data', v_new->'extraction_result')");
  assertStringIncludes(migrationSql, "coalesce(v_old->'extracted_data', v_old->'extraction_result')");
});
