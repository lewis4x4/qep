import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Database as BaseDatabase, Json } from "./database.types";

type BasePublic = BaseDatabase["public"];
type BaseTables = BasePublic["Tables"];

type HubSpotAdminTables = BaseTables & {
  workspace_hubspot_portal: {
    Row: {
      id: string;
      workspace_id: string;
      hub_id: string;
      connection_id: string;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      workspace_id: string;
      hub_id: string;
      connection_id: string;
      is_active?: boolean;
      created_at?: string;
      updated_at?: string;
    };
    Update: {
      id?: string;
      workspace_id?: string;
      hub_id?: string;
      connection_id?: string;
      is_active?: boolean;
      created_at?: string;
      updated_at?: string;
    };
    Relationships: [];
  };
  crm_hubspot_import_runs: {
    Row: {
      id: string;
      workspace_id: string;
      initiated_by: string | null;
      status: "queued" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";
      started_at: string;
      completed_at: string | null;
      contacts_processed: number;
      companies_processed: number;
      deals_processed: number;
      activities_processed: number;
      error_count: number;
      error_summary: string | null;
      metadata: Json;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      workspace_id?: string;
      initiated_by?: string | null;
      status?: "queued" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";
      started_at?: string;
      completed_at?: string | null;
      contacts_processed?: number;
      companies_processed?: number;
      deals_processed?: number;
      activities_processed?: number;
      error_count?: number;
      error_summary?: string | null;
      metadata?: Json;
      created_at?: string;
      updated_at?: string;
    };
    Update: {
      id?: string;
      workspace_id?: string;
      initiated_by?: string | null;
      status?: "queued" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";
      started_at?: string;
      completed_at?: string | null;
      contacts_processed?: number;
      companies_processed?: number;
      deals_processed?: number;
      activities_processed?: number;
      error_count?: number;
      error_summary?: string | null;
      metadata?: Json;
      created_at?: string;
      updated_at?: string;
    };
    Relationships: [];
  };
};

export type HubSpotAdminDatabase = Omit<BaseDatabase, "public"> & {
  public: Omit<BasePublic, "Tables"> & {
    Tables: HubSpotAdminTables;
  };
};

export const hubspotAdminSupabase = supabase as unknown as SupabaseClient<HubSpotAdminDatabase>;
