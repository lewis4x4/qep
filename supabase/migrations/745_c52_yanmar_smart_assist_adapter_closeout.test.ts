import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "745_c52_yanmar_smart_assist_adapter_closeout.sql");
const smartAssistSql = readText("supabase", "migrations", "614_yanmar_smart_assist_telematics_adapter.sql");
const adapter = readText("supabase", "functions", "_shared", "adapters", "yanmar-smart-assist.ts");
const adapterTest = readText("supabase", "functions", "_shared", "adapters", "yanmar-smart-assist.test.ts");
const adapterRegistry = readText("supabase", "functions", "_shared", "telematics-adapter-registry.ts");
const adapterContractSql = readText("supabase", "migrations", "613_telematics_adapter_contract.sql");
const c51CloseoutSql = readText("supabase", "migrations", "744_c51_telematics_adapter_contract_closeout.sql");
const fixtureRegister = readText(
  "docs",
  "IntelliDealer",
  "_Manifests",
  "QEP_D1_2_SOURCE_FIXTURE_VENDOR_CONTRACT_REGISTER_2026-05-21.md",
);
const historicalGate = JSON.parse(
  readText("test-results", "agent-gates", "20260521T053955Z-C5.2-yanmar-smart-assist.json"),
) as { segment: string; verdict: string };

const compactCloseout = compact(closeoutSql);
const compactSmartAssistSql = compact(smartAssistSql);
const compactAdapter = compact(adapter);
const compactAdapterTest = compact(adapterTest);
const compactAdapterRegistry = compact(adapterRegistry);
const compactAdapterContractSql = compact(adapterContractSql);
const compactC51CloseoutSql = compact(c51CloseoutSql);
const compactFixtureRegister = compact(fixtureRegister);

describe("745_c52_yanmar_smart_assist_adapter_closeout.sql contract", () => {
  it("marks only C5.2 shipped with mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'c5.2'");
    expect(compactCloseout).toContain("ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("smart assist adapter path for yanmar and asv");
    expect(compactCloseout).not.toContain("where task_id = 'c5.1'");
    expect(compactCloseout).not.toContain("where task_id = 'd1.2'");
    expect(compactCloseout).not.toContain("where task_id = 'd2.5'");
  });

  it("keeps live-provider, mapping, and Tethr boundaries explicit", () => {
    expect(compactCloseout).toContain("not live tethr provider-action evidence");
    expect(compactCloseout).toContain("no yanmar or asv smart assist credentials");
    expect(compactCloseout).toContain("no device-to-equipment mapping source of truth");
    expect(compactCloseout).toContain("no live smart assist poller");
    expect(compactCloseout).toContain("smart assist/yanmar work is not tethr provider evidence");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });

  it("requires C5.1 provider-neutral telematics foundation evidence", () => {
    expect(compactCloseout).toContain("c5.1 shipped in supabase/migrations/744_c51_telematics_adapter_contract_closeout.sql");
    expect(compactC51CloseoutSql).toContain("where task_id = 'c5.1'");
    expect(compactC51CloseoutSql).toContain("provider-neutral telematics foundation is in place");
    expect(compactAdapterContractSql).toContain("provider adapter key used by normalized telematics ingestion");
    expect(compactAdapterContractSql).toContain("uq_telematics_feeds_active_workspace_provider_device");
    expect(compactAdapterContractSql).toContain("idx_telematics_feeds_active_provider_device");
  });

  it("proves Smart Assist is registered as adapter-ready and credential-blocked", () => {
    expect(compactSmartAssistSql).toContain("c5.2 registers smart assist as an adapter-ready telematics provider");
    expect(compactSmartAssistSql).toContain("'yanmar_smart_assist'");
    expect(compactSmartAssistSql).toContain("'yanmar / asv smart assist telematics'");
    expect(compactSmartAssistSql).toContain("'pending_credentials'::public.integration_status_enum");
    expect(compactSmartAssistSql).toContain("'api_key'");
    expect(compactSmartAssistSql).toContain("'manual'::public.sync_frequency");
    expect(compactSmartAssistSql).toContain("'implementation_status', 'adapter_ready_credentials_blocked'");
    expect(compactSmartAssistSql).toContain("'supported_brand_surfaces', jsonb_build_array('yanmar', 'asv')");
    expect(compactSmartAssistSql).toContain("'adapter_key', 'yanmar_smart_assist'");
    expect(compactSmartAssistSql).toContain("'foundation_migration', '613_telematics_adapter_contract.sql'");
    expect(compactSmartAssistSql).toContain("live polling/webhook cutover requires approved credentials, endpoint, payload, and device-mapping policy");
  });

  it("proves the Yanmar/ASV adapter normalizes readings and signals without live connectivity", () => {
    expect(compactAdapter).toContain("yanmar / asv smart assist telematics adapter");
    expect(compactAdapter).toContain("smart assist covers yanmar compact equipment and asv surfaces");
    expect(compactAdapter).toContain("live polling/webhook auth stays blocked");
    expect(compactAdapter).toContain("const provider = \"yanmar_smart_assist\"");
    expect(compactAdapter).toContain("export class yanmarsmartassistadapter");
    expect(compactAdapter).toContain("normalizereading");
    expect(compactAdapter).toContain("normalizesignal");
    expect(compactAdapter).toContain("testconnection");
    expect(compactAdapter).toContain("live credentials and endpoint contract are not configured");
  });

  it("proves the adapter extracts Smart Assist device, hours, GPS, severity, and dedupe fields", () => {
    for (const field of [
      "\"deviceid\"",
      "\"machineid\"",
      "\"assetid\"",
      "\"terminalid\"",
      "\"serialnumber\"",
      "\"productserialnumber\"",
      "\"hourmeter\"",
      "\"totaloperatinghours\"",
      "\"cumulative_operating_hours\"",
      "\"location.latitude\"",
      "\"gps.longitude\"",
      "\"provider_event_id\"",
      "\"event.id\"",
    ]) {
      expect(compactAdapter).toContain(field);
    }
    expect(compactAdapter).toContain("case \"emergency\"");
    expect(compactAdapter).toContain("return \"critical\"");
    expect(compactAdapter).toContain("case \"warning\"");
    expect(compactAdapter).toContain("return \"medium\"");
    expect(compactAdapter).toContain("case \"info\"");
    expect(compactAdapter).toContain("return \"low\"");
  });

  it("proves registry dispatch covers Yanmar, ASV, YCENA, and Smart Assist aliases", () => {
    for (const alias of [
      "yanmar: yanmarsmartassistadapter",
      "asv: yanmarsmartassistadapter",
      "ycena: yanmarsmartassistadapter",
      "smart_assist: yanmarsmartassistadapter",
      "yanmar_smart_assist: yanmarsmartassistadapter",
      "ycena_smart_assist: yanmarsmartassistadapter",
    ]) {
      expect(compactAdapterRegistry).toContain(alias);
    }
  });

  it("proves fixture-backed adapter tests cover Yanmar readings, ASV aliases, faults, and idle alerts", () => {
    expect(compactAdapterTest).toContain("normalizes yanmar machine readings");
    expect(compactAdapterTest).toContain("accepts asv smart assist aliases");
    expect(compactAdapterTest).toContain("normalizes fault alerts and dedupe keys");
    expect(compactAdapterTest).toContain("normalizes idle alerts");
    expect(compactAdapterTest).toContain("buildtelematicsdedupekey(signal)");
    expect(compactAdapterTest).toContain("\"telematics:yanmar_smart_assist:alert-9\"");
  });

  it("preserves the D1.2 register boundary that Smart Assist is not Tethr provider evidence", () => {
    expect(compactFixtureRegister).toContain("tethr-provider-contract-payload-fixtures");
    expect(compactFixtureRegister).toContain("generic telematics and smart assist/yanmar work are not tethr provider evidence");
    expect(compactFixtureRegister).toContain("no tethr-specific action promotion");
    expect(compactCloseout).toContain("d1.2 and any tethr-specific action row remain blocked");
  });

  it("references the historical C5.2 gate report as passing evidence", () => {
    expect(historicalGate.segment).toBe("C5.2-yanmar-smart-assist");
    expect(historicalGate.verdict).toBe("PASS");
    expect(compactCloseout).toContain("20260521t053955z-c5.2-yanmar-smart-assist.json");
  });
});
