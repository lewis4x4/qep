/**
 * Integration Manager — adapter factory, credential management, status tracking.
 *
 * Per blueprint §5.3: auto-selects live vs. mock adapter based on
 * integration_status.status and adapter readiness.
 */

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { decryptCredential } from "./integration-crypto.ts";
import type {
  AdapterConfig,
  AdapterResult,
  IntegrationAdapter,
  IntegrationKey,
  IntegrationStatusRow,
} from "./integration-types.ts";

import { AempMockAdapter } from "./adapters/aemp-mock.ts";
import { AuctionDataMockAdapter } from "./adapters/auction-data-mock.ts";
import { FinancingMockAdapter } from "./adapters/financing-mock.ts";
import { FredUsdaLiveAdapter } from "./adapters/fred-usda-live.ts";
import { FredUsdaMockAdapter } from "./adapters/fred-usda-mock.ts";
import { IntelliDealerMockAdapter } from "./adapters/intellidealer-mock.ts";
import { IronGuidesMockAdapter } from "./adapters/ironguides-mock.ts";
import { ManufacturerIncentivesMockAdapter } from "./adapters/manufacturer-incentives-mock.ts";
import { RouseMockAdapter } from "./adapters/rouse-mock.ts";

interface PostgrestErrorLike {
  code?: string | null;
  message?: string | null;
}

function parseCredentials(
  raw: string | null,
): Record<string, string> | undefined {
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        output[key] = value;
      }
    }
    return Object.keys(output).length > 0 ? output : { raw };
  } catch {
    return { raw };
  }
}

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

// deno-lint-ignore no-explicit-any
const LIVE_ADAPTERS: Partial<
  Record<IntegrationKey, IntegrationAdapter<any, any>>
> = {
  fred_usda: new FredUsdaLiveAdapter(),
};

export class IntegrationManager {
  private supabaseAdmin: SupabaseClient;
  private workspaceId: string;
  private statusCache: Map<IntegrationKey, IntegrationStatusRow> = new Map();

  constructor(supabaseUrl: string, serviceRoleKey: string, workspaceId = "default") {
    this.supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    this.workspaceId = workspaceId;
  }

  private hydrateStatusCache(rows: IntegrationStatusRow[]): void {
    this.statusCache.clear();
    for (const row of rows) {
      this.statusCache.set(row.integration_key, row);
    }
  }

  private async loadUnscopedStatuses(): Promise<IntegrationStatusRow[] | null> {
    const { data, error } = await this.supabaseAdmin
      .from("integration_status")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      console.error(
        "[IntegrationManager] Failed to load unscoped statuses:",
        error,
      );
      return null;
    }

    return data as IntegrationStatusRow[];
  }

  async loadStatuses(): Promise<Map<IntegrationKey, IntegrationStatusRow>> {
    const { data, error } = await this.supabaseAdmin
      .from("integration_status")
      .select("*")
      .eq("workspace_id", this.workspaceId);

    const isWorkspaceIdMissing = (err: PostgrestErrorLike | null): boolean =>
      err?.code === "42703" || (err?.message ?? "").includes("workspace_id");

    if (error && !isWorkspaceIdMissing(error)) {
      console.error("[IntegrationManager] Failed to load statuses:", error);
      return this.statusCache;
    }

    if (error && isWorkspaceIdMissing(error)) {
      const unscopedRows = await this.loadUnscopedStatuses();
      if (unscopedRows) {
        this.hydrateStatusCache(unscopedRows);
      }
      return this.statusCache;
    }

    const scopedRows = data as IntegrationStatusRow[];
    if (scopedRows.length > 0) {
      this.hydrateStatusCache(scopedRows);
      return this.statusCache;
    }

    // Backward compatibility for legacy/default workspace rows.
    if (this.workspaceId !== "default") {
      const { data: defaultRows, error: defaultError } = await this.supabaseAdmin
        .from("integration_status")
        .select("*")
        .eq("workspace_id", "default");

      if (!defaultError && defaultRows && defaultRows.length > 0) {
        this.hydrateStatusCache(defaultRows as IntegrationStatusRow[]);
        return this.statusCache;
      }
    }

    const unscopedRows = await this.loadUnscopedStatuses();
    if (unscopedRows) {
      this.hydrateStatusCache(unscopedRows);
    }

    return this.statusCache;
  }

  getStatus(key: IntegrationKey): IntegrationStatusRow | undefined {
    return this.statusCache.get(key);
  }

  getWorkspaceId(): string {
    return this.workspaceId;
  }

  async getDecryptedCredentials(key: IntegrationKey): Promise<string | null> {
    const status = this.statusCache.get(key);
    if (!status?.credentials_encrypted) return null;

    try {
      return await decryptCredential(status.credentials_encrypted, key);
    } catch (error) {
      console.error(
        `[IntegrationManager] Failed to decrypt credentials for ${key}:`,
        error,
      );
      return null;
    }
  }

  async buildAdapterConfig(key: IntegrationKey): Promise<AdapterConfig> {
    const status = this.statusCache.get(key);
    const decryptedCredentials = await this.getDecryptedCredentials(key);

    return {
      credentials: parseCredentials(decryptedCredentials),
      endpointUrl: status?.endpoint_url ?? undefined,
      config: status?.config ?? {},
    };
  }

  private shouldUseLiveAdapter(
    key: IntegrationKey,
    config: AdapterConfig,
  ): boolean {
    const status = this.statusCache.get(key);
    if (!status || status.status !== "connected") return false;

    const liveAdapter = LIVE_ADAPTERS[key];
    if (!liveAdapter) return false;

    if (key === "fred_usda") {
      const envKey = Deno.env.get("FRED_API_KEY");
      if (envKey && envKey.trim().length > 0) return true;

      const creds = config.credentials ?? {};
      return Boolean(creds.api_key || creds.fred_api_key || creds.raw);
    }

    return true;
  }

  // deno-lint-ignore no-explicit-any
  private resolveAdapter<TReq, TRes>(
    key: IntegrationKey,
    config: AdapterConfig,
  ): IntegrationAdapter<TReq, TRes> {
    if (this.shouldUseLiveAdapter(key, config)) {
      return LIVE_ADAPTERS[key] as IntegrationAdapter<TReq, TRes>;
    }

    return MOCK_ADAPTERS[key] as IntegrationAdapter<TReq, TRes>;
  }

  async execute<TReq, TRes>(
    key: IntegrationKey,
    request: TReq,
  ): Promise<AdapterResult<TRes>> {
    const config = await this.buildAdapterConfig(key);
    const adapter = this.resolveAdapter<TReq, TRes>(key, config);
    const startedAt = new Date().toISOString();

    try {
      const result = await adapter.execute(request, config);

      await this.supabaseAdmin
        .from("integration_status")
        .update({
          last_sync_at: startedAt,
          last_sync_records: Array.isArray(result.data)
            ? (result.data as unknown[]).length
            : 1,
          last_sync_error: null,
        })
        .eq("workspace_id", this.workspaceId)
        .eq("integration_key", key);

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.supabaseAdmin
        .from("integration_status")
        .update({ last_sync_error: message })
        .eq("workspace_id", this.workspaceId)
        .eq("integration_key", key);
      throw error;
    }
  }

  async testConnection(
    key: IntegrationKey,
  ): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    const config = await this.buildAdapterConfig(key);
    const adapter = this.resolveAdapter(key, config);
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
      .eq("workspace_id", this.workspaceId)
      .eq("integration_key", key);

    return result;
  }
}

export function createIntegrationManager(options?: {
  workspaceId?: string;
}): IntegrationManager {
  const workspaceId = options?.workspaceId ??
    Deno.env.get("DEFAULT_WORKSPACE_ID") ??
    "default";
  return new IntegrationManager(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    workspaceId,
  );
}
