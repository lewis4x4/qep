import { assertStringIncludes } from "jsr:@std/assert@1";

const migrationPath = new URL("../../migrations/361_emit_event_overload_cleanup.sql", import.meta.url);
const migrationSql = await Deno.readTextFile(migrationPath);

Deno.test("emit_event overload cleanup drops the legacy 8-argument signature", () => {
  assertStringIncludes(
    migrationSql,
    "drop function if exists public.emit_event(",
  );
  assertStringIncludes(
    migrationSql,
    "  uuid,\n  uuid\n);",
  );
});
