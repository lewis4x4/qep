import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "744_c51_telematics_adapter_contract_closeout.sql");
const socialTelematicsSql = readText("supabase", "migrations", "090_social_telematics.sql");
const schemaHardeningSql = readText("supabase", "migrations", "093_schema_hardening.sql");
const adapterContractSql = readText("supabase", "migrations", "613_telematics_adapter_contract.sql");
const adapterContract = readText("supabase", "functions", "_shared", "telematics-adapter.ts");
const genericAdapter = readText("supabase", "functions", "_shared", "adapters", "generic-telematics.ts");
const adapterRegistry = readText("supabase", "functions", "_shared", "telematics-adapter-registry.ts");
const adapterTest = readText("supabase", "functions", "_shared", "telematics-adapter.test.ts");
const telematicsIngest = readText("supabase", "functions", "telematics-ingest", "index.ts");
const signalIngest = readText("supabase", "functions", "telematics-signal-ingest", "index.ts");
const assetDetailPage = readText("apps", "web", "src", "features", "equipment", "pages", "AssetDetailPage.tsx");
const fleetMapPage = readText("apps", "web", "src", "features", "fleet", "pages", "FleetMapPage.tsx");
const tethrCloseoutRequirements = readText(
  "docs",
  "IntelliDealer",
  "_Manifests",
  "QEP_TETHR_JAR_107_REPO_CLOSEOUT_REQUIREMENTS_2026-05-04.md",
);
const historicalGate = JSON.parse(
  readText("test-results", "agent-gates", "20260521T052911Z-C5.1-telematics-adapter.json"),
) as { segment: string; verdict: string };

const compactCloseout = compact(closeoutSql);
const compactSocialTelematicsSql = compact(socialTelematicsSql);
const compactSchemaHardeningSql = compact(schemaHardeningSql);
const compactAdapterContractSql = compact(adapterContractSql);
const compactAdapterContract = compact(adapterContract);
const compactGenericAdapter = compact(genericAdapter);
const compactAdapterRegistry = compact(adapterRegistry);
const compactAdapterTest = compact(adapterTest);
const compactTelematicsIngest = compact(telematicsIngest);
const compactSignalIngest = compact(signalIngest);
const compactAssetDetailPage = compact(assetDetailPage);
const compactFleetMapPage = compact(fleetMapPage);
const compactTethrCloseoutRequirements = compact(tethrCloseoutRequirements);

describe("744_c51_telematics_adapter_contract_closeout.sql contract", () => {
  it("marks only C5.1 shipped with mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'c5.1'");
    expect(compactCloseout).toContain("ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("provider-neutral telematics contract");
    expect(compactCloseout).not.toContain("where task_id = 'c5.2'");
    expect(compactCloseout).not.toContain("where task_id = 'd2.5'");
  });

  it("keeps Tethr and live-provider boundaries explicit", () => {
    expect(compactCloseout).toContain("not live tethr provider-action evidence");
    expect(compactCloseout).toContain("no tethr credentials");
    expect(compactCloseout).toContain("no device-to-equipment mapping source of truth");
    expect(compactCloseout).toContain("no live provider webhook");
    expect(compactCloseout).toContain("c5.2 yanmar smart assist adapter remains a separate dependent roadmap row");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });

  it("proves telematics feeds have target, provider, device, and deterministic lookup foundations", () => {
    expect(compactSocialTelematicsSql).toContain("create table public.telematics_feeds");
    expect(compactSocialTelematicsSql).toContain("workspace_id text not null default 'default'");
    expect(compactSocialTelematicsSql).toContain("equipment_id uuid references public.crm_equipment");
    expect(compactSocialTelematicsSql).toContain("subscription_id uuid references public.eaas_subscriptions");
    expect(compactSocialTelematicsSql).toContain("provider text not null");
    expect(compactSocialTelematicsSql).toContain("device_id text not null");
    expect(compactSocialTelematicsSql).toContain("last_hours numeric");
    expect(compactSocialTelematicsSql).toContain("last_lat numeric");
    expect(compactSocialTelematicsSql).toContain("last_lng numeric");
    expect(compactSocialTelematicsSql).toContain("enable row level security");
    expect(compactSchemaHardeningSql).toContain("constraint telematics_feeds_has_target");
    expect(compactSchemaHardeningSql).toContain("equipment_id is not null or subscription_id is not null");
    expect(compactAdapterContractSql).toContain("uq_telematics_feeds_active_workspace_provider_device");
    expect(compactAdapterContractSql).toContain("idx_telematics_feeds_active_provider_device");
    expect(compactAdapterContractSql).toContain("provider adapter key used by normalized telematics ingestion");
  });

  it("proves the shared adapter contract normalizes provider-neutral readings and signals", () => {
    expect(compactAdapterContract).toContain("provider-neutral telematics adapter boundary");
    expect(compactAdapterContract).toContain("export interface normalizedtelematicsreading");
    expect(compactAdapterContract).toContain("export interface normalizedtelematicssignal");
    expect(compactAdapterContract).toContain("export interface telematicsadapter");
    expect(compactAdapterContract).toContain("function normalizeproviderkey");
    expect(compactAdapterContract).toContain("function requiredeviceid");
    expect(compactAdapterContract).toContain("function normalizesignalkind");
    expect(compactAdapterContract).toContain("function buildtelematicsdedupekey");
    expect(compactGenericAdapter).toContain("export class generictelematicsadapter");
    expect(compactGenericAdapter).toContain("normalizereading");
    expect(compactGenericAdapter).toContain("normalizesignal");
    expect(compactGenericAdapter).toContain("odometermiles");
    expect(compactGenericAdapter).toContain("cumulative_operating_hours");
    expect(compactGenericAdapter).toContain("provider_event_id");
  });

  it("proves registry fallback and adapter tests cover provider-key dispatch", () => {
    expect(compactAdapterRegistry).toContain("const adapters");
    expect(compactAdapterRegistry).toContain("generic_oem: generictelematicsadapter");
    expect(compactAdapterRegistry).toContain("aemp: generictelematicsadapter");
    expect(compactAdapterRegistry).toContain("resolveTelematicsAdapter".toLowerCase());
    expect(compactAdapterRegistry).toContain("normalizetelematicsreading");
    expect(compactAdapterRegistry).toContain("normalizetelematicssignal");
    expect(compactAdapterTest).toContain("normalizeproviderkey creates stable provider keys");
    expect(compactAdapterTest).toContain("generictelematicsadapter normalizes reading payloads");
    expect(compactAdapterTest).toContain("validates device ids and signal kinds");
    expect(compactAdapterTest).toContain("normalizes signal payloads and dedupe keys");
  });

  it("proves ingest paths reject unknown or ambiguous devices and scope lookups by provider/workspace", () => {
    expect(compactTelematicsIngest).toContain("normalizetelematicsreading(body)");
    expect(compactTelematicsIngest).toContain(".from(\"telematics_feeds\")");
    expect(compactTelematicsIngest).toContain(".eq(\"device_id\", reading.deviceid)");
    expect(compactTelematicsIngest).toContain(".eq(\"is_active\", true)");
    expect(compactTelematicsIngest).toContain(".eq(\"provider\", providerfilter)");
    expect(compactTelematicsIngest).toContain(".eq(\"workspace_id\", normalized.workspaceid)");
    expect(compactTelematicsIngest).toContain("unknown device");
    expect(compactTelematicsIngest).toContain("ambiguous device");
    expect(compactTelematicsIngest).toContain("last_odometer_miles");
    expect(compactSignalIngest).toContain("normalizetelematicssignal(rawbody)");
    expect(compactSignalIngest).toContain(".from(\"telematics_feeds\")");
    expect(compactSignalIngest).toContain(".eq(\"device_id\", payload.deviceid)");
    expect(compactSignalIngest).toContain(".eq(\"provider\", providerfilter)");
    expect(compactSignalIngest).toContain("if (!caller.workspaceid)");
    expect(compactSignalIngest).toContain("active workspace required");
    expect(compactSignalIngest).toContain("isservicerole ? payload.workspaceid : callerworkspaceid");
    expect(compactSignalIngest).toContain(".eq(\"workspace_id\", requestedworkspaceid)");
    expect(compactSignalIngest).toContain("workspaceid: signalworkspaceid");
    expect(compactSignalIngest).toContain("unknown_device");
    expect(compactSignalIngest).toContain("ambiguous_device");
    expect(compactSignalIngest).toContain("buildtelematicsdedupekey(payload)");
    expect(compactSignalIngest).toContain("telematics_fault");
    expect(compactSignalIngest).toContain("telematics_idle");
  });

  it("proves provider-neutral fleet surfaces exist without claiming Tethr completion", () => {
    expect(compactAssetDetailPage).toContain(".from(\"telematics_feeds\")");
    expect(compactAssetDetailPage).toContain("provider-neutral telematics feed");
    expect(compactAssetDetailPage).toContain("without claiming live tethr integration");
    expect(compactFleetMapPage).toContain(".from(\"telematics_feeds\")");
    expect(compactFleetMapPage).toContain("markers appear once telematics feeds report");
    expect(compactTethrCloseoutRequirements).toContain("jar-107 cannot be honestly closed as `built` from repo code alone");
    expect(compactTethrCloseoutRequirements).toContain("provider-neutral telematics foundation");
    expect(compactTethrCloseoutRequirements).toContain("no live tethr auth contract");
  });

  it("references the historical C5.1 gate report as passing evidence", () => {
    expect(historicalGate.segment).toBe("C5.1-telematics-adapter");
    expect(historicalGate.verdict).toBe("PASS");
    expect(compactCloseout).toContain("20260521t052911z-c5.1-telematics-adapter.json");
  });
});
