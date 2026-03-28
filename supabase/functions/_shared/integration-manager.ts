/**
 * Integration Manager — adapter factory, credential management, status tracking.
 *
 * Per blueprint §5.3: auto-selects live vs. mock adapter based on
 * integration_status.status for each integration. Zero-blocking keystone.
 */

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { decryptCredential } from "./integration-crypto.ts";
import type {
  IntegrationKey,
  IntegrationStatusRow,
  AdapterConfig,
  AdapterResult,
  IntegrationAdapter,
} from "./integration-types.ts";

// Lazy-import adapters to keep bundle splits clean
import { IntelliDealerMockAdapter } from "./adapters/intellidealer-mock.ts";
import { IronGuidesMockAdapter } from "./adapters/ironguides-mock.ts";
import { RouseMockAdapter } from "./adapters/rouse-mock.ts";
import { AempMockAdapter } from "./adapters/aemp-mock.ts";
import { FinancingMockAdapter } from "./adapters/financing-mock.ts";
import { ManufacturerIncentivesMockAdapter } from "./adapters/manufacturer-incentives-mock.ts";
import { AuctionDataMockAdapter } from "./adapters/auction-data-mock.ts";
import { FredUsdaMockAdapter } from "./adapters/fred-usda-mock.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Adapter registry — maps integration key to mock adapter instance
// Live adapters will be registered here as they are built in Sprint 2+
// ─────────────────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
const MOCK_ADAPTERS: Record<IntegrationKey, IntegrationAdapter<any, any>> = {
  intellidealer: new IntelliDealerMockAdapter(),
  ironguides: new IronGuidesMockAdapter(),
  rouse: new RouseMockAdapter(),
  aemp: new AempMockAdapter(),
  financing: new FinancingMockAdapter(),
  manufacturer_incentives: new ManufacturerIncentivesMockAdapter(),
  auction_data: new AuctionDataMockAdapter(),
  fred_usda: new FredUsdaMockAdapter(),
};

// ─────────────────────────────────────────────────────────────────────────────
// IntegrationManager
// ─────────────────────────────────────────────────────────────────────────────

export class IntegrationManager {
  private supabaseAdmin: SupabaseClient;
  private statusCache: Map<IntegrationKey, IntegrationStatusRow> = new Map();

  constructor(supabaseUrl: string, serviceRoleKey: string) {
    this.supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  }

  /**
   * Load all integration statuses from DB (cached per manager instance).
   */
  async loadStatuses(): Promise<Map<IntegrationKey, IntegrationStatusRow>> {
    const { data, error } = await this.supabaseAdmin
      .from("integration_status")
      .select("*");

    if (error) {
      console.error("[IntegrationManager] Failed to load statuses:", error);
      return this.statusCache;
    }

    for (const row of data as IntegrationStatusRow[]) {
      this.statusCache.set(row.integration_key, row);
    }
    return this.statusCache;
  }

  /**
   * Returns the appropriate adapter for the given integration key.
   * Auto-selects mock if credentials are missing or status is not 'connected'.
   * Sprint 1: always returns mock adapter. Sprint 2+ will register live adapters.
   */
  // deno-lint-ignore no-explicit-any
  getAdapter<TReq, TRes>(key: IntegrationKey): IntegrationAdapter<TReq, TRes> {
    const status = this.statusCache.get(key);
    const isConnected = status?.status === "connected";

    // Live adapters not yet registered — fall through to mock for all Sprint 1 integrations
    if (isConnected) {
      // TODO Sprint 2: return LIVE_ADAPTERS[key] when live adapters are implemented
      console.warn(
        `[IntegrationManager] Live adapter for ${key} not yet available, using mock`
      );
    }

    return MOCK_ADAPTERS[key] as IntegrationAdapter<TReq, TRes>;
  }

  /**
   * Decrypts credentials for a specific integration key.
   * Returns null if no credentials are stored.
   */
  async getDecryptedCredentials(key: IntegrationKey): Promise<string | null> {
    const status = this.statusCache.get(key);
    if (!status?.credentials_encrypted) return null;
    try {
      return await decryptCredential(status.credentials_encrypted, key);
    } catch (err) {
      console.error(`[IntegrationManager] Failed to decrypt credentials for ${key}:`, err);
      return null;
    }
  }

  /**
   * Builds an AdapterConfig for a given integration, decrypting credentials.
   */
  async buildAdapterConfig(key: IntegrationKey): Promise<AdapterConfig> {
    const status = this.statusCache.get(key);
    const decryptedCreds = await this.getDecryptedCredentials(key);
    return {
      credentials: decryptedCreds ? { raw: decryptedCreds } : undefined,
      endpointUrl: status?.endpoint_url ?? undefined,
      config: status?.config ?? {},
    };
  }

  /**
   * Execute an adapter call and update sync status in DB.
   */
  async execute<TReq, TRes>(
    key: IntegrationKey,
    request: TReq
  ): Promise<AdapterResult<TRes>> {
    const adapter = this.getAdapter<TReq, TRes>(key);
    const config = await this.buildAdapterConfig(key);

    const startedAt = new Date().toISOString();
    try {
      const result = await adapter.execute(request, config);

      // Update sync status on success
      await this.supabaseAdmin
        .from("integration_status")
        .update({
          last_sync_at: startedAt,
          last_sync_records: Array.isArray(result.data)
            ? (result.data as unknown[]).length
            : 1,
          last_sync_error: null,
        })
        .eq("integration_key", key);

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Update sync status on failure
      await this.supabaseAdmin
        .from("integration_status")
        .update({
          last_sync_error: errorMsg,
          status: "error",
        })
        .eq("integration_key", key);

      throw err;
    }
  }

  /**
   * Test connection for an integration and persist result.
   */
  async testConnection(
    key: IntegrationKey
  ): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    const adapter = this.getAdapter(key);
    const config = await this.buildAdapterConfig(key);
    const testedAt = new Date().toISOString();

    const result = await adapter.testConnection(config);

    await this.supabaseAdmin
      .from("integration_status")
      .update({
        last_test_at: testedAt,
        last_test_success: result.success,
        last_test_latency_ms: result.latencyMs,
        last_test_error: result.error ?? null,
        status: result.success ? "connected" : "error",
      })
      .eq("integration_key", key);

    return result;
  }
}

/**
 * Factory — creates an IntegrationManager using standard Deno env vars.
 */
export function createIntegrationManager(): IntegrationManager {
  return new IntegrationManager(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}
