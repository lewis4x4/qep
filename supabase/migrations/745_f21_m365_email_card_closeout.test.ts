import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "745_f21_m365_email_card_closeout.sql");
const streamFSeed = readText("supabase", "migrations", "597_qep_stream_f_decision_velocity.sql");
const plan = readText("QEP (1)", "QEP_DECISION_INBOX_MOONSHOT_V2.md");
const emailCard = readText("supabase", "functions", "decision-email-card", "index.ts");
const magicLink = readText("supabase", "functions", "decision-magic-link", "index.ts");
const magicShared = readText("supabase", "functions", "_shared", "decision-magic-link.ts");
const magicLogic = readText("supabase", "functions", "decision-magic-link", "logic.ts");
const magicSharedTest = readText("supabase", "functions", "_shared", "decision-magic-link.test.ts");
const magicLogicTest = readText("supabase", "functions", "decision-magic-link", "logic.test.ts");
const config = readText("supabase", "config.toml");
const silenceRunner = readText("supabase", "functions", "ratify-silence-runner", "index.ts");

const compactCloseout = compact(closeoutSql);
const compactSeed = compact(streamFSeed);
const compactPlan = compact(plan);
const compactEmailCard = compact(emailCard);
const compactMagicLink = compact(magicLink);
const compactMagicShared = compact(magicShared);
const compactMagicLogic = compact(magicLogic);
const compactMagicSharedTest = compact(magicSharedTest);
const compactMagicLogicTest = compact(magicLogicTest);
const compactConfig = compact(config);
const compactSilenceRunner = compact(silenceRunner);

describe("745_f21_m365_email_card_closeout.sql contract", () => {
  it("marks only F2.1 shipped with mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'f2.1'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("qep_roadmap_sync_events");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("f21_m365_email_card_closeout");
    expect(compactCloseout).not.toContain("where task_id = 'f2.3'");
    expect(compactCloseout).not.toContain("where task_id = 'f2.5'");
  });

  it("pins the canonical roadmap row and M365 channel spec", () => {
    expect(compactSeed).toContain("'f2.1','f','f2','m365 email card with magic-link buttons'");
    expect(compactSeed).toContain("signed magic-link urls that auto-authenticate and apply the answer");
    expect(compactSeed).toContain("array['f1.5']");

    expect(compactPlan).toContain("m365 email");
    expect(compactPlan).toContain("beautifully formatted card with recommended answer + 3 buttons");
    expect(compactPlan).toContain("signed magic-link urls that auto-authenticate");
    expect(compactPlan).toContain("f2.1 email card ships next");
  });

  it("pins email card rendering, dry-run, auth, and Graph send behavior", () => {
    expect(compactEmailCard).toContain("isservicerolecaller(req)");
    expect(compactEmailCard).toContain("requireserviceuser");
    expect(compactEmailCard).toContain("[\"admin\", \"manager\", \"owner\"].includes(auth.role)");
    expect(compactEmailCard).toContain("recipient_email is required");
    expect(compactEmailCard).toContain("decision_magic_link_base_url");
    expect(compactEmailCard).toContain("resolvedecisionmagiclinksecret");
    expect(compactEmailCard).toContain("buildactionlinks");
    expect(compactEmailCard).toContain("builddecisioncardhtml");
    expect(compactEmailCard).toContain("buttonhtml(\"approve\"");
    expect(compactEmailCard).toContain("buttonhtml(\"block\"");
    expect(compactEmailCard).toContain("buttonhtml(\"need info\"");
    expect(compactEmailCard).toContain("body.dry_run === true");
    expect(compactEmailCard).toContain("onedrive_sync_state");
    expect(compactEmailCard).toContain("selected m365 access token is expired");
    expect(compactEmailCard).toContain("decryptonedrivetoken");
    expect(compactEmailCard).toContain("https://graph.microsoft.com/v1.0/me/sendmail");
    expect(compactEmailCard).toContain("savetosentitems");
  });

  it("pins signed magic-link token security and action application", () => {
    expect(compactMagicShared).toContain("decision_magic_actions = [\"approve\", \"block\", \"need_info\"]");
    expect(compactMagicShared).toContain("hmac");
    expect(compactMagicShared).toContain("sha-256");
    expect(compactMagicShared).toContain("decision_id?: string");
    expect(compactMagicShared).toContain("decision_code?: string");
    expect(compactMagicShared).toContain("owner_role: string");
    expect(compactMagicShared).toContain("exp: number");
    expect(compactMagicShared).toContain("invalid decision magic token signature");
    expect(compactMagicShared).toContain("decision magic token expired");
    expect(compactMagicShared).toContain("buildsigneddecisionactionlink");

    expect(compactMagicLink).toContain("verifydecisionmagictoken(token, secret)");
    expect(compactMagicLink).toContain("decision token mismatch");
    expect(compactMagicLink).toContain("decision owner mismatch");
    expect(compactMagicLink).toContain("builddecisionmagicactionpatch");
    expect(compactMagicLink).toContain("payload.action === \"approve\"");
    expect(compactMagicLink).toContain("admin.rpc(\"resolve_qep_decision\"");
    expect(compactMagicLink).toContain("p_actor: `magic-link:${payload.owner_role}`");
    expect(compactMagicLink).toContain(".from(\"qep_decisions\")");
    expect(compactMagicLink).toContain("decision action applied");

    expect(compactMagicLogic).toContain("magic_link_last_action");
    expect(compactMagicLogic).toContain("status: \"escalated\"");
    expect(compactMagicLogic).toContain("status: \"open\"");
  });

  it("pins registrations, tests, and runner integration", () => {
    expect(compactConfig).toContain("[functions.decision-email-card]");
    expect(compactConfig).toContain("[functions.decision-magic-link]");
    expect(compactConfig).toContain("verify_jwt = false");

    expect(compactMagicSharedTest).toContain("decision magic token signs and verifies");
    expect(compactMagicSharedTest).toContain("decision magic token rejects tampering");
    expect(compactMagicSharedTest).toContain("decision magic token rejects expired payload");
    expect(compactMagicSharedTest).toContain("buildsigneddecisionactionlink includes token query param");
    expect(compactMagicLogicTest).toContain("approve patch preserves magic-link context");
    expect(compactMagicLogicTest).toContain("block patch escalates and stamps packet");
    expect(compactSilenceRunner).toContain("invokefunction(\"decision-email-card\"");
    expect(compactSilenceRunner).toContain("kind: \"email_card\"");
  });

  it("keeps live provider boundaries explicit", () => {
    expect(compactCloseout).toContain("does not mark f2.3, f2.4, f2.5, f3.1, f3.2, or f5.2");
    expect(compactCloseout).toContain("dry-run mode provides local/source-controlled verification");
    expect(compactCloseout).toContain("no live m365 email was sent");
    expect(compactCloseout).toContain("m365 tenant consent, mail.send scope, mailbox token freshness");
    expect(compactCloseout).toContain("no external owner clicked a magic link");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });
});
