import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "727_b22_voice_summary_bullets_closeout.sql");
const summaryColumnSql = readText("supabase", "migrations", "604_voice_captures_summary_bullets.sql");
const summaryHelper = readText("supabase", "functions", "_shared", "voice-capture-summary.ts");
const summaryHelperTest = readText("supabase", "functions", "_shared", "voice-capture-summary.test.ts");
const voiceCapture = readText("supabase", "functions", "voice-capture", "index.ts");
const voiceCaptureSync = readText("supabase", "functions", "voice-capture-sync", "index.ts");
const missingSummaryGuard = readText("apps", "web", "src", "lib", "voice-summary-column.ts");
const voiceCapturePage = readText("apps", "web", "src", "components", "VoiceCapturePage.tsx");
const voiceHistoryPage = readText("apps", "web", "src", "components", "VoiceHistoryPage.tsx");
const summaryComponent = readText("apps", "web", "src", "components", "voice", "VoiceSummaryBullets.tsx");

const compactCloseout = compact(closeoutSql);
const compactSummaryColumn = compact(summaryColumnSql);
const compactSummaryHelper = compact(summaryHelper);
const compactSummaryHelperTest = compact(summaryHelperTest);
const compactVoiceCapture = compact(voiceCapture);
const compactVoiceCaptureSync = compact(voiceCaptureSync);
const compactMissingSummaryGuard = compact(missingSummaryGuard);
const compactVoiceCapturePage = compact(voiceCapturePage);
const compactVoiceHistoryPage = compact(voiceHistoryPage);
const compactSummaryComponent = compact(summaryComponent);

describe("727_b22_voice_summary_bullets_closeout.sql contract", () => {
  it("marks only B2.2 shipped and leaves neighboring voice rows untouched", () => {
    expect(compactCloseout).toContain("where task_id = 'b2.2'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).not.toContain("where task_id = 'b2.1'");
    expect(compactCloseout).not.toContain("where task_id = 'b2.3'");
    expect(compactCloseout).not.toContain("where task_id = 'b2.4'");
    expect(compactCloseout).not.toContain("where task_id = 'b2.5'");
  });

  it("records mission evidence and honest live-provider boundaries", () => {
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("short, grounded ai takeaways");
    expect(compactCloseout).toContain("no live openai summary call");
    expect(compactCloseout).toContain("no live customer call recording");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });

  it("has an additive summary_bullets column with the best-effort 5-8 bullet contract", () => {
    expect(compactSummaryColumn).toContain("alter table public.voice_captures");
    expect(compactSummaryColumn).toContain("add column if not exists summary_bullets text[]");
    expect(compactSummaryColumn).toContain("best-effort 5-8 short bullet summary");
    expect(compactSummaryColumn).toContain("null means not generated or generation failed");
  });

  it("normalizes summary output to 5-8 bullets without accepting undersized summaries", () => {
    expect(compactSummaryHelper).toContain("const min_summary_bullets = 5");
    expect(compactSummaryHelper).toContain("const max_summary_bullets = 8");
    expect(compactSummaryHelper).toContain("if (bullets.length >= max_summary_bullets) break");
    expect(compactSummaryHelper).toContain("return bullets.length >= min_summary_bullets ? bullets : null");
    expect(compactSummaryHelper).toContain("create 5-8 short, specific bullets");
    expect(compactSummaryHelperTest).toContain("strips markers, dedupes, and caps at 8");
    expect(compactSummaryHelperTest).toContain("returns null for fewer than five bullets");
  });

  it("persists transcript/capture state before best-effort summary persistence", () => {
    const finalizeIndex = compactVoiceCapture.indexOf("finalize capture record");
    const summaryIndex = compactVoiceCapture.indexOf("const summarybullets = await persistvoicecapturesummarybulletsbesteffort");
    expect(finalizeIndex).toBeGreaterThan(-1);
    expect(summaryIndex).toBeGreaterThan(finalizeIndex);
    expect(compactVoiceCapture).toContain("summary generation skipped");
    expect(compactVoiceCapture).toContain("return null");
    expect(compactVoiceCapture).toContain("summary_bullets: summarybullets");
  });

  it("keeps sync and schema-cache fallbacks non-blocking", () => {
    expect(compactVoiceCaptureSync).toContain("capture_select_with_summary");
    expect(compactVoiceCaptureSync).toContain("summary_bullets column unavailable; retrying capture load without it");
    expect(compactVoiceCaptureSync).toContain("persistvoicecapturesyncsummarybesteffort");
    expect(compactMissingSummaryGuard).toContain("ismissingsummarybulletscolumnerror");
    expect(compactMissingSummaryGuard).toContain("pgrst204");
    expect(compactMissingSummaryGuard).toContain("42703");
  });

  it("renders bullet summaries above expandable transcript text", () => {
    expect(compactSummaryComponent).toContain("key takeaways");
    expect(compactSummaryComponent).toContain(".slice(0, 8)");
    expect(compactVoiceCapturePage).toContain("<voicesummarybullets bullets={finalsummarybullets} />");
    expect(compactVoiceCapturePage).toContain("<summary classname=\"cursor-pointer font-medium text-muted-foreground\">full transcript</summary>");
    expect(compactVoiceCapturePage).toContain("<voicesummarybullets bullets={summarybullets} />");
    expect(compactVoiceCapturePage).toContain("<details open={!hassummarybullets}");
    expect(compactVoiceHistoryPage).toContain("<voicesummarybullets bullets={note.summary_bullets} compact />");
    expect(compactVoiceHistoryPage).toContain("<summary classname=\"cursor-pointer text-sm font-medium text-muted-foreground\"> transcript </summary>");
  });
});
