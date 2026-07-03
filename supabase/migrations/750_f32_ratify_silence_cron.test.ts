import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "750_f32_ratify_silence_cron.sql");
const streamFSeed = readText("supabase", "migrations", "597_qep_stream_f_decision_velocity.sql");
const plan = readText("QEP (1)", "QEP_DECISION_INBOX_MOONSHOT_V2.md");
const goLive = readText("QEP (1)", "QEP_DECISION_INBOX_GO_LIVE.md");
const catalog = readText("QEP (1)", "QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md");
const config = readText("supabase", "config.toml");
const runner = readText("supabase", "functions", "ratify-silence-runner", "index.ts");
const runnerLogic = readText("supabase", "functions", "ratify-silence-runner", "logic.ts");
const runnerLogicTest = readText("supabase", "functions", "ratify-silence-runner", "logic.test.ts");
const resolutionAuthority = readText("supabase", "migrations", "651_qep_decision_resolution_authority.sql");

const compactCloseout = compact(closeoutSql);
const compactSeed = compact(streamFSeed);
const compactPlan = compact(plan);
const compactGoLive = compact(goLive);
const compactCatalog = compact(catalog);
const compactConfig = compact(config);
const compactRunner = compact(runner);
const compactRunnerLogic = compact(runnerLogic);
const compactRunnerLogicTest = compact(runnerLogicTest);
const compactResolutionAuthority = compact(resolutionAuthority);

describe("750_f32_ratify_silence_cron.sql contract", () => {
  it("marks only F3.2 shipped with mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'f3.2'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("qep_roadmap_sync_events");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("f32_ratify_silence_cron");
    expect(compactCloseout).not.toContain("where task_id = 'f3.1'");
    expect(compactCloseout).not.toContain("where task_id = 'f3.3'");
  });

  it("pins the canonical roadmap row and source docs", () => {
    expect(compactSeed).toContain("'f3.2','f','f3','ratify-lane silence-based shipping");
    expect(compactSeed).toContain("cron checks ratify-lane decisions past silence threshold");
    expect(compactSeed).toContain("auto-promotes to shadow_ship and notifies owner");
    expect(compactSeed).toContain("array['f3.1']");

    expect(compactPlan).toContain("ratify-lane silence-based shipping");
    expect(compactPlan).toContain("silence threshold = 7 days");
    expect(compactPlan).toContain("ships in shadow mode");
    expect(compactGoLive).toContain("silence-based promotion runs on a cron");
    expect(compactCatalog).toContain("qep-151 | done | 2026-05-21 | f3.2");
  });

  it("registers the edge function and service-role cron gate", () => {
    expect(compactConfig).toContain("[functions.ratify-silence-runner]");
    expect(compactConfig).toContain("verify_jwt = false");

    expect(compactRunner).toContain("if (req.method !== \"post\")");
    expect(compactRunner).toContain("if (!isservicerolecaller(req))");
    expect(compactRunner).toContain("return safejsonerror(\"forbidden\", 403");
    expect(compactRunner).toContain("const defaulT_actor".toLowerCase());
    expect(compactRunner).toContain("ratify-silence-runner");
  });

  it("pins RATIFY eligibility and dry-run/promotion behavior", () => {
    expect(compactRunner).toContain(".from(\"qep_decisions\")");
    expect(compactRunner).toContain(".in(\"status\", [\"open\", \"escalated\"])");
    expect(compactRunner).toContain(".eq(\"lane\", \"ratify\")");
    expect(compactRunner).toContain("isratifysilenceeligible({ decision, now })");
    expect(compactRunner).toContain("const dryrun = body.dry_run === true");
    expect(compactRunner).toContain("would_promote: dryrun");
    expect(compactRunner).toContain("promoted_count");
    expect(compactRunner).toContain("admin.rpc(\"resolve_qep_decision\"");
    expect(compactRunner).toContain("p_target_status: \"shadow_ship\"");
    expect(compactRunner).toContain("p_answered_option: decision.recommended_option");
    expect(compactRunner).toContain("p_context: aipreppacket");
  });

  it("pins owner notifications and audit packet stamping", () => {
    expect(compactRunner).toContain("attemptnotifications");
    expect(compactRunner).toContain("invokefunction(\"decision-linear-comment\"");
    expect(compactRunner).toContain("linear_comment");
    expect(compactRunner).toContain("invokefunction(\"decision-email-card\"");
    expect(compactRunner).toContain("email_card");
    expect(compactRunner).toContain("owner_email_missing");
    expect(compactRunner).toContain("stampratifysilencepacket");
    expect(compactRunner).toContain("notification_attempts");

    expect(compactRunnerLogic).toContain("const ratify_default_silence_days = 7");
    expect(compactRunnerLogic).toContain("return math.max(1, math.floor(raw))");
    expect(compactRunnerLogic).toContain("if (lane !== \"ratify\") return false");
    expect(compactRunnerLogic).toContain("if (status !== \"open\" && status !== \"escalated\") return false");
    expect(compactRunnerLogic).toContain("if (!recommended) return false");
    expect(compactRunnerLogic).toContain("base.ratify_silence_last_run = payload");
  });

  it("pins the guarded hourly cron registration", () => {
    expect(compactCloseout).toContain("pg_cron not installed");
    expect(compactCloseout).toContain("pg_net not installed");
    expect(compactCloseout).toContain("where jobname = 'flow-runner'");
    expect(compactCloseout).toContain("x-internal-service-secret");
    expect(compactCloseout).toContain("/functions/v1/ratify-silence-runner");
    expect(compactCloseout).toContain("body := '{\"dry_run\": false, \"limit\": 100, \"actor\": \"ratify-silence-cron\"}'::jsonb");
    expect(compactCloseout).toContain("cron.unschedule('qep-ratify-silence-runner-hourly')");
    expect(compactCloseout).toContain("cron.schedule( 'qep-ratify-silence-runner-hourly', '17 * * * *'");
  });

  it("pins resolver guard, focused tests, and live boundaries", () => {
    expect(compactResolutionAuthority).toContain("elsif v_target_status = 'shadow_ship'::public.qep_decision_status");
    expect(compactResolutionAuthority).toContain("shadow_ship is only valid for ratify lane decisions");
    expect(compactResolutionAuthority).toContain("insert into public.qep_decision_resolution_audit");

    expect(compactRunnerLogicTest).toContain("eligible when ratify open decision exceeds default 7-day threshold");
    expect(compactRunnerLogicTest).toContain("not eligible when lane is not ratify");
    expect(compactRunnerLogicTest).toContain("not eligible when recommended option is missing");
    expect(compactRunnerLogicTest).toContain("threshold clamps to at least 1 day");
    expect(compactRunnerLogicTest).toContain("packet stamp preserves existing keys");

    expect(compactCloseout).toContain("does not mark f3.3, f4.1, f4.2, f4.3, f4.4, f5.1, or f5.2");
    expect(compactCloseout).toContain("no production cron tick or live owner silence window was observed");
    expect(compactCloseout).toContain("lineaR_api_key".toLowerCase());
    expect(compactCloseout).toContain("decision_magic_link_base_url");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });
});
