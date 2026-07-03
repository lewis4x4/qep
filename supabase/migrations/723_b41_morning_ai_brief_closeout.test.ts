import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

function readSourceTree(dir: string): string {
  const root = join(process.cwd(), dir);
  const chunks: string[] = [];
  const visit = (path: string) => {
    for (const name of readdirSync(path)) {
      const fullPath = join(path, name);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        if (name === "node_modules" || name === "dist") continue;
        visit(fullPath);
        continue;
      }
      if (/\.(ts|tsx|js|jsx)$/.test(name)) {
        chunks.push(readFileSync(fullPath, "utf8"));
      }
    }
  };
  visit(root);
  return chunks.join("\n");
}

const closeoutSql = readText("supabase", "migrations", "723_b41_morning_ai_brief_closeout.sql");
const etCronSql = readText("supabase", "migrations", "606_morning_briefing_cron_et_semantics.sql");
const briefingTime = readText("supabase", "functions", "_shared", "briefing-time.ts");
const briefingTimeTest = readText("supabase", "functions", "_shared", "briefing-time.test.ts");
const morningBriefingFn = readText("supabase", "functions", "morning-briefing", "index.ts");
const salesApi = readText("apps", "web", "src", "features", "sales", "lib", "sales-api.ts");
const salesApiTest = readText("apps", "web", "src", "features", "sales", "lib", "__tests__", "sales-api.today-briefing.test.ts");
const normalizers = readText("apps", "web", "src", "features", "sales", "lib", "sales-api-normalizers.ts");
const normalizersTest = readText("apps", "web", "src", "features", "sales", "lib", "sales-api-normalizers.test.ts");
const todayFeed = readText("apps", "web", "src", "features", "sales", "hooks", "useTodayFeed.ts");
const appSource = readSourceTree("apps/web/src");

const compactCloseout = compact(closeoutSql);
const compactEtCronSql = compact(etCronSql);
const compactBriefingTime = compact(briefingTime);
const compactBriefingTimeTest = compact(briefingTimeTest);
const compactMorningBriefingFn = compact(morningBriefingFn);
const compactSalesApi = compact(salesApi);
const compactSalesApiTest = compact(salesApiTest);
const compactNormalizers = compact(normalizers);
const compactNormalizersTest = compact(normalizersTest);
const compactTodayFeed = compact(todayFeed);
const compactAppSource = compact(appSource);

describe("723_b41_morning_ai_brief_closeout.sql contract", () => {
  it("marks only B4.1 shipped and records canonical morning brief evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'b4.1'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("one canonical ai morning brief path");
    expect(compactCloseout).not.toContain("where task_id = 'b4.2'");
    expect(compactCloseout).not.toContain("where task_id = 'b5.1'");
  });

  it("keeps live cron/provider boundaries explicit", () => {
    expect(compactCloseout).toContain("cron/job execution was not verified");
    expect(compactCloseout).toContain("no live provider-generated briefing");
    expect(compactCloseout).toContain("generate-daily-briefing remains legacy compatibility");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });

  it("documents and schedules 6 AM America/New_York semantics", () => {
    expect(compactEtCronSql).toContain("public.morning_briefings the canonical sales today briefing path");
    expect(compactEtCronSql).toContain("6:00 am america/new_york");
    expect(compactEtCronSql).toContain("'0 10,11 * * *'");
    expect(compactEtCronSql).toContain("'morning-briefing-daily'");
    expect(compactEtCronSql).toContain("body := '{\"batch\": true, \"enforce_et_hour\": 6}'::jsonb");
    expect(compactEtCronSql).toContain("pg_cron stores schedules in utc and cannot express dst-aware local time");
    expect(compactEtCronSql).toContain("pg_cron not installed");
    expect(compactEtCronSql).toContain("pg_net not installed");
  });

  it("enforces the ET hour in shared code and tests both DST seasons", () => {
    expect(compactBriefingTime).toContain("const default_time_zone = \"america/new_york\"");
    expect(compactBriefingTime).toContain("export function getdateintimezone");
    expect(compactBriefingTime).toContain("export function gethourintimezone");
    expect(compactBriefingTime).toContain("export function shouldrunetscheduledbatch");
    expect(compactBriefingTime).toContain("if (body.regenerate === true) return true");
    expect(compactBriefingTime).toContain("return gethourintimezone(now, default_time_zone) === expectedhour");
    expect(compactBriefingTimeTest).toContain("allows the edt 6 am tick");
    expect(compactBriefingTimeTest).toContain("allows the est 6 am tick");
    expect(compactBriefingTimeTest).toContain("skips the non-6 am paired dst tick");
    expect(compactBriefingTimeTest).toContain("does not gate manual or regenerate calls");
  });

  it("writes Sales Today content into morning_briefings and gates cron batches", () => {
    expect(compactMorningBriefingFn).toContain("shouldrunetscheduledbatch");
    expect(compactMorningBriefingFn).toContain("outside_enforced_america_new_york_hour");
    expect(compactMorningBriefingFn).toContain("const today = getdateintimezone()");
    expect(compactMorningBriefingFn).toContain(".from(\"morning_briefings\")");
    expect(compactMorningBriefingFn).toContain("briefing_date: today");
    expect(compactMorningBriefingFn).toContain("sales_today: salestoday");
    expect(compactMorningBriefingFn).toContain("onconflict: \"user_id,briefing_date\"");
    expect(compactMorningBriefingFn).not.toContain(".from(\"daily_briefings\")");
  });

  it("makes Sales Today read morning_briefings before invoking generation", () => {
    expect(compactSalesApi).toContain("function getnewyorkdate");
    expect(compactSalesApi).toContain(".from(\"morning_briefings\")");
    expect(compactSalesApi).toContain(".select(\"id, content, data, briefing_date, created_at\")");
    expect(compactSalesApi).toContain("const existing = await readtodaymorningbriefing(user.id, today)");
    expect(compactSalesApi).toContain("if (existing) return existing");
    expect(compactSalesApi).toContain("supabase.functions.invoke<morningbriefinggenerateresponse>( \"morning-briefing\"");
    expect(compactSalesApi).toContain("return readtodaymorningbriefing(user.id, today)");
    expect(compactSalesApi).not.toContain(".from(\"daily_briefings\")");
    expect(compactSalesApiTest).toContain("reads an existing morning_briefings row without regenerating");
    expect(compactSalesApiTest).toContain("generates once synchronously when today's morning_briefings row is missing");
    expect(compactSalesApiTest).toContain("re-reads once after generation when the function returns no briefing payload");
  });

  it("keeps daily_briefings only as deprecated compatibility in app code", () => {
    expect(compactNormalizers).toContain("@deprecated sales today now reads morning_briefings via normalizetodaybriefing");
    expect(compactNormalizers).toContain("export function normalizedailybriefing");
    expect(compactNormalizers).toContain("export function normalizetodaybriefing");
    expect(compactNormalizers).toContain("normalizebriefingcontentfrommorningdata");
    expect(compactNormalizers).toContain("isrecord(data.sales_today)");
    expect(compactNormalizersTest).toContain("normalizes morning briefing rows with sales_today projection");
    expect(compactNormalizersTest).toContain("derives safe stats for legacy morning briefing rows without sales_today");
    expect(compactNormalizersTest).toContain("keeps deprecated daily briefing payload normalization");
    expect(compactAppSource).not.toContain(".from(\"daily_briefings\")");
    expect(compactAppSource).not.toContain(".from('daily_briefings')");
  });

  it("routes the Today feed and floor briefing through fetchTodayBriefing", () => {
    expect(compactTodayFeed).toContain("import { fetchtodaybriefing, fetchreppipeline }");
    expect(compactTodayFeed).toContain("queryfn: fetchtodaybriefing");
    expect(compactTodayFeed).toContain("briefing = briefingquery.data?.briefing_content ?? null");
    expect(compactTodayFeed).toContain("keep the llm-backed briefing off the first-paint loading gate");
  });
});
