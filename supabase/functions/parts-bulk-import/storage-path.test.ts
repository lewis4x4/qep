import { assertEquals } from "jsr:@std/assert@1";
import { validatePartsImportStoragePath } from "./storage-path.ts";

Deno.test("validatePartsImportStoragePath accepts caller-owned parts imports", () => {
  assertEquals(
    validatePartsImportStoragePath("parts-imports/user-1/1710000000-upload.xlsx", "user-1"),
    { ok: true, bucket: "parts-imports", path: "user-1/1710000000-upload.xlsx" },
  );
});

Deno.test("validatePartsImportStoragePath rejects cross-user and internal plan paths", () => {
  assertEquals(validatePartsImportStoragePath("parts-imports/user-2/file.xlsx", "user-1").ok, false);
  assertEquals(validatePartsImportStoragePath("parts-imports/user-1/.plan-run.json", "user-1").ok, false);
  assertEquals(validatePartsImportStoragePath("other-bucket/user-1/file.xlsx", "user-1").ok, false);
});
