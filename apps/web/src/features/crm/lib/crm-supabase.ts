import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Database as BaseDatabase, Json } from "@/lib/database.types";

type BasePublic = BaseDatabase["public"];
type BaseTables = BasePublic["Tables"];
type BaseViews = BasePublic["Views"];
type BaseEnums = BasePublic["Enums"];

type CrmTable<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

type CrmTables = BaseTables & {
  crm_deal_stages: CrmTable<{
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
  crm_deals: CrmTable<{
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
  crm_contacts: CrmTable<{
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
  crm_companies: CrmTable<{
    id: string;
    workspace_id: string;
    name: string;
    parent_company_id: string | null;
    assigned_rep_id: string | null;
    hubspot_company_id: string | null;
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
  crm_activities: CrmTable<{
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
  crm_activity_templates: CrmTable<{
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
  crm_territories: CrmTable<{
    id: string;
    workspace_id: string;
    name: string;
    description: string | null;
    assigned_rep_id: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  }>;
  crm_contact_territories: CrmTable<{
    id: string;
    workspace_id: string;
    contact_id: string;
    territory_id: string;
    created_at: string;
  }>;
  quotes: CrmTable<{
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
  crm_quote_audit_events: CrmTable<{
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

type CrmViews = BaseViews & {
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
};

type CrmEnums = BaseEnums & {
  crm_activity_type: "note" | "call" | "email" | "meeting" | "task" | "sms";
};

export type CrmDatabase = Omit<BaseDatabase, "public"> & {
  public: Omit<BasePublic, "Tables" | "Views" | "Enums"> & {
    Tables: CrmTables;
    Views: CrmViews;
    Enums: CrmEnums;
  };
};

export const crmSupabase = supabase as unknown as SupabaseClient<CrmDatabase>;
