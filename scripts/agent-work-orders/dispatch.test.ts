import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const script = readFileSync(join(repoRoot, "scripts/agent-work-orders/dispatch.mjs"), "utf8");
const workflow = readFileSync(join(repoRoot, ".github/workflows/qep-agent-work-orders.yml"), "utf8");
const compactScript = script.replace(/\s+/g, " ").toLowerCase();
const compactWorkflow = workflow.replace(/\s+/g, " ").toLowerCase();

describe("QEP agent work-order dispatcher contract", () => {
  it("claims work through the queue RPC and never bypasses the database contract", () => {
    expect(compactScript).toContain('admin.rpc("claim_qep_agent_work_order"');
    expect(compactScript).toContain('admin.rpc("finish_qep_agent_work_order"');
    expect(compactScript).toContain('from("qep_roadmap_tasks")');
    expect(compactScript).toContain("p_lease_seconds: leaseSeconds".toLowerCase());
    expect(compactScript).toContain("p_lease_token: workOrder.lease_token".toLowerCase());
  });

  it("refuses to claim configured external runners until their command env exists", () => {
    expect(script).toContain('claude_code: "QEP_AGENT_CLAUDE_COMMAND"');
    expect(script).toContain('cursor_background: "QEP_AGENT_CURSOR_COMMAND"');
    expect(script).toContain('repoprompt: "QEP_AGENT_REPOPROMPT_COMMAND"');
    expect(compactScript).toContain("reason: \"missing_runner_command\"");
    expect(compactScript).toContain("process.exit(0)");
  });

  it("builds a concrete handoff package with roadmap context and execution rules", () => {
    expect(compactScript).toContain("# qep agent work order");
    expect(compactScript).toContain("## roadmap task");
    expect(compactScript).toContain("## execution contract");
    expect(compactScript).toContain("read agents.md");
    expect(compactScript).toContain("verify before finishing");
    expect(compactScript).toContain("do not auto-merge destructive or authorize-class work");
  });

  it("exposes a scheduled and manual GitHub Actions dispatcher", () => {
    expect(compactWorkflow).toContain("name: qep agent work-order dispatcher");
    expect(compactWorkflow).toContain("workflow_dispatch:");
    expect(compactWorkflow).toContain("schedule:");
    expect(compactWorkflow).toContain("*/5 * * * *");
    expect(compactWorkflow).toContain("node ./scripts/agent-work-orders/dispatch.mjs");
    expect(compactWorkflow).toContain("qep_agent_claude_command");
    expect(compactWorkflow).toContain("actions/upload-artifact@v4");
  });
});
