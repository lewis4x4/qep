/** Private, isolated PostgreSQL for behavior tests; never connects to a linked project. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, lstatSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const bin = [process.env.QEP_POSTGRES_BIN, "/usr/lib/postgresql/18/bin", "/usr/lib/postgresql/17/bin", "/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin", "/opt/homebrew/opt/postgresql@17/bin", "/opt/homebrew/opt/postgresql@18/bin", ...((process.env.PATH ?? "").split(":"))]
  .find((p) => p && existsSync(join(p, "initdb")) && existsSync(join(p, "pg_ctl")));
export const hasScratchPostgres = Boolean(bin);
const env = { ...process.env, LC_ALL: "C", LANG: "C" };
function run(name: string, args: string[]) {
  const result = spawnSync(join(bin!, name), args, { env, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${name}: ${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

export function withScratchPostgres(work: (query: (sql: string) => string) => void) {
  if (!bin) throw new Error("PostgreSQL test binaries unavailable");
  const runs = join(homedir(), ".hermes/tmp/agent-runs");
  mkdirSync(runs, { recursive: true });
  const root = mkdtempSync(join(runs, "qft-"));
  const data = join(root, "data"), socket = join(root, "socket");
  const port = String(25000 + Math.floor(Math.random() * 15000));
  const manifest = join(root, "manifest.json");
  const writeManifest = (artifacts: string[]) => writeFileSync(manifest, JSON.stringify({ schema_version: 1, run_id: root.split("/").at(-1), created_by: "codex", artifacts }, null, 2), { mode: 0o600 });
  writeManifest([data, socket, join(root, "postgres.log")]);
  mkdirSync(socket);
  try {
    run("initdb", ["-D", data, "--auth=trust", "--username=postgres", "--no-locale"]);
    run("pg_ctl", ["-D", data, "-l", join(root, "postgres.log"), "-o", `-F -k ${socket} -p ${port} -c listen_addresses=''`, "start"]);
    let sequence = 0;
    work((sql) => {
      const path = join(root, `query-${sequence++}.sql`);
      writeFileSync(path, sql, { mode: 0o600 });
      return run("psql", ["-h", socket, "-p", port, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-f", path]);
    });
  } finally {
    if (existsSync(data)) spawnSync(join(bin, "pg_ctl"), ["-D", data, "-m", "fast", "stop"], { env, encoding: "utf8" });
    const files: string[] = [], dirs: string[] = [];
    function walk(path: string) {
      for (const name of readdirSync(path)) {
        const full = join(path, name), stat = lstatSync(full);
        if (stat.isSymbolicLink()) throw new Error(`Unexpected test symlink retained: ${full}`);
        if (stat.isDirectory()) { walk(full); dirs.push(full); }
        else if (full !== manifest) files.push(full);
      }
    }
    walk(root);
    const steward = spawnSync("which", ["jarvis-storage-steward"], { encoding: "utf8" });
    for (let offset = 0; offset < files.length; offset += 900) {
      const batch = files.slice(offset, offset + 900);
      writeManifest(batch);
      if (steward.status === 0) {
        let verified = spawnSync(steward.stdout.trim(), ["cleanup-run", "--manifest", manifest], { encoding: "utf8" });
        for (let attempt = 0; verified.status !== 0 && /busy|maintenance lock/i.test(`${verified.stderr}${verified.stdout}`) && attempt < 40; attempt++) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
          verified = spawnSync(steward.stdout.trim(), ["cleanup-run", "--manifest", manifest], { encoding: "utf8" });
        }
        if (verified.status !== 0) throw new Error(`Test artifacts retained: ${verified.stderr || verified.stdout}`);
      }
      for (const path of batch) unlinkSync(path);
    }
    // Every directory was created by this exact test; rmdir fails if anything remains.
    for (const path of dirs) rmdirSync(path);
    writeManifest([]); // retain the private run provenance; no generic deferred deletion
  }
}
