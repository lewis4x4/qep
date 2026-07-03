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
    expect(compactScript).toContain("source linear issue current");
    expect(compactScript).toContain("do not auto-merge destructive or authorize-class work");
  });

  it("posts best-effort Linear progress comments without blocking dispatcher completion", () => {
    expect(script).toContain('const LINEAR_API_URL = "https://api.linear.app/graphql"');
    expect(script).toContain("process.env.LINEAR_API_KEY");
    expect(compactScript).toContain("commentcreate(input: $input)");
    expect(compactScript).toContain("postprogresscomment(workorder, task, \"claimed\"");
    expect(compactScript).toContain("postprogresscomment(workorder, task, \"runner_launched\"");
    expect(compactScript).toContain("postprogresscomment(workorder, task, \"completed\"");
    expect(compactScript).toContain("completion.checkpoint");
    expect(compactScript).toContain("blocked");
    expect(compactScript).toContain("missing_linear_api_key");
    expect(compactScript).toContain("missing_source_issue_id");
    expect(compactScript).toContain("linear_comment_failed");
    expect(compactScript).toContain("progress_comments: progresscomments");
    expect(compactScript).toContain("parent_comment_id");
    expect(compactScript).toContain("abortsignal.timeout");
  });

  it("exposes source Linear metadata to configured runners for deeper checkpoints", () => {
    expect(compactScript).toContain("qep_agent_result_path");
    expect(compactScript).toContain("qep_agent_linear_issue_id");
    expect(compactScript).toContain("qep_agent_linear_issue_identifier");
    expect(compactScript).toContain("qep_agent_source_comment_id");
    expect(compactScript).toContain("qep_agent_source_comment_url");
    expect(compactScript).toContain("qep_agent_progress_comments");
    expect(compactScript).toContain("tests-green");
    expect(compactScript).toContain("pr-opened");
    expect(compactScript).toContain("result_summary");
  });

  it("exposes a scheduled and manual GitHub Actions dispatcher", () => {
    expect(compactWorkflow).toContain("name: qep agent work-order dispatcher");
    expect(compactWorkflow).toContain("workflow_dispatch:");
    expect(compactWorkflow).toContain("schedule:");
    expect(compactWorkflow).toContain("*/5 * * * *");
    expect(compactWorkflow).toContain("node ./scripts/agent-work-orders/dispatch.mjs");
    expect(compactWorkflow).toContain("linear_api_key");
    expect(compactWorkflow).toContain("qep_agent_claude_command");
    expect(compactWorkflow).toContain("actions/upload-artifact@v4");
  });
});
