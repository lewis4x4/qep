import { test, expect } from "bun:test";
import { chromium } from "playwright";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, lstatSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
(existsSync(chrome) ? test : test.skip)("native IndexedDB clock survives localStorage failure, synchronization and browser refresh",async()=>{
 const build=await Bun.build({entrypoints:[new URL('./service-offline-field-mode.ts',import.meta.url).pathname],target:"browser",external:["./api"],write:false});
 if(!build.success)throw new Error("Offline module build failed");
 const code=await build.outputs[0].text();
 const server=Bun.serve({port:0,hostname:"127.0.0.1",fetch(req){return new Response(new URL(req.url).pathname==="/field.js"?code:"<!doctype html><title>Local offline storage test</title>",{headers:{"Content-Type":new URL(req.url).pathname==="/field.js"?"text/javascript":"text/html"}});}});
 const base=join(homedir(),'.hermes/tmp/agent-runs');mkdirSync(base,{recursive:true});const run=mkdtempSync(join(base,'qep-native-idb-'));const profile=join(run,'browser');const manifest=join(run,'manifest.json');
 writeFileSync(manifest,JSON.stringify({schema_version:1,run_id:run.split('/').at(-1),created_by:'codex',artifacts:[profile]}),{mode:0o600});
 let browser:Awaited<ReturnType<typeof chromium.launchPersistentContext>>|undefined;
 try {
  browser=await chromium.launchPersistentContext(profile,{executablePath:chrome,headless:true});
  await browser.addInitScript(()=>{Storage.prototype.setItem=()=>{throw new Error('QuotaExceededError');};});
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.port}`);
  await page.addScriptTag({type:"module",content:code+"\nwindow.__fieldModule = { createOfflineFieldStore };"});
  const started=await page.evaluate(async()=>{
   const module=(window as unknown as {__fieldModule: Pick<typeof import("./service-offline-field-mode"), "createOfflineFieldStore">}).__fieldModule;const store=module.createOfflineFieldStore({userId:'tech',workspaceId:'ws'});
   await store.enqueueOfflineFieldAction({kind:'clock_start',jobId:'job',sessionId:'session',occurredAt:'2026-09-06T10:00:00Z'});
   await store.drainOfflineFieldQueue(async()=>({}));
   return {clock:await store.getActiveClock('job'),queue:(await store.getOfflineFieldQueue()).length};
  });
  expect(started.clock?.sessionId).toBe('session');expect(started.queue).toBe(0);
  await page.reload();
  await page.addScriptTag({type:"module",content:code+"\nwindow.__fieldModule = { createOfflineFieldStore };"});
  const recovered=await page.evaluate(async()=>{
   const module=(window as unknown as {__fieldModule: Pick<typeof import("./service-offline-field-mode"), "createOfflineFieldStore">}).__fieldModule;const store=module.createOfflineFieldStore({userId:'tech',workspaceId:'ws'});
   const clock=await store.getActiveClock('job');
   await store.enqueueOfflineFieldAction({kind:'clock_stop',jobId:'job',sessionId:clock.sessionId,occurredAt:'2026-09-06T11:00:00Z'});
   return {before:clock,after:await store.getActiveClock('job'),queue:(await store.getOfflineFieldQueue()).map((row:{kind:string})=>row.kind)};
  });
  expect(recovered.before.sessionId).toBe('session');expect(recovered.after).toBeNull();expect(recovered.queue).toEqual(['clock_stop']);
  await page.evaluate(async()=>{
    const store=(window as unknown as {__fieldModule: Pick<typeof import("./service-offline-field-mode"), "createOfflineFieldStore">}).__fieldModule.createOfflineFieldStore({userId:'tech',workspaceId:'ws'});
    await store.drainOfflineFieldQueue(async()=>({}));
    await store.enqueueOfflineFieldAction({kind:'clock_start',jobId:'job',sessionId:'S1',occurredAt:'2026-09-06T12:00:00Z'});
    await store.drainOfflineFieldQueue(async()=>({}));
    await store.enqueueOfflineFieldAction({kind:'clock_stop',jobId:'job',sessionId:'S1',occurredAt:'2026-09-06T13:00:00Z'});
    await store.enqueueOfflineFieldAction({kind:'clock_start',jobId:'job',sessionId:'S2',occurredAt:'2026-09-06T13:01:00Z'});
    await store.drainOfflineFieldQueue(async action=>{if(action.kind==='clock_stop' && action.sessionId==='S1')throw new Error('response lost after commit');return {};});
  });
  await page.reload();await page.addScriptTag({type:'module',content:code+'\nwindow.__fieldModule = { createOfflineFieldStore };'});
  const afterLostResponse=await page.evaluate(async()=>{
    const store=(window as unknown as {__fieldModule: Pick<typeof import("./service-offline-field-mode"), "createOfflineFieldStore">}).__fieldModule.createOfflineFieldStore({userId:'tech',workspaceId:'ws'});
    const active=await store.getActiveClock('job');
    await store.enqueueOfflineFieldAction({kind:'clock_stop',jobId:'job',sessionId:active!.sessionId,occurredAt:'2026-09-06T14:00:00Z'});
    const sessions:string[]=[];await store.drainOfflineFieldQueue(async action=>{if(action.kind==='clock_stop')sessions.push(action.sessionId);return {};});
    return {active:active!.sessionId,sessions,final:await store.getActiveClock('job')};
  });
  expect(afterLostResponse.active).toBe('S2');expect(afterLostResponse.sessions).toEqual(['S1','S2']);expect(afterLostResponse.final).toBeNull();

 } finally {
  await browser?.close();server.stop(true);
  const files:string[]=[],dirs:string[]=[],retainedLinks:string[]=[];
  function walk(dir:string){for(const name of readdirSync(dir)){const path=join(dir,name),stat=lstatSync(path);if(stat.isSymbolicLink()){retainedLinks.push(path);continue;}if(stat.isDirectory()){walk(path);dirs.push(path);}else if(path!==manifest)files.push(path);}}
  walk(run);
  const record=(artifacts:string[])=>writeFileSync(manifest,JSON.stringify({schema_version:1,run_id:run.split('/').at(-1),created_by:'codex',artifacts}),{mode:0o600});
  record(files);
  const steward=spawnSync('jarvis-storage-steward',['cleanup-run','--manifest',manifest],{encoding:'utf8'});
  if(steward.status!==0)throw new Error(`Native test regular artifacts retained: ${steward.stderr || steward.stdout}`);
  for(const file of files)unlinkSync(file);
  for(const dir of dirs)if(readdirSync(dir).length===0)rmdirSync(dir);
  // Steward forbids symlink artifacts. Retain exact links without following their targets;
  // housekeeping limitations must not turn completed application assertions into a failure.
  record(retainedLinks);
  if(retainedLinks.length) {
    const linkCheck=spawnSync('jarvis-storage-steward',['cleanup-run','--manifest',manifest],{encoding:'utf8'});
    console.warn(`Native assertions completed; ${retainedLinks.length} exact browser link(s) retained without following targets (steward status ${linkCheck.status}). Manifest: ${manifest}`);
  }

 }
},60000);
