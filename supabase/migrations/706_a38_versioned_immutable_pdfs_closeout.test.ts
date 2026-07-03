import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "706_a38_versioned_immutable_pdfs_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("706_a38_versioned_immutable_pdfs_closeout.sql contract", () => {
  it("marks only A3.8 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'a3.8'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'a3.6'");
    expect(compactSql).not.toContain("where task_id = 'a3.10'");
  });

  it("records R2 immutable PDF versioning and latest-link evidence", () => {
    expect(compactSql).toContain("599_quote_pdf_r2_versions.sql");
    expect(compactSql).toContain("quote_begin_customer_pdf_version");
    expect(compactSql).toContain("quote_send_package_commit");
    expect(compactSql).toContain("creater2puturl/creater2geturl/headr2object/readr2objectbytes");
    expect(compactSql).toContain("handlepubliclatestquotepdfread");
    expect(compactSql).toContain("cache-control no-store");
  });

  it("documents fresh-send guards, version diffs, and deployment boundaries", () => {
    expect(compactSql).toContain("send-package requires a generated, fresh, unsent r2 customer_quote_pdf artifact");
    expect(compactSql).toContain("complete-upload verifies r2 head/readback and sha-256");
    expect(compactSql).toContain("quotepdfversionhistorypanel.tsx sent version history and line diffs");
    expect(compactSql).toContain("quick resend is disabled");
    expect(compactSql).toContain("production r2 credentials");
    expect(compactSql).toContain("mission_alignment");
  });
});
