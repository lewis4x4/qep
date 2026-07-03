import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "704_a35_branded_acceptance_flow_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("704_a35_branded_acceptance_flow_closeout.sql contract", () => {
  it("marks only A3.5 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'a3.5'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'a3.4'");
    expect(compactSql).not.toContain("where task_id = 'a3.6'");
  });

  it("records branded acceptance, signature, and deposit checkout evidence", () => {
    expect(compactSql).toContain("adr-016-acceptance-flow-e-signature.md");
    expect(compactSql).toContain("dealroompage.tsx");
    expect(compactSql).toContain("portalsignaturepad");
    expect(compactSql).toContain("explicit acceptance terms");
    expect(compactSql).toContain("handlepublicaccept");
    expect(compactSql).toContain("recordpublicacceptrepevidence");
    expect(compactSql).toContain("handlepublicdepositcheckout");
    expect(compactSql).toContain("quote_deposit webhook verification tests");
  });

  it("documents provider/manual boundaries while preserving native acceptance safety", () => {
    expect(compactSql).toContain("native qep e-signature");
    expect(compactSql).toContain("signature is inserted with signed snapshot and document hash before quote status mutation");
    expect(compactSql).toContain("stripe redirect is not treated as payment proof");
    expect(compactSql).toContain("external provider signing remains optional/provider-gated");
    expect(compactSql).toContain("live stripe secret/webhook configuration");
    expect(compactSql).toContain("mission_alignment");
  });
});
