/** Reuse a completed visual run only when its exact application/fixture sources still match. */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
const root = process.cwd();
const output = process.env.UI_REVIEW_OUTPUT ?? join(root, "test-results", "isolated-ui");
const reportPath = join(output, "report.json");
function sourceFingerprint() {
 const names=execFileSync("git",["ls-files","-z","--cached","--others","--exclude-standard","apps/web/src","apps/web/index.html","apps/web/vite.config.ts","shared","scripts/agent-gates/isolated-ui-review.mjs","scripts/agent-gates/isolated-ui-fixtures.mjs"],{encoding:"utf8"}).split("\0").filter(Boolean).filter(name=>!/\.(test|spec)\.[cm]?[jt]sx?$/.test(name)&&!name.includes("/__tests__/")).sort();
 const hash=createHash("sha256");for(const name of names){hash.update(name+"\0");hash.update(readFileSync(join(root,name)));}return hash.digest("hex");
}
function validated() {
 if(!existsSync(reportPath))return false;
 const report=JSON.parse(readFileSync(reportPath,"utf8"));
 if(report.verdict!=="PASS"||report.total!==72||report.passed!==72||report.failed!==0||report.revisionEvidence?.sourceChangedDuringBuild!==false)return false;
 const expected=sourceFingerprint();
 if(report.revisionEvidence.sourceBeforeBuild?.sha256!==expected||report.revisionEvidence.sourceAfterBuild?.sha256!==expected)return false;
 if(!Array.isArray(report.results)||report.results.length!==72||report.results.some(r=>r.status!=="pass"))return false;
 for(const result of report.results) {
  if(!Array.isArray(result.screenshots)||result.screenshots.length<2)return false;
  for(const name of result.screenshots){const path=resolve(output,name);if(!path.startsWith(resolve(output)+"/")||!existsSync(path))return false;}
 }
 return true;
}
if(!validated()) {
 const env={...process.env,UI_REVIEW_OUTPUT:output,UI_REVIEW_WIDTHS:"375,768,1024,1440",UI_REVIEW_THEMES:"light,dark"};
 delete env.UI_REVIEW_SCENARIOS;
 const child=spawnSync(process.execPath,["scripts/agent-gates/isolated-ui-review.mjs"],{env,stdio:"inherit"});
 if(child.status!==0||!validated())throw new Error("Isolated visual review did not pass with current source evidence");
}
console.log(JSON.stringify({verdict:"PASS",scope:"actual local app; synthetic auth/API fixtures; no operational acceptance",cases:72,report:reportPath,source_sha256:sourceFingerprint()}));
