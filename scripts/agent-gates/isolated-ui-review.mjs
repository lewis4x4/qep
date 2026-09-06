#!/usr/bin/env node
/** Actual production bundle + localhost + test-only synthetic auth/API fixtures. Never signs into a hosted account. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, readdir, unlink, rmdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join, extname, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DUMMY_SUPABASE, WORKSPACE, profileFor, scenarios, apiResponse } from "./isolated-ui-fixtures.mjs";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const app = join(repo, "apps/web");
const require = createRequire(join(app, "package.json"));
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;
const output = process.env.UI_REVIEW_OUTPUT ?? join(repo, "test-results", "isolated-ui");
const themes = (process.env.UI_REVIEW_THEMES ?? "light,dark").split(",");
const widths = (process.env.UI_REVIEW_WIDTHS ?? "375,768,1024,1440").split(",").map(Number);
const chosen = scenarios.filter((scenario) => !process.env.UI_REVIEW_SCENARIOS || process.env.UI_REVIEW_SCENARIOS.split(",").includes(scenario.id));
const started = Date.now();
const runs = join(homedir(), ".hermes/tmp/agent-runs"); await mkdir(runs, { recursive: true });
const scratch = await mkdtemp(join(runs, "qep-isolated-ui-")); await chmod(scratch, 0o700);
process.env.TMPDIR = scratch;
const buildDir = join(scratch, "build");
const manifestPath = join(scratch, "manifest.json");
await writeFile(manifestPath, JSON.stringify({ schema_version: 1, run_id: scratch.split("/").at(-1), created_by: "codex", artifacts: [] }), { mode: 0o600 });
await mkdir(output, { recursive: true });
await mkdir(join(output, "screenshots"), { recursive: true });
function run(command, args, options = {}) { return new Promise((resolveRun, reject) => {
 const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options }); let log = "";
 child.stdout.on("data", (chunk) => { log += chunk; }); child.stderr.on("data", (chunk) => { log += chunk; });
 child.on("error", reject); child.on("exit", (code) => code === 0 ? resolveRun(log) : reject(new Error(`${command} exited${code}\n${log.slice(-8000)}`)));
}); }
async function sourceFingerprint() {
 const names = (await run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "apps/web/src", "apps/web/index.html", "apps/web/vite.config.ts", "shared", "scripts/agent-gates/isolated-ui-review.mjs", "scripts/agent-gates/isolated-ui-fixtures.mjs"], { cwd: repo })).split("\0").filter(Boolean).filter(name => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(name) && !name.includes("/__tests__/" )).sort();
 const hash=createHash("sha256");
 for(const name of names) {hash.update(name+"\0");hash.update(await readFile(join(repo,name)));}
 return { sha256:hash.digest("hex"), fileCount:names.length };
}
const revisionEvidence = { revision:(await run("git",["rev-parse","HEAD"],{cwd:repo})).trim(), diffSha256:createHash("sha256").update(await run("git",["diff","--no-ext-diff","--binary","HEAD"],{cwd:repo})).digest("hex"), sourceBeforeBuild:await sourceFingerprint(), fixture:"scripts/agent-gates/isolated-ui-fixtures.mjs" };
const results = [];
let browser, server;
try {
 const buildEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: scratch, NODE_ENV: "production", VITE_SUPABASE_URL: DUMMY_SUPABASE, VITE_SUPABASE_ANON_KEY: "isolated-fixture-anon-key-not-real", VITE_SENTRY_DSN: "", SENTRY_AUTH_TOKEN: "", SENTRY_ORG: "", SENTRY_PROJECT: "" };
 console.log("Building actual application with dummy backend and telemetry upload disabled");
 const buildLog = await run(process.execPath, [join(dirname(require.resolve("vite/package.json")), "bin/vite.js"), "build", "--outDir", buildDir, "--emptyOutDir"], { cwd: app, env: buildEnv });
 await writeFile(join(output, "build.log"), buildLog);
 revisionEvidence.sourceAfterBuild = await sourceFingerprint();
 revisionEvidence.sourceChangedDuringBuild = revisionEvidence.sourceBeforeBuild.sha256 !== revisionEvidence.sourceAfterBuild.sha256;
 const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".jpg": "image/jpeg", ".webp": "image/webp" };
 server = createServer(async (req, res) => {
  try {
   const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
   let path = resolve(buildDir, `.${pathname}`);
   if (!path.startsWith(buildDir + "/") && path !== buildDir) { res.writeHead(403); res.end(); return; }
   if (path === buildDir || !existsSync(path) || !extname(path)) path = join(buildDir, "index.html");
   const data = await readFile(path); res.writeHead(200, { "Content-Type": mime[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-store" }); res.end(data);
  } catch { res.writeHead(404); res.end("not found"); }
 });
 await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
 const base = `http://127.0.0.1:${server.address().port}`;
 browser = await chromium.launch({ headless: true });
 for (const scenario of chosen) for (const width of widths) for (const theme of themes) {
  const height = width === 375 ? 812 : width === 768 ? 1024 : 900;
  const profile = profileFor(scenario.role);
  const calls = [], blocked = [], consoleErrors = [], pageErrors = [];
  const log = { unmodeled: new Set(), emptyTables: new Set() };
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, deviceScaleFactor: 1, reducedMotion: "reduce" });
  context.setDefaultTimeout(20000);
  await context.route("**/*", async (route) => {
   const request = route.request(); const url = new URL(request.url());
   if (url.origin === base) return route.continue();
   if (url.origin === DUMMY_SUPABASE) {
    calls.push({ method: request.method(), path: url.pathname });
    const payload = apiResponse(url, request, profile, log);
    const rows = Array.isArray(payload) ? payload.length : payload == null ? 0 : 1;
    return route.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": base, "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,HEAD,OPTIONS", "Content-Type": "application/json", "Content-Range": rows ? `0-${rows-1}/${rows}` : "*/0" }, body: request.method() === "HEAD" || request.method() === "OPTIONS" ? "" : JSON.stringify(payload) });
   }
   blocked.push({ host: url.host, path: url.pathname }); await route.abort("blockedbyclient");
  });
  await context.addInitScript(({ profile, dummy, workspace }) => {
   const encode = (value) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
   const expires = Math.floor(Date.now()/1000)+3600;
   const access_token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: profile.id, role: "authenticated", aud: "authenticated", exp: expires, iss: `${dummy}/auth/v1` })}.isolated-test-signature`;
   const user = { id: profile.id, email: profile.email, aud: "authenticated", role: "authenticated", app_metadata: { provider: "email", workspace_id: workspace }, user_metadata: {}, created_at: new Date().toISOString() };
   localStorage.setItem("sb-qep-ui-test-auth-token", JSON.stringify({ access_token, refresh_token: "isolated-refresh-not-real", expires_at: expires, expires_in: 3600, token_type: "bearer", user }));
   sessionStorage.setItem(`qep-auth-profile:${profile.id}`, JSON.stringify({ cachedAt: Date.now(), profile }));
  }, { profile, dummy: DUMMY_SUPABASE, workspace: WORKSPACE });
  const page = await context.newPage();
  if (page.routeWebSocket) await page.routeWebSocket("**/*", (socket) => socket.close());
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text().slice(0,500)); });
  const record = { id: scenario.id, role: scenario.role, route: scenario.route, viewport: { width, height }, theme, mockScope: "Actual built App router and components; synthetic auth session verified by in-memory mocked Supabase API; no production authentication", status: "fail", screenshots: [], checks: {}, calls, blockedExternal: blocked, pageErrors, consoleErrors };
  try {
   await page.goto(`${base}${scenario.route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
   await page.getByText(scenario.ready, { exact: false }).filter({ visible: true }).first().waitFor({ timeout: 20000 });
   if (scenario.prepare) await scenario.prepare(page);
   if (scenario.target) await page.getByText(scenario.target, { exact: false }).filter({ visible: true }).first().waitFor({ timeout: 20000 });
   await page.waitForTimeout(650);
   if (["manager", "owner"].includes(scenario.role)) {
    await page.getByRole("button", { name: "User menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "Open Rep Test Session", exact: true }).waitFor();
    record.checks.specialistAction = { pass: true, action: "Menu entry present; privileged action not invoked" };
    await page.keyboard.press("Escape");
   }
   const body = await page.locator("body").innerText();
   record.checks.boot = { pass: !body.includes("Something went wrong") && !body.includes("Sign in to QEP"), pathname: new URL(page.url()).pathname };
   const topShot = join(output, "screenshots", `${scenario.id}-${theme}-${width}-top.png`);
   await page.evaluate(() => window.scrollTo(0,0)); await page.screenshot({ path: topShot, animations: "disabled" }); record.screenshots.push(relative(output, topShot));
   if (scenario.target) {
    const target = page.getByText(scenario.target, { exact: false }).filter({ visible: true }).first();
    if (await target.count()) { await target.evaluate(element => element.scrollIntoView({ block: "center" })); await page.waitForTimeout(350); }
   }
   const contentShot = join(output, "screenshots", `${scenario.id}-${theme}-${width}-content.png`);
   await page.screenshot({ path: contentShot, animations: "disabled" }); record.screenshots.push(relative(output, contentShot));
   record.checks.overflow = await page.evaluate(() => ({ pass: document.documentElement.scrollWidth <= innerWidth + 1, scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, offenders: [...document.querySelectorAll("body *")].filter(el => { const r=el.getBoundingClientRect(); return r.width>0 && r.right>innerWidth+1 && getComputedStyle(el).position!=="absolute"; }).slice(0,12).map(el=>({tag:el.tagName,className:String(el.className).slice(0,120),text:el.textContent?.trim().slice(0,90),right:Math.round(el.getBoundingClientRect().right)})) }));
   await page.keyboard.press("Tab");
   await page.waitForTimeout(300);
   record.checks.focus = await page.evaluate(() => { const el=document.activeElement; const r=el?.getBoundingClientRect(); const style=el ? getComputedStyle(el) : null; const name=el?.getAttribute("aria-label")||el?.labels?.[0]?.textContent||el?.getAttribute("title")||el?.textContent?.trim()||el?.getAttribute("placeholder")||""; const x=r ? r.left+r.width/2 : -1, y=r ? r.top+r.height/2 : -1; const hit=document.elementFromPoint(x,y); const unobscured=!!el&&!!hit&&(hit===el||el.contains(hit)); const indicator=!!style&&((style.outlineStyle!=="none"&&parseFloat(style.outlineWidth)>0&&!/transparent|rgba\([^)]*, 0\)/.test(style.outlineColor))||style.boxShadow!=="none"); return {pass:!!el&&el!==document.body&&!!r&&r.width>0&&r.height>0&&!!name&&unobscured&&indicator,tag:el?.tagName,name:name.slice(0,100),rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,hit:hit?{tag:hit.tagName,className:String(hit.className).slice(0,120),name:hit.getAttribute("aria-label")||hit.textContent?.trim().slice(0,80)}:null,unobscured,indicator,focusVisible:el?.matches(":focus-visible"),outline:style?.outline,boxShadow:style?.boxShadow}; });
   const axe = await new AxeBuilder({ page }).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze();
   const violations = axe.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,help:v.help,helpUrl:v.helpUrl,nodes:v.nodes.map(n=>({target:n.target,html:n.html.slice(0,700),failureSummary:n.failureSummary}))}));
   record.checks.accessibility={pass:!violations.some(v=>v.impact==="serious"||v.impact==="critical"),violations};
   record.runtimeErrors = consoleErrors.filter(message => /TypeError|ReferenceError|\[flare:crashed\]/.test(message));
   record.status = record.runtimeErrors.length === 0 && record.checks.boot.pass && record.checks.overflow.pass && record.checks.focus.pass && record.checks.accessibility.pass && pageErrors.length===0 ? "pass" : "fail";
  } catch (error) {
   record.error = error.message;
   record.visibleText = (await page.locator("body").innerText().catch(()=>"")).slice(0,1600);
   const failureShot=join(output,"screenshots",`${scenario.id}-${theme}-${width}-failure.png`); await page.screenshot({path:failureShot}).catch(()=>{});record.screenshots.push(relative(output,failureShot));
  }
  record.unmodeledEndpoints=[...log.unmodeled]; record.emptyFixtureTables=[...log.emptyTables]; results.push(record);
  console.log(`${record.status.toUpperCase()} ${scenario.id} ${theme} ${width}${record.error?` ${record.error.split("\n")[0]}`:""}`);
  await writeFile(join(output, "progress.json"), JSON.stringify(results,null,2));
  await context.close();
 }
} catch (error) { console.error(error.message); results.push({ id:"harness",status:"fail",error:error.message }); }
finally {
 await browser?.close(); if(server) await new Promise(resolveClose=>server.close(resolveClose));
 const files=[], directories=[];
 async function walk(dir) { for(const entry of await readdir(dir,{withFileTypes:true})) { const path=join(dir,entry.name);if(entry.isDirectory()){await walk(path);directories.push(path);}else files.push(path); } }
 await walk(scratch);
 const steward=join(homedir(),".local/bin/jarvis-storage-steward");
 for(let i=0;i<files.length;i+=900) {const batch=files.slice(i,i+900).filter(p=>p!==manifestPath);await writeFile(manifestPath,JSON.stringify({schema_version:1,run_id:scratch.split("/").at(-1),created_by:"codex",artifacts:batch}),{mode:0o600});if(existsSync(steward))await run(steward,["cleanup-run","--manifest",manifestPath]);for(const path of batch)await unlink(path);}
 await unlink(manifestPath);for(const dir of directories)await rmdir(dir);await rmdir(scratch);
}
const failed=results.filter(r=>r.status!=="pass").length;
const gateFailed = failed > 0 || revisionEvidence.sourceChangedDuringBuild === true;
const report={segment:"qep-review-remediation-20260906",agent:"isolated-cdo-ui-review",timestamp:new Date().toISOString(),verdict:gateFailed?"FAIL":"PASS",mission_alignment:{verdict:gateFailed?"fail":"pass",evidence:"Actual local app screens for service intake, rental qualification, QRM handoffs, technician execution, owner metrics and financial/workforce draft recovery reviewed at four viewport widths.",risk:"Synthetic test identities/API fixtures only; no hosted authorization, real data acceptance or physical-device UAT. Unmodeled supporting endpoints are listed per screen."},revisionEvidence,testProfiles:chosen.map(({id,role,route})=>({id,role,route,synthetic:true})),themes,elapsed_ms:Date.now()-started,total:results.length,passed:results.length-failed,failed,reference_comparison:{status:"not_applicable",reason:"No reference images supplied; objective layout/focus/axe checks and screenshot inspection replace no fidelity score."},checks:[{id:"source-stable-during-build",status:revisionEvidence.sourceChangedDuringBuild?"fail":"pass",required:true},...results.map(r=>({id:`${r.id}-${r.theme??"none"}-${r.viewport?.width??"harness"}`,status:r.status,required:true}))],results};
await writeFile(join(output,"report.json"),JSON.stringify(report,null,2));
console.log(`UI review: ${report.passed}/${report.total} passed. ${join(output,"report.json")}`);
process.exitCode=gateFailed?1:0;
