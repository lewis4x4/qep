import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Database as BaseDatabase, Json } from "@/lib/database.types";

type BasePublic = BaseDatabase["public"];
type BaseTables = BasePublic["Tables"];
type BaseViews = BasePublic["Views"];
type BaseEnums = BasePublic["Enums"];

type QrmTable<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

type QrmTables = BaseTables & {
  crm_deal_stages: QrmTable<{
    id: string;
    workspace_id: string;
    name: string;
    sort_order: number;
    probability: number | null;
    is_closed_won: boolean;
    is_closed_lost: boolean;
    created_at: string;
    updated_at: string;
  }>;
  crm_deals: QrmTable<{
    id: string;
    workspace_id: string;
    name: string;
    stage_id: string;
    primary_contact_id: string | null;
    company_id: string | null;
    assigned_rep_id: string | null;
    amount: number | null;
    expected_close_on: string | null;
    next_follow_up_at: string | null;
    last_activity_at: string | null;
    closed_at: string | null;
    loss_reason: string | null;
    competitor: string | null;
    hubspot_deal_id: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  }>;
  crm_contacts: QrmTable<{
    id: string;
    workspace_id: string;
    dge_customer_profile_id: string | null;
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
    title: string | null;
    primary_company_id: string | null;
    assigned_rep_id: string | null;
    hubspot_contact_id: string | null;
    merged_into_contact_id: string | null;
    metadata: Json;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  }>;
  crm_companies: QrmTable<{
    id: string;
    workspace_id: string;
    name: string;
    parent_company_id: string | null;
    assigned_rep_id: string | null;
    hubspot_company_id: string | null;
    search_1: string | null;
    search_2: string | null;
    address_line_1: string | null;
    address_line_2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
    metadata: Json;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  }>;
  crm_activities: QrmTable<{
    id: string;
    workspace_id: string;
    activity_type: "note" | "call" | "email" | "meeting" | "task" | "sms";
    body: string | null;
    occurred_at: string;
    contact_id: string | null;
    deal_id: string | null;
    company_id: string | null;
    created_by: string | null;
    metadata: Json;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  }>;
  crm_activity_templates: QrmTable<{
    id: string;
    workspace_id: string;
    activity_type: "note" | "call" | "email" | "meeting" | "task" | "sms";
    label: string;
    description: string | null;
    body: string;
    task_due_minutes: number | null;
    task_status: "open" | "completed" | null;
    sort_order: number;
    is_active: boolean;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  }>;
  crm_territories: QrmTable<{
    id: string;
    workspace_id: string;
    name: string;
    description: string | null;
    assigned_rep_id: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  }>;
  crm_contact_territories: QrmTable<{
    id: string;
    workspace_id: string;
    contact_id: string;
    territory_id: string;
    created_at: string;
  }>;
  quotes: QrmTable<{
    id: string;
    workspace_id: string;
    created_by: string | null;
    crm_contact_id: string | null;
    crm_deal_id: string | null;
    status: "draft" | "linked" | "archived";
    title: string | null;
    line_items: Json;
    customer_snapshot: Json;
    metadata: Json;
    linked_at: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  }>;
  crm_quote_audit_events: QrmTable<{
    id: string;
    workspace_id: string;
    quote_id: string;
    event_type: "quote_created" | "quote_updated" | "quote_linked" | "quote_archived";
    actor_user_id: string | null;
    request_id: string | null;
    metadata: Json;
    created_at: string;
  }>;
};

type QrmViews = BaseViews & {
  crm_deals_rep_safe: {
    Row: {
      id: string;
      workspace_id: string;
      name: string;
      stage_id: string;
      primary_contact_id: string | null;
      company_id: string | null;
      assigned_rep_id: string | null;
      amount: number | null;
      expected_close_on: string | null;
      next_follow_up_at: string | null;
      last_activity_at: string | null;
      closed_at: string | null;
      hubspot_deal_id: string | null;
      created_at: string;
      updated_at: string;
      deleted_at: string | null;
      // Added in migration 254 — Slice 2.4 pipeline board polish
      sort_position: number | null;
      margin_pct: number | null;
      // Added in migrations 066/070 — surfaced on this view in migration 254
      deposit_status: string | null;
      deposit_amount: number | null;
      sla_deadline_at: string | null;
    };
    Relationships: [];
  };
  crm_deals_weighted: {
    Row: {
      id: string;
      workspace_id: string;
      name: string;
      stage_id: string;
      stage_name: string;
      stage_probability: number | null;
      primary_contact_id: string | null;
      company_id: string | null;
      assigned_rep_id: string | null;
      amount: number | null;
      weighted_amount: number | null;
      expected_close_on: string | null;
      next_follow_up_at: string | null;
      last_activity_at: string | null;
      closed_at: string | null;
      hubspot_deal_id: string | null;
      created_at: string;
      updated_at: string;
    };
    Relationships: [];
  };
  // Phase 0 P0.5 — currently-active role blend rows per profile.
  // Source: supabase/migrations/210_profile_role_blend.sql.
  // Until database.types.ts is regenerated against the post-210 schema,
  // this typed-shim is the read surface for the blend hook.
  v_profile_active_role_blend: {
    Row: {
      id: string;
      profile_id: string;
      iron_role: "iron_manager" | "iron_advisor" | "iron_woman" | "iron_man";
      weight: number;
      effective_from: string;
      effective_to: string | null;
      reason: string | null;
      iron_role_display: string;
    };
    Relationships: [];
  };
};

type QrmEnums = BaseEnums & {
  crm_activity_type: "note" | "call" | "email" | "meeting" | "task" | "sms";
};

export type QrmDatabase = Omit<BaseDatabase, "public"> & {
  public: Omit<BasePublic, "Tables" | "Views" | "Enums"> & {
    Tables: QrmTables;
    Views: QrmViews;
    Enums: QrmEnums;
  };
};

export const crmSupabase = supabase as unknown as SupabaseClient<QrmDatabase>;
