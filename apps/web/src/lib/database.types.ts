export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          activity_type: Database["public"]["Enums"]["activity_type"]
          created_at: string
          deal_id: string | null
          enrollment_id: string | null
          error: string | null
          hub_id: string | null
          hubspot_engagement_id: string | null
          id: string
          payload: Json | null
          step_number: number | null
          success: boolean
        }
        Insert: {
          activity_type: Database["public"]["Enums"]["activity_type"]
          created_at?: string
          deal_id?: string | null
          enrollment_id?: string | null
          error?: string | null
          hub_id?: string | null
          hubspot_engagement_id?: string | null
          id?: string
          payload?: Json | null
          step_number?: number | null
          success?: boolean
        }
        Update: {
          activity_type?: Database["public"]["Enums"]["activity_type"]
          created_at?: string
          deal_id?: string | null
          enrollment_id?: string | null
          error?: string | null
          hub_id?: string | null
          hubspot_engagement_id?: string | null
          id?: string
          payload?: Json | null
          step_number?: number | null
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "sequence_enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_data_issues: {
        Row: {
          created_at: string
          detail: Json
          entity_id: string | null
          entity_table: string
          first_seen: string
          id: string
          issue_class: string
          last_checked: string
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          detail?: Json
          entity_id?: string | null
          entity_table: string
          first_seen?: string
          id?: string
          issue_class: string
          last_checked?: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          detail?: Json
          entity_id?: string | null
          entity_table?: string
          first_seen?: string
          id?: string
          issue_class?: string
          last_checked?: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_data_issues_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_action_log: {
        Row: {
          action_type: string
          after_state: Json | null
          alert_id: string | null
          before_state: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
          metric_key: string | null
          source_widget: string | null
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          action_type: string
          after_state?: Json | null
          alert_id?: string | null
          before_state?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          metric_key?: string | null
          source_widget?: string | null
          user_id?: string | null
          workspace_id?: string
        }
        Update: {
          action_type?: string
          after_state?: Json | null
          alert_id?: string | null
          before_state?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          metric_key?: string | null
          source_widget?: string | null
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_action_log_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "analytics_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_action_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_type: string
          branch_id: string | null
          business_impact_type: string | null
          business_impact_value: number | null
          created_at: string
          dedupe_key: string | null
          department_id: string | null
          description: string | null
          entity_id: string | null
          entity_type: string | null
          exception_queue_id: string | null
          id: string
          metadata: Json
          metric_key: string | null
          owner_user_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          role_target: string
          root_cause_guess: string | null
          severity: string
          source_record_ids: Json
          status: string
          suggested_action: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type: string
          branch_id?: string | null
          business_impact_type?: string | null
          business_impact_value?: number | null
          created_at?: string
          dedupe_key?: string | null
          department_id?: string | null
          description?: string | null
          entity_id?: string | null
          entity_type?: string | null
          exception_queue_id?: string | null
          id?: string
          metadata?: Json
          metric_key?: string | null
          owner_user_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          role_target?: string
          root_cause_guess?: string | null
          severity: string
          source_record_ids?: Json
          status?: string
          suggested_action?: string | null
          title: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type?: string
          branch_id?: string | null
          business_impact_type?: string | null
          business_impact_value?: number | null
          created_at?: string
          dedupe_key?: string | null
          department_id?: string | null
          description?: string | null
          entity_id?: string | null
          entity_type?: string | null
          exception_queue_id?: string | null
          id?: string
          metadata?: Json
          metric_key?: string | null
          owner_user_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          role_target?: string
          root_cause_guess?: string | null
          severity?: string
          source_record_ids?: Json
          status?: string
          suggested_action?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_alerts_exception_queue_id_fkey"
            columns: ["exception_queue_id"]
            isOneToOne: false
            referencedRelation: "exception_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_alerts_metric_key_fkey"
            columns: ["metric_key"]
            isOneToOne: false
            referencedRelation: "analytics_metric_definitions"
            referencedColumns: ["metric_key"]
          },
          {
            foreignKeyName: "analytics_alerts_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_alerts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_events: {
        Row: {
          actor_id: string | null
          actor_type: string | null
          consumed_by_runs: Json
          context: Json
          correlation_id: string | null
          entity_id: string | null
          entity_type: string | null
          event_id: string
          event_name: string
          event_version: number
          flow_event_type: string | null
          flow_event_version: number | null
          occurred_at: string
          parent_event_id: string | null
          project_id: string
          properties: Json | null
          received_at: string
          request_id: string | null
          role: string
          session_id: string | null
          source: string
          source_module: string | null
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_type?: string | null
          consumed_by_runs?: Json
          context?: Json
          correlation_id?: string | null
          entity_id?: string | null
          entity_type?: string | null
          event_id?: string
          event_name: string
          event_version?: number
          flow_event_type?: string | null
          flow_event_version?: number | null
          occurred_at?: string
          parent_event_id?: string | null
          project_id: string
          properties?: Json | null
          received_at?: string
          request_id?: string | null
          role?: string
          session_id?: string | null
          source: string
          source_module?: string | null
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          actor_type?: string | null
          consumed_by_runs?: Json
          context?: Json
          correlation_id?: string | null
          entity_id?: string | null
          entity_type?: string | null
          event_id?: string
          event_name?: string
          event_version?: number
          flow_event_type?: string | null
          flow_event_version?: number | null
          occurred_at?: string
          parent_event_id?: string | null
          project_id?: string
          properties?: Json | null
          received_at?: string
          request_id?: string | null
          role?: string
          session_id?: string | null
          source?: string
          source_module?: string | null
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      analytics_kpi_snapshots: {
        Row: {
          branch_id: string | null
          calculated_at: string
          comparison_value: number | null
          confidence_score: number | null
          created_at: string
          data_quality_score: number | null
          department_id: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
          metric_key: string
          metric_value: number | null
          period_end: string
          period_start: string
          refresh_state: string
          role_scope: string | null
          supersedes_id: string | null
          target_value: number | null
          workspace_id: string
        }
        Insert: {
          branch_id?: string | null
          calculated_at?: string
          comparison_value?: number | null
          confidence_score?: number | null
          created_at?: string
          data_quality_score?: number | null
          department_id?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          metric_key: string
          metric_value?: number | null
          period_end: string
          period_start: string
          refresh_state?: string
          role_scope?: string | null
          supersedes_id?: string | null
          target_value?: number | null
          workspace_id?: string
        }
        Update: {
          branch_id?: string | null
          calculated_at?: string
          comparison_value?: number | null
          confidence_score?: number | null
          created_at?: string
          data_quality_score?: number | null
          department_id?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          metric_key?: string
          metric_value?: number | null
          period_end?: string
          period_start?: string
          refresh_state?: string
          role_scope?: string | null
          supersedes_id?: string | null
          target_value?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_kpi_snapshots_metric_key_fkey"
            columns: ["metric_key"]
            isOneToOne: false
            referencedRelation: "analytics_metric_definitions"
            referencedColumns: ["metric_key"]
          },
          {
            foreignKeyName: "analytics_kpi_snapshots_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "analytics_kpi_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_metric_definitions: {
        Row: {
          created_at: string
          description: string | null
          display_category: string
          drill_contract: Json
          enabled: boolean
          formula_sql: string | null
          formula_text: string
          id: string
          is_executive_metric: boolean
          label: string
          metric_key: string
          owner_role: string
          refresh_cadence: string
          source_tables: Json
          synthetic_weights: Json | null
          threshold_config: Json
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_category: string
          drill_contract?: Json
          enabled?: boolean
          formula_sql?: string | null
          formula_text: string
          id?: string
          is_executive_metric?: boolean
          label: string
          metric_key: string
          owner_role?: string
          refresh_cadence?: string
          source_tables?: Json
          synthetic_weights?: Json | null
          threshold_config?: Json
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          display_category?: string
          drill_contract?: Json
          enabled?: boolean
          formula_sql?: string | null
          formula_text?: string
          id?: string
          is_executive_metric?: boolean
          label?: string
          metric_key?: string
          owner_role?: string
          refresh_cadence?: string
          source_tables?: Json
          synthetic_weights?: Json | null
          threshold_config?: Json
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      anomaly_alerts: {
        Row: {
          acknowledged: boolean
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_type: string
          assigned_to: string | null
          created_at: string
          data: Json
          description: string
          entity_id: string | null
          entity_type: string | null
          id: string
          severity: string
          title: string
          workspace_id: string
        }
        Insert: {
          acknowledged?: boolean
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type: string
          assigned_to?: string | null
          created_at?: string
          data?: Json
          description: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          severity: string
          title: string
          workspace_id?: string
        }
        Update: {
          acknowledged?: boolean
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type?: string
          assigned_to?: string | null
          created_at?: string
          data?: Json
          description?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          severity?: string
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "anomaly_alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anomaly_alerts_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ar_credit_blocks: {
        Row: {
          block_reason: string
          block_threshold_days: number
          blocked_at: string
          blocked_by: string | null
          cleared_at: string | null
          cleared_by: string | null
          company_id: string
          created_at: string
          current_max_aging_days: number | null
          id: string
          override_accounting_notified_at: string | null
          override_approver_id: string | null
          override_created_at: string | null
          override_reason: string | null
          override_until: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          block_reason: string
          block_threshold_days?: number
          blocked_at?: string
          blocked_by?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          company_id: string
          created_at?: string
          current_max_aging_days?: number | null
          id?: string
          override_accounting_notified_at?: string | null
          override_approver_id?: string | null
          override_created_at?: string | null
          override_reason?: string | null
          override_until?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          block_reason?: string
          block_threshold_days?: number
          blocked_at?: string
          blocked_by?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          company_id?: string
          created_at?: string
          current_max_aging_days?: number | null
          id?: string
          override_accounting_notified_at?: string | null
          override_approver_id?: string | null
          override_created_at?: string | null
          override_reason?: string | null
          override_until?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ar_credit_blocks_blocked_by_fkey"
            columns: ["blocked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_credit_blocks_cleared_by_fkey"
            columns: ["cleared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_credit_blocks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_credit_blocks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_credit_blocks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "ar_credit_blocks_override_approver_id_fkey"
            columns: ["override_approver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      auction_results: {
        Row: {
          auction_date: string
          condition: string | null
          created_at: string
          hammer_price: number
          hours: number | null
          id: string
          imported_at: string
          imported_by: string | null
          location: string | null
          lot_number: string | null
          make: string
          metadata: Json | null
          model: string
          source: string
          year: number | null
        }
        Insert: {
          auction_date: string
          condition?: string | null
          created_at?: string
          hammer_price: number
          hours?: number | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          location?: string | null
          lot_number?: string | null
          make: string
          metadata?: Json | null
          model: string
          source: string
          year?: number | null
        }
        Update: {
          auction_date?: string
          condition?: string | null
          created_at?: string
          hammer_price?: number
          hours?: number | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          location?: string | null
          lot_number?: string | null
          make?: string
          metadata?: Json | null
          model?: string
          source?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "auction_results_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_transfer_edges: {
        Row: {
          active: boolean
          created_at: string
          from_branch: string
          id: string
          lead_time_hours: number
          to_branch: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          from_branch: string
          id?: string
          lead_time_hours?: number
          to_branch: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          from_branch?: string
          id?: string
          lead_time_hours?: number
          to_branch?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      branches: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          business_hours: Json
          capabilities: Json
          city: string | null
          country: string
          created_at: string
          default_tax_rate: number | null
          deleted_at: string | null
          delivery_radius_miles: number | null
          display_name: string
          doc_footer_text: string | null
          email_main: string | null
          email_parts: string | null
          email_sales: string | null
          email_service: string | null
          fax: string | null
          general_manager_id: string | null
          header_tagline: string | null
          id: string
          is_active: boolean
          latitude: number | null
          license_numbers: Json
          logo_url: string | null
          longitude: number | null
          max_service_bays: number | null
          metadata: Json
          notes: string | null
          parts_counter: boolean
          parts_manager_id: string | null
          phone_main: string | null
          phone_parts: string | null
          phone_sales: string | null
          phone_service: string | null
          postal_code: string | null
          rental_yard_capacity: number | null
          sales_manager_id: string | null
          service_manager_id: string | null
          short_code: string | null
          slug: string
          state_province: string | null
          tax_id: string | null
          timezone: string
          updated_at: string
          website_url: string | null
          workspace_id: string
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          business_hours?: Json
          capabilities?: Json
          city?: string | null
          country?: string
          created_at?: string
          default_tax_rate?: number | null
          deleted_at?: string | null
          delivery_radius_miles?: number | null
          display_name: string
          doc_footer_text?: string | null
          email_main?: string | null
          email_parts?: string | null
          email_sales?: string | null
          email_service?: string | null
          fax?: string | null
          general_manager_id?: string | null
          header_tagline?: string | null
          id?: string
          is_active?: boolean
          latitude?: number | null
          license_numbers?: Json
          logo_url?: string | null
          longitude?: number | null
          max_service_bays?: number | null
          metadata?: Json
          notes?: string | null
          parts_counter?: boolean
          parts_manager_id?: string | null
          phone_main?: string | null
          phone_parts?: string | null
          phone_sales?: string | null
          phone_service?: string | null
          postal_code?: string | null
          rental_yard_capacity?: number | null
          sales_manager_id?: string | null
          service_manager_id?: string | null
          short_code?: string | null
          slug: string
          state_province?: string | null
          tax_id?: string | null
          timezone?: string
          updated_at?: string
          website_url?: string | null
          workspace_id?: string
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          business_hours?: Json
          capabilities?: Json
          city?: string | null
          country?: string
          created_at?: string
          default_tax_rate?: number | null
          deleted_at?: string | null
          delivery_radius_miles?: number | null
          display_name?: string
          doc_footer_text?: string | null
          email_main?: string | null
          email_parts?: string | null
          email_sales?: string | null
          email_service?: string | null
          fax?: string | null
          general_manager_id?: string | null
          header_tagline?: string | null
          id?: string
          is_active?: boolean
          latitude?: number | null
          license_numbers?: Json
          logo_url?: string | null
          longitude?: number | null
          max_service_bays?: number | null
          metadata?: Json
          notes?: string | null
          parts_counter?: boolean
          parts_manager_id?: string | null
          phone_main?: string | null
          phone_parts?: string | null
          phone_sales?: string | null
          phone_service?: string | null
          postal_code?: string | null
          rental_yard_capacity?: number | null
          sales_manager_id?: string | null
          service_manager_id?: string | null
          short_code?: string | null
          slug?: string
          state_province?: string | null
          tax_id?: string | null
          timezone?: string
          updated_at?: string
          website_url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_general_manager_id_fkey"
            columns: ["general_manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branches_parts_manager_id_fkey"
            columns: ["parts_manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branches_sales_manager_id_fkey"
            columns: ["sales_manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branches_service_manager_id_fkey"
            columns: ["service_manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_recipients: {
        Row: {
          campaign_id: string
          channel: string
          clicked_at: string | null
          contact_id: string | null
          conversion_deal_id: string | null
          converted_at: string | null
          created_at: string
          delivered_at: string | null
          delivery_status: string | null
          id: string
          opened_at: string | null
          personalized_content: Json | null
          portal_customer_id: string | null
          unsubscribed: boolean | null
        }
        Insert: {
          campaign_id: string
          channel: string
          clicked_at?: string | null
          contact_id?: string | null
          conversion_deal_id?: string | null
          converted_at?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_status?: string | null
          id?: string
          opened_at?: string | null
          personalized_content?: Json | null
          portal_customer_id?: string | null
          unsubscribed?: boolean | null
        }
        Update: {
          campaign_id?: string
          channel?: string
          clicked_at?: string | null
          contact_id?: string | null
          conversion_deal_id?: string | null
          converted_at?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_status?: string | null
          id?: string
          opened_at?: string | null
          personalized_content?: Json | null
          portal_customer_id?: string | null
          unsubscribed?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_conversion_deal_id_fkey"
            columns: ["conversion_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_conversion_deal_id_fkey"
            columns: ["conversion_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_conversion_deal_id_fkey"
            columns: ["conversion_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_conversion_deal_id_fkey"
            columns: ["conversion_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_conversion_deal_id_fkey"
            columns: ["conversion_deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_conversion_deal_id_fkey"
            columns: ["conversion_deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "campaign_recipients_portal_customer_id_fkey"
            columns: ["portal_customer_id"]
            isOneToOne: false
            referencedRelation: "portal_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_entries: {
        Row: {
          acquired_at: string | null
          attachments: Json | null
          branch: string | null
          brochure_url: string | null
          category: string | null
          condition: string | null
          cost_to_qep: number | null
          created_at: string
          dealer_cost: number | null
          external_id: string | null
          id: string
          imported_at: string | null
          is_available: boolean
          is_yard_stock: boolean | null
          last_synced_at: string | null
          list_price: number | null
          make: string
          model: string
          msrp: number | null
          photos: Json | null
          quantity_discount_tier: string | null
          serial_number: string | null
          source: string
          source_location: string | null
          stock_number: string | null
          updated_at: string
          video_url: string | null
          workspace_id: string
          year: number | null
        }
        Insert: {
          acquired_at?: string | null
          attachments?: Json | null
          branch?: string | null
          brochure_url?: string | null
          category?: string | null
          condition?: string | null
          cost_to_qep?: number | null
          created_at?: string
          dealer_cost?: number | null
          external_id?: string | null
          id?: string
          imported_at?: string | null
          is_available?: boolean
          is_yard_stock?: boolean | null
          last_synced_at?: string | null
          list_price?: number | null
          make: string
          model: string
          msrp?: number | null
          photos?: Json | null
          quantity_discount_tier?: string | null
          serial_number?: string | null
          source?: string
          source_location?: string | null
          stock_number?: string | null
          updated_at?: string
          video_url?: string | null
          workspace_id?: string
          year?: number | null
        }
        Update: {
          acquired_at?: string | null
          attachments?: Json | null
          branch?: string | null
          brochure_url?: string | null
          category?: string | null
          condition?: string | null
          cost_to_qep?: number | null
          created_at?: string
          dealer_cost?: number | null
          external_id?: string | null
          id?: string
          imported_at?: string | null
          is_available?: boolean
          is_yard_stock?: boolean | null
          last_synced_at?: string | null
          list_price?: number | null
          make?: string
          model?: string
          msrp?: number | null
          photos?: Json | null
          quantity_discount_tier?: string | null
          serial_number?: string | null
          source?: string
          source_location?: string | null
          stock_number?: string | null
          updated_at?: string
          video_url?: string | null
          workspace_id?: string
          year?: number | null
        }
        Relationships: []
      }
      catalog_price_history: {
        Row: {
          catalog_entry_id: string
          change_pct: number | null
          changed_at: string
          changed_by: string | null
          created_at: string
          id: string
          new_value: number | null
          old_value: number | null
          price_type: string
          source: string | null
          workspace_id: string
        }
        Insert: {
          catalog_entry_id: string
          change_pct?: number | null
          changed_at?: string
          changed_by?: string | null
          created_at?: string
          id?: string
          new_value?: number | null
          old_value?: number | null
          price_type: string
          source?: string | null
          workspace_id?: string
        }
        Update: {
          catalog_entry_id?: string
          change_pct?: number | null
          changed_at?: string
          changed_by?: string | null
          created_at?: string
          id?: string
          new_value?: number | null
          old_value?: number | null
          price_type?: string
          source?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_price_history_catalog_entry_id_fkey"
            columns: ["catalog_entry_id"]
            isOneToOne: false
            referencedRelation: "catalog_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_price_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          context: Json | null
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          context?: Json | null
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Update: {
          context?: Json | null
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          feedback: string | null
          feedback_comment: string | null
          id: string
          retrieval_meta: Json | null
          role: string
          sources: Json | null
          trace_id: string | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          feedback?: string | null
          feedback_comment?: string | null
          id?: string
          retrieval_meta?: Json | null
          role: string
          sources?: Json | null
          trace_id?: string | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          feedback?: string | null
          feedback_comment?: string | null
          id?: string
          retrieval_meta?: Json | null
          role?: string
          sources?: Json | null
          trace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      chunks: {
        Row: {
          chunk_index: number
          chunk_kind: string
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          metadata: Json | null
          parent_chunk_id: string | null
          token_count: number | null
        }
        Insert: {
          chunk_index: number
          chunk_kind?: string
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          parent_chunk_id?: string | null
          token_count?: number | null
        }
        Update: {
          chunk_index?: number
          chunk_kind?: string
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          parent_chunk_id?: string | null
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chunks_parent_chunk_id_fkey"
            columns: ["parent_chunk_id"]
            isOneToOne: false
            referencedRelation: "chunks"
            referencedColumns: ["id"]
          },
        ]
      }
      competitive_mentions: {
        Row: {
          competitor_name: string
          context: string | null
          created_at: string
          id: string
          sentiment: string | null
          user_id: string
          voice_capture_id: string
        }
        Insert: {
          competitor_name: string
          context?: string | null
          created_at?: string
          id?: string
          sentiment?: string | null
          user_id: string
          voice_capture_id: string
        }
        Update: {
          competitor_name?: string
          context?: string | null
          created_at?: string
          id?: string
          sentiment?: string | null
          user_id?: string
          voice_capture_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitive_mentions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitive_mentions_voice_capture_id_fkey"
            columns: ["voice_capture_id"]
            isOneToOne: false
            referencedRelation: "voice_captures"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_listings: {
        Row: {
          asking_price: number | null
          created_at: string
          first_seen_at: string
          hours: number | null
          id: string
          is_active: boolean
          last_seen_at: string
          location: string | null
          make: string
          metadata: Json | null
          model: string
          source: string
          source_url: string | null
          updated_at: string
          year: number | null
        }
        Insert: {
          asking_price?: number | null
          created_at?: string
          first_seen_at?: string
          hours?: number | null
          id?: string
          is_active?: boolean
          last_seen_at?: string
          location?: string | null
          make: string
          metadata?: Json | null
          model: string
          source: string
          source_url?: string | null
          updated_at?: string
          year?: number | null
        }
        Update: {
          asking_price?: number | null
          created_at?: string
          first_seen_at?: string
          hours?: number | null
          id?: string
          is_active?: boolean
          last_seen_at?: string
          location?: string | null
          make?: string
          metadata?: Json | null
          model?: string
          source?: string
          source_url?: string | null
          updated_at?: string
          year?: number | null
        }
        Relationships: []
      }
      counter_inquiries: {
        Row: {
          created_at: string
          duration_seconds: number | null
          id: string
          inquiry_type: string
          machine_description: string | null
          machine_profile_id: string | null
          match_type: string | null
          outcome: string
          query_text: string
          result_parts: string[] | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          id?: string
          inquiry_type?: string
          machine_description?: string | null
          machine_profile_id?: string | null
          match_type?: string | null
          outcome?: string
          query_text: string
          result_parts?: string[] | null
          user_id: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          id?: string
          inquiry_type?: string
          machine_description?: string | null
          machine_profile_id?: string | null
          match_type?: string | null
          outcome?: string
          query_text?: string
          result_parts?: string[] | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "counter_inquiries_machine_profile_id_fkey"
            columns: ["machine_profile_id"]
            isOneToOne: false
            referencedRelation: "machine_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_campaign_recipients: {
        Row: {
          activity_id: string | null
          attempted_at: string | null
          campaign_id: string
          completed_at: string | null
          contact_id: string
          created_at: string
          error_code: string | null
          id: string
          ineligibility_reason: string | null
          metadata: Json
          provider_message_id: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          activity_id?: string | null
          attempted_at?: string | null
          campaign_id: string
          completed_at?: string | null
          contact_id: string
          created_at?: string
          error_code?: string | null
          id?: string
          ineligibility_reason?: string | null
          metadata?: Json
          provider_message_id?: string | null
          status: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          activity_id?: string | null
          attempted_at?: string | null
          campaign_id?: string
          completed_at?: string | null
          contact_id?: string
          created_at?: string
          error_code?: string | null
          id?: string
          ineligibility_reason?: string | null
          metadata?: Json
          provider_message_id?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_campaign_recipients_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "crm_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campaign_recipients_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "qrm_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "crm_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campaign_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campaign_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_campaigns: {
        Row: {
          audience_snapshot: Json
          channel: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          execution_summary: Json
          id: string
          name: string
          state: string
          template_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          audience_snapshot?: Json
          channel: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          execution_summary?: Json
          id?: string
          name: string
          state?: string
          template_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          audience_snapshot?: Json
          channel?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          execution_summary?: Json
          id?: string
          name?: string
          state?: string
          template_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "crm_activity_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "qrm_activity_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_communication_messages: {
        Row: {
          activity_id: string | null
          body_preview: string | null
          campaign_id: string | null
          channel: string
          contact_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          direction: string
          failure_code: string | null
          id: string
          idempotency_key: string | null
          metadata: Json
          occurred_at: string
          provider: string | null
          provider_message_id: string | null
          status: string
          subject: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          activity_id?: string | null
          body_preview?: string | null
          campaign_id?: string | null
          channel: string
          contact_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          direction: string
          failure_code?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          occurred_at?: string
          provider?: string | null
          provider_message_id?: string | null
          status: string
          subject?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          activity_id?: string | null
          body_preview?: string | null
          campaign_id?: string | null
          channel?: string
          contact_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          direction?: string
          failure_code?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          occurred_at?: string
          provider?: string | null
          provider_message_id?: string | null
          status?: string
          subject?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_communication_messages_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "crm_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_communication_messages_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "qrm_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_communication_messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "crm_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_communication_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_communication_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_communication_messages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_communication_webhook_receipts: {
        Row: {
          created_at: string
          event_id: string
          id: string
          metadata: Json
          payload_hash: string | null
          processed_at: string | null
          provider: string
          route_binding_key: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          metadata?: Json
          payload_hash?: string | null
          processed_at?: string | null
          provider: string
          route_binding_key?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          metadata?: Json
          payload_hash?: string | null
          processed_at?: string | null
          provider?: string
          route_binding_key?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      cross_department_alerts: {
        Row: {
          alert_type: string
          body: string | null
          context_entity_id: string | null
          context_entity_type: string | null
          created_at: string
          customer_profile_id: string | null
          id: string
          resolution_notes: string | null
          resolved_at: string | null
          routed_to_user_id: string | null
          severity: string
          source_department: string
          status: string
          target_department: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          alert_type: string
          body?: string | null
          context_entity_id?: string | null
          context_entity_type?: string | null
          created_at?: string
          customer_profile_id?: string | null
          id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          routed_to_user_id?: string | null
          severity?: string
          source_department: string
          status?: string
          target_department: string
          title: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          alert_type?: string
          body?: string | null
          context_entity_id?: string | null
          context_entity_type?: string | null
          created_at?: string
          customer_profile_id?: string | null
          id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          routed_to_user_id?: string | null
          severity?: string
          source_department?: string
          status?: string
          target_department?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cross_department_alerts_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "customer_profiles_extended"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_department_alerts_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "exec_health_movers"
            referencedColumns: ["customer_profile_id"]
          },
          {
            foreignKeyName: "cross_department_alerts_routed_to_user_id_fkey"
            columns: ["routed_to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_deal_history: {
        Row: {
          attachments_sold: number | null
          competitor: string | null
          created_at: string
          customer_profile_id: string
          days_to_close: number | null
          deal_date: string
          discount_pct: number | null
          equipment_category: string | null
          equipment_make: string | null
          equipment_model: string | null
          equipment_year: number | null
          financing_term_months: number | null
          financing_used: boolean | null
          hubspot_deal_id: string | null
          id: string
          list_price: number | null
          loss_reason: string | null
          margin_pct: number | null
          metadata: Json | null
          outcome: string
          rep_id: string | null
          service_contract_sold: boolean | null
          sold_price: number | null
          trade_in_value: number | null
        }
        Insert: {
          attachments_sold?: number | null
          competitor?: string | null
          created_at?: string
          customer_profile_id: string
          days_to_close?: number | null
          deal_date: string
          discount_pct?: number | null
          equipment_category?: string | null
          equipment_make?: string | null
          equipment_model?: string | null
          equipment_year?: number | null
          financing_term_months?: number | null
          financing_used?: boolean | null
          hubspot_deal_id?: string | null
          id?: string
          list_price?: number | null
          loss_reason?: string | null
          margin_pct?: number | null
          metadata?: Json | null
          outcome: string
          rep_id?: string | null
          service_contract_sold?: boolean | null
          sold_price?: number | null
          trade_in_value?: number | null
        }
        Update: {
          attachments_sold?: number | null
          competitor?: string | null
          created_at?: string
          customer_profile_id?: string
          days_to_close?: number | null
          deal_date?: string
          discount_pct?: number | null
          equipment_category?: string | null
          equipment_make?: string | null
          equipment_model?: string | null
          equipment_year?: number | null
          financing_term_months?: number | null
          financing_used?: boolean | null
          hubspot_deal_id?: string | null
          id?: string
          list_price?: number | null
          loss_reason?: string | null
          margin_pct?: number | null
          metadata?: Json | null
          outcome?: string
          rep_id?: string | null
          service_contract_sold?: boolean | null
          sold_price?: number | null
          trade_in_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_deal_history_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "customer_profiles_extended"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_deal_history_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "exec_health_movers"
            referencedColumns: ["customer_profile_id"]
          },
          {
            foreignKeyName: "customer_deal_history_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_fleet: {
        Row: {
          created_at: string
          current_hours: number | null
          equipment_id: string | null
          id: string
          is_active: boolean
          last_service_date: string | null
          maintenance_plan_id: string | null
          make: string
          model: string
          next_service_due: string | null
          portal_customer_id: string
          purchase_date: string | null
          purchase_deal_id: string | null
          serial_number: string | null
          service_interval_hours: number | null
          trade_in_interest: boolean | null
          trade_in_notes: string | null
          updated_at: string
          warranty_expiry: string | null
          warranty_type: string | null
          workspace_id: string
          year: number | null
        }
        Insert: {
          created_at?: string
          current_hours?: number | null
          equipment_id?: string | null
          id?: string
          is_active?: boolean
          last_service_date?: string | null
          maintenance_plan_id?: string | null
          make: string
          model: string
          next_service_due?: string | null
          portal_customer_id: string
          purchase_date?: string | null
          purchase_deal_id?: string | null
          serial_number?: string | null
          service_interval_hours?: number | null
          trade_in_interest?: boolean | null
          trade_in_notes?: string | null
          updated_at?: string
          warranty_expiry?: string | null
          warranty_type?: string | null
          workspace_id?: string
          year?: number | null
        }
        Update: {
          created_at?: string
          current_hours?: number | null
          equipment_id?: string | null
          id?: string
          is_active?: boolean
          last_service_date?: string | null
          maintenance_plan_id?: string | null
          make?: string
          model?: string
          next_service_due?: string | null
          portal_customer_id?: string
          purchase_date?: string | null
          purchase_deal_id?: string | null
          serial_number?: string | null
          service_interval_hours?: number | null
          trade_in_interest?: boolean | null
          trade_in_notes?: string | null
          updated_at?: string
          warranty_expiry?: string | null
          warranty_type?: string | null
          workspace_id?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_fleet_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_fleet_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "customer_fleet_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_fleet_portal_customer_id_fkey"
            columns: ["portal_customer_id"]
            isOneToOne: false
            referencedRelation: "portal_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_fleet_purchase_deal_id_fkey"
            columns: ["purchase_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_fleet_purchase_deal_id_fkey"
            columns: ["purchase_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_fleet_purchase_deal_id_fkey"
            columns: ["purchase_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_fleet_purchase_deal_id_fkey"
            columns: ["purchase_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_fleet_purchase_deal_id_fkey"
            columns: ["purchase_deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_fleet_purchase_deal_id_fkey"
            columns: ["purchase_deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      customer_invoice_line_items: {
        Row: {
          created_at: string
          description: string
          id: string
          invoice_id: string
          line_number: number
          line_total: number | null
          quantity: number
          unit_price: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          line_number?: number
          line_total?: number | null
          quantity?: number
          unit_price?: number
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          line_number?: number
          line_total?: number | null
          quantity?: number
          unit_price?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "customer_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_invoices: {
        Row: {
          amount: number
          amount_paid: number | null
          balance_due: number | null
          branch_id: string | null
          created_at: string
          crm_company_id: string | null
          deal_id: string | null
          description: string | null
          due_date: string
          id: string
          invoice_date: string
          invoice_number: string
          paid_at: string | null
          parts_order_id: string | null
          payment_method: string | null
          payment_reference: string | null
          portal_customer_id: string | null
          service_job_id: string | null
          service_request_id: string | null
          status: string
          tax: number | null
          total: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount: number
          amount_paid?: number | null
          balance_due?: number | null
          branch_id?: string | null
          created_at?: string
          crm_company_id?: string | null
          deal_id?: string | null
          description?: string | null
          due_date: string
          id?: string
          invoice_date?: string
          invoice_number: string
          paid_at?: string | null
          parts_order_id?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          portal_customer_id?: string | null
          service_job_id?: string | null
          service_request_id?: string | null
          status?: string
          tax?: number | null
          total: number
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          amount?: number
          amount_paid?: number | null
          balance_due?: number | null
          branch_id?: string | null
          created_at?: string
          crm_company_id?: string | null
          deal_id?: string | null
          description?: string | null
          due_date?: string
          id?: string
          invoice_date?: string
          invoice_number?: string
          paid_at?: string | null
          parts_order_id?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          portal_customer_id?: string | null
          service_job_id?: string | null
          service_request_id?: string | null
          status?: string
          tax?: number | null
          total?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_invoices_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_invoices_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_invoices_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_invoices_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_invoices_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_invoices_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_invoices_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_invoices_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_invoices_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "customer_invoices_parts_order_id_fkey"
            columns: ["parts_order_id"]
            isOneToOne: false
            referencedRelation: "parts_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_invoices_portal_customer_id_fkey"
            columns: ["portal_customer_id"]
            isOneToOne: false
            referencedRelation: "portal_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_invoices_service_job_id_fkey"
            columns: ["service_job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_invoices_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_customer_invoices_branch"
            columns: ["workspace_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["workspace_id", "slug"]
          },
        ]
      }
      customer_lifecycle_events: {
        Row: {
          company_id: string | null
          created_at: string
          customer_profile_id: string | null
          event_at: string
          event_type: string
          id: string
          metadata: Json
          source_id: string | null
          source_table: string | null
          workspace_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          customer_profile_id?: string | null
          event_at?: string
          event_type: string
          id?: string
          metadata?: Json
          source_id?: string | null
          source_table?: string | null
          workspace_id?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          customer_profile_id?: string | null
          event_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          source_id?: string | null
          source_table?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_lifecycle_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_lifecycle_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_lifecycle_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_lifecycle_events_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "customer_profiles_extended"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_lifecycle_events_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "exec_health_movers"
            referencedColumns: ["customer_profile_id"]
          },
        ]
      }
      customer_parts_intelligence: {
        Row: {
          avg_order_value: number
          churn_risk: string
          computation_batch_id: string | null
          computed_at: string
          crm_company_id: string
          days_since_last_order: number | null
          fleet_count: number
          id: string
          last_order_date: string | null
          machines_approaching_service: number
          monthly_spend: Json
          opportunity_value: number
          order_count_12m: number
          predicted_next_quarter_spend: number
          recommended_outreach: string | null
          spend_trend: string
          top_categories: Json
          total_spend_12m: number
          total_spend_prior_12m: number
          workspace_id: string
        }
        Insert: {
          avg_order_value?: number
          churn_risk?: string
          computation_batch_id?: string | null
          computed_at?: string
          crm_company_id: string
          days_since_last_order?: number | null
          fleet_count?: number
          id?: string
          last_order_date?: string | null
          machines_approaching_service?: number
          monthly_spend?: Json
          opportunity_value?: number
          order_count_12m?: number
          predicted_next_quarter_spend?: number
          recommended_outreach?: string | null
          spend_trend?: string
          top_categories?: Json
          total_spend_12m?: number
          total_spend_prior_12m?: number
          workspace_id?: string
        }
        Update: {
          avg_order_value?: number
          churn_risk?: string
          computation_batch_id?: string | null
          computed_at?: string
          crm_company_id?: string
          days_since_last_order?: number | null
          fleet_count?: number
          id?: string
          last_order_date?: string | null
          machines_approaching_service?: number
          monthly_spend?: Json
          opportunity_value?: number
          order_count_12m?: number
          predicted_next_quarter_spend?: number
          recommended_outreach?: string | null
          spend_trend?: string
          top_categories?: Json
          total_spend_12m?: number
          total_spend_prior_12m?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_parts_intelligence_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_parts_intelligence_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_parts_intelligence_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      customer_profile_access_audit: {
        Row: {
          access_mode: string
          actor_role: string | null
          actor_user_id: string | null
          created_at: string
          customer_profile_id: string
          deleted_at: string | null
          hubspot_contact_id: string | null
          id: string
          intellidealer_customer_id: string | null
          source: string
          updated_at: string
        }
        Insert: {
          access_mode?: string
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          customer_profile_id: string
          deleted_at?: string | null
          hubspot_contact_id?: string | null
          id?: string
          intellidealer_customer_id?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          access_mode?: string
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          customer_profile_id?: string
          deleted_at?: string | null
          hubspot_contact_id?: string | null
          id?: string
          intellidealer_customer_id?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_profile_access_audit_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_profile_access_audit_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "customer_profiles_extended"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_profile_access_audit_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "exec_health_movers"
            referencedColumns: ["customer_profile_id"]
          },
        ]
      }
      customer_profiles_extended: {
        Row: {
          attachment_rate: number | null
          avg_days_to_close: number | null
          avg_deal_size: number | null
          avg_discount_pct: number | null
          budget_cycle_month: number | null
          budget_cycle_notes: string | null
          company_name: string | null
          created_at: string
          crm_company_id: string | null
          customer_name: string
          fiscal_year_end_month: number | null
          fleet_size: number | null
          health_score: number | null
          health_score_components: Json | null
          health_score_updated_at: string | null
          hubspot_contact_id: string | null
          id: string
          industry: string | null
          intellidealer_customer_id: string | null
          last_deal_at: string | null
          last_interaction_at: string | null
          lifetime_value: number | null
          metadata: Json | null
          notes: string | null
          persona_confidence: number | null
          persona_model_version: string | null
          price_sensitivity_score: number | null
          pricing_persona: Database["public"]["Enums"]["pricing_persona"] | null
          region: string | null
          revenue_attribution: Json | null
          seasonal_pattern: string | null
          service_contract_rate: number | null
          total_deals: number | null
          updated_at: string
        }
        Insert: {
          attachment_rate?: number | null
          avg_days_to_close?: number | null
          avg_deal_size?: number | null
          avg_discount_pct?: number | null
          budget_cycle_month?: number | null
          budget_cycle_notes?: string | null
          company_name?: string | null
          created_at?: string
          crm_company_id?: string | null
          customer_name: string
          fiscal_year_end_month?: number | null
          fleet_size?: number | null
          health_score?: number | null
          health_score_components?: Json | null
          health_score_updated_at?: string | null
          hubspot_contact_id?: string | null
          id?: string
          industry?: string | null
          intellidealer_customer_id?: string | null
          last_deal_at?: string | null
          last_interaction_at?: string | null
          lifetime_value?: number | null
          metadata?: Json | null
          notes?: string | null
          persona_confidence?: number | null
          persona_model_version?: string | null
          price_sensitivity_score?: number | null
          pricing_persona?:
            | Database["public"]["Enums"]["pricing_persona"]
            | null
          region?: string | null
          revenue_attribution?: Json | null
          seasonal_pattern?: string | null
          service_contract_rate?: number | null
          total_deals?: number | null
          updated_at?: string
        }
        Update: {
          attachment_rate?: number | null
          avg_days_to_close?: number | null
          avg_deal_size?: number | null
          avg_discount_pct?: number | null
          budget_cycle_month?: number | null
          budget_cycle_notes?: string | null
          company_name?: string | null
          created_at?: string
          crm_company_id?: string | null
          customer_name?: string
          fiscal_year_end_month?: number | null
          fleet_size?: number | null
          health_score?: number | null
          health_score_components?: Json | null
          health_score_updated_at?: string | null
          hubspot_contact_id?: string | null
          id?: string
          industry?: string | null
          intellidealer_customer_id?: string | null
          last_deal_at?: string | null
          last_interaction_at?: string | null
          lifetime_value?: number | null
          metadata?: Json | null
          notes?: string | null
          persona_confidence?: number | null
          persona_model_version?: string | null
          price_sensitivity_score?: number | null
          pricing_persona?:
            | Database["public"]["Enums"]["pricing_persona"]
            | null
          region?: string | null
          revenue_attribution?: Json | null
          seasonal_pattern?: string | null
          service_contract_rate?: number | null
          total_deals?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_profiles_extended_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_profiles_extended_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_profiles_extended_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      daily_briefings: {
        Row: {
          briefing_content: Json
          briefing_date: string
          created_at: string
          expires_at: string
          generated_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          briefing_content: Json
          briefing_date?: string
          created_at?: string
          expires_at?: string
          generated_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          briefing_content?: Json
          briefing_date?: string
          created_at?: string
          expires_at?: string
          generated_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      deal_feedback: {
        Row: {
          action: string
          created_at: string
          deal_outcome: string | null
          deal_scenario_id: string
          feedback_by: string
          feedback_role: Database["public"]["Enums"]["user_role"]
          id: string
          modifications: Json | null
          quote_id: string
          reason: string | null
        }
        Insert: {
          action: string
          created_at?: string
          deal_outcome?: string | null
          deal_scenario_id: string
          feedback_by: string
          feedback_role: Database["public"]["Enums"]["user_role"]
          id?: string
          modifications?: Json | null
          quote_id: string
          reason?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          deal_outcome?: string | null
          deal_scenario_id?: string
          feedback_by?: string
          feedback_role?: Database["public"]["Enums"]["user_role"]
          id?: string
          modifications?: Json | null
          quote_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_feedback_deal_scenario_id_fkey"
            columns: ["deal_scenario_id"]
            isOneToOne: false
            referencedRelation: "deal_scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_feedback_feedback_by_fkey"
            columns: ["feedback_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_scenarios: {
        Row: {
          ai_model: string | null
          ai_temperature: number | null
          ai_tokens_used: number | null
          close_probability: number | null
          created_at: string
          customer_profile_id: string | null
          deal_id: string | null
          discount_pct: number | null
          equipment_make: string
          equipment_model: string
          equipment_stock_number: string | null
          equipment_year: number | null
          expected_value: number | null
          explanation: string
          financing_holdback_pct: number | null
          financing_monthly_payment: number | null
          financing_rate_pct: number | null
          financing_recommended: boolean | null
          financing_term_months: number | null
          id: string
          is_recommended: boolean | null
          is_selected: boolean | null
          list_price: number
          market_valuation_id: string | null
          metadata: Json | null
          quote_id: string
          recommended_price: number
          scenario_type: Database["public"]["Enums"]["scenario_type"]
          selected_at: string | null
          selected_by: string | null
          total_deal_margin: number | null
          total_deal_margin_pct: number | null
          trade_in_actual_value: number | null
          trade_in_allowance: number | null
          updated_at: string
        }
        Insert: {
          ai_model?: string | null
          ai_temperature?: number | null
          ai_tokens_used?: number | null
          close_probability?: number | null
          created_at?: string
          customer_profile_id?: string | null
          deal_id?: string | null
          discount_pct?: number | null
          equipment_make: string
          equipment_model: string
          equipment_stock_number?: string | null
          equipment_year?: number | null
          expected_value?: number | null
          explanation: string
          financing_holdback_pct?: number | null
          financing_monthly_payment?: number | null
          financing_rate_pct?: number | null
          financing_recommended?: boolean | null
          financing_term_months?: number | null
          id?: string
          is_recommended?: boolean | null
          is_selected?: boolean | null
          list_price: number
          market_valuation_id?: string | null
          metadata?: Json | null
          quote_id: string
          recommended_price: number
          scenario_type: Database["public"]["Enums"]["scenario_type"]
          selected_at?: string | null
          selected_by?: string | null
          total_deal_margin?: number | null
          total_deal_margin_pct?: number | null
          trade_in_actual_value?: number | null
          trade_in_allowance?: number | null
          updated_at?: string
        }
        Update: {
          ai_model?: string | null
          ai_temperature?: number | null
          ai_tokens_used?: number | null
          close_probability?: number | null
          created_at?: string
          customer_profile_id?: string | null
          deal_id?: string | null
          discount_pct?: number | null
          equipment_make?: string
          equipment_model?: string
          equipment_stock_number?: string | null
          equipment_year?: number | null
          expected_value?: number | null
          explanation?: string
          financing_holdback_pct?: number | null
          financing_monthly_payment?: number | null
          financing_rate_pct?: number | null
          financing_recommended?: boolean | null
          financing_term_months?: number | null
          id?: string
          is_recommended?: boolean | null
          is_selected?: boolean | null
          list_price?: number
          market_valuation_id?: string | null
          metadata?: Json | null
          quote_id?: string
          recommended_price?: number
          scenario_type?: Database["public"]["Enums"]["scenario_type"]
          selected_at?: string | null
          selected_by?: string | null
          total_deal_margin?: number | null
          total_deal_margin_pct?: number | null
          trade_in_actual_value?: number | null
          trade_in_allowance?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_scenarios_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "customer_profiles_extended"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_scenarios_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "exec_health_movers"
            referencedColumns: ["customer_profile_id"]
          },
          {
            foreignKeyName: "deal_scenarios_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_scenarios_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_scenarios_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_scenarios_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_scenarios_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_scenarios_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_scenarios_market_valuation_id_fkey"
            columns: ["market_valuation_id"]
            isOneToOne: false
            referencedRelation: "market_valuations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_scenarios_selected_by_fkey"
            columns: ["selected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_timing_alerts: {
        Row: {
          actioned_at: string | null
          actioned_deal_id: string | null
          alert_type: string
          assigned_rep_id: string | null
          created_at: string
          customer_profile_id: string | null
          description: string | null
          fleet_intelligence_id: string | null
          id: string
          recommended_action: string | null
          status: string
          title: string
          trigger_date: string
          updated_at: string
          urgency: string
          workspace_id: string
        }
        Insert: {
          actioned_at?: string | null
          actioned_deal_id?: string | null
          alert_type: string
          assigned_rep_id?: string | null
          created_at?: string
          customer_profile_id?: string | null
          description?: string | null
          fleet_intelligence_id?: string | null
          id?: string
          recommended_action?: string | null
          status?: string
          title: string
          trigger_date: string
          updated_at?: string
          urgency?: string
          workspace_id?: string
        }
        Update: {
          actioned_at?: string | null
          actioned_deal_id?: string | null
          alert_type?: string
          assigned_rep_id?: string | null
          created_at?: string
          customer_profile_id?: string | null
          description?: string | null
          fleet_intelligence_id?: string | null
          id?: string
          recommended_action?: string | null
          status?: string
          title?: string
          trigger_date?: string
          updated_at?: string
          urgency?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_timing_alerts_actioned_deal_id_fkey"
            columns: ["actioned_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_timing_alerts_actioned_deal_id_fkey"
            columns: ["actioned_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_timing_alerts_actioned_deal_id_fkey"
            columns: ["actioned_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_timing_alerts_actioned_deal_id_fkey"
            columns: ["actioned_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_timing_alerts_actioned_deal_id_fkey"
            columns: ["actioned_deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_timing_alerts_actioned_deal_id_fkey"
            columns: ["actioned_deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_timing_alerts_assigned_rep_id_fkey"
            columns: ["assigned_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_timing_alerts_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "customer_profiles_extended"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_timing_alerts_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "exec_health_movers"
            referencedColumns: ["customer_profile_id"]
          },
          {
            foreignKeyName: "deal_timing_alerts_fleet_intelligence_id_fkey"
            columns: ["fleet_intelligence_id"]
            isOneToOne: false
            referencedRelation: "equipment_lifecycle_summary"
            referencedColumns: ["fleet_intelligence_id"]
          },
          {
            foreignKeyName: "deal_timing_alerts_fleet_intelligence_id_fkey"
            columns: ["fleet_intelligence_id"]
            isOneToOne: false
            referencedRelation: "fleet_intelligence"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_inspections: {
        Row: {
          checklist_items: Json
          completed_at: string | null
          created_at: string
          damage_description: string | null
          damage_found: boolean | null
          damage_photos: Json | null
          demo_id: string
          id: string
          inspection_type: string
          inspector_id: string | null
          overall_condition: string | null
          photos: Json | null
        }
        Insert: {
          checklist_items?: Json
          completed_at?: string | null
          created_at?: string
          damage_description?: string | null
          damage_found?: boolean | null
          damage_photos?: Json | null
          demo_id: string
          id?: string
          inspection_type: string
          inspector_id?: string | null
          overall_condition?: string | null
          photos?: Json | null
        }
        Update: {
          checklist_items?: Json
          completed_at?: string | null
          created_at?: string
          damage_description?: string | null
          damage_found?: boolean | null
          damage_photos?: Json | null
          demo_id?: string
          id?: string
          inspection_type?: string
          inspector_id?: string | null
          overall_condition?: string | null
          photos?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "demo_inspections_demo_id_fkey"
            columns: ["demo_id"]
            isOneToOne: false
            referencedRelation: "demos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demo_inspections_inspector_id_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      demos: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          buying_intent_confirmed: boolean
          created_at: string
          customer_decision: string | null
          customer_responsible_damage: boolean | null
          customer_responsible_def: boolean | null
          customer_responsible_fuel: boolean | null
          deal_id: string
          denial_reason: string | null
          ending_hours: number | null
          equipment_category: string | null
          equipment_id: string | null
          followup_completed: boolean | null
          followup_due_at: string | null
          fuel_cost: number | null
          hours_used: number | null
          id: string
          max_hours: number
          needs_assessment_complete: boolean
          prep_labor_cost: number | null
          quote_presented: boolean
          requested_by: string | null
          scheduled_date: string | null
          scheduled_time_end: string | null
          scheduled_time_start: string | null
          starting_hours: number | null
          status: string
          total_demo_cost: number | null
          traffic_ticket_id: string | null
          traffic_ticket_id_fk: string | null
          transport_cost: number | null
          updated_at: string
          wear_cost: number | null
          workspace_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          buying_intent_confirmed?: boolean
          created_at?: string
          customer_decision?: string | null
          customer_responsible_damage?: boolean | null
          customer_responsible_def?: boolean | null
          customer_responsible_fuel?: boolean | null
          deal_id: string
          denial_reason?: string | null
          ending_hours?: number | null
          equipment_category?: string | null
          equipment_id?: string | null
          followup_completed?: boolean | null
          followup_due_at?: string | null
          fuel_cost?: number | null
          hours_used?: number | null
          id?: string
          max_hours?: number
          needs_assessment_complete?: boolean
          prep_labor_cost?: number | null
          quote_presented?: boolean
          requested_by?: string | null
          scheduled_date?: string | null
          scheduled_time_end?: string | null
          scheduled_time_start?: string | null
          starting_hours?: number | null
          status?: string
          total_demo_cost?: number | null
          traffic_ticket_id?: string | null
          traffic_ticket_id_fk?: string | null
          transport_cost?: number | null
          updated_at?: string
          wear_cost?: number | null
          workspace_id?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          buying_intent_confirmed?: boolean
          created_at?: string
          customer_decision?: string | null
          customer_responsible_damage?: boolean | null
          customer_responsible_def?: boolean | null
          customer_responsible_fuel?: boolean | null
          deal_id?: string
          denial_reason?: string | null
          ending_hours?: number | null
          equipment_category?: string | null
          equipment_id?: string | null
          followup_completed?: boolean | null
          followup_due_at?: string | null
          fuel_cost?: number | null
          hours_used?: number | null
          id?: string
          max_hours?: number
          needs_assessment_complete?: boolean
          prep_labor_cost?: number | null
          quote_presented?: boolean
          requested_by?: string | null
          scheduled_date?: string | null
          scheduled_time_end?: string | null
          scheduled_time_start?: string | null
          starting_hours?: number | null
          status?: string
          total_demo_cost?: number | null
          traffic_ticket_id?: string | null
          traffic_ticket_id_fk?: string | null
          transport_cost?: number | null
          updated_at?: string
          wear_cost?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "demos_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demos_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demos_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demos_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demos_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demos_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demos_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "demos_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demos_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "demos_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demos_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demos_traffic_ticket_id_fk_fkey"
            columns: ["traffic_ticket_id_fk"]
            isOneToOne: false
            referencedRelation: "traffic_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      deposits: {
        Row: {
          applied_to_final_invoice: boolean | null
          created_at: string
          created_by: string | null
          deal_id: string
          deposit_tier: string
          equipment_value: number
          id: string
          invoice_reference: string | null
          payment_method: string | null
          received_at: string | null
          refund_completed_at: string | null
          refund_initiated_at: string | null
          refund_policy: string
          required_amount: number
          status: string
          updated_at: string
          verification_cycle_hours: number | null
          verified_at: string | null
          verified_by: string | null
          workspace_id: string
        }
        Insert: {
          applied_to_final_invoice?: boolean | null
          created_at?: string
          created_by?: string | null
          deal_id: string
          deposit_tier: string
          equipment_value: number
          id?: string
          invoice_reference?: string | null
          payment_method?: string | null
          received_at?: string | null
          refund_completed_at?: string | null
          refund_initiated_at?: string | null
          refund_policy?: string
          required_amount: number
          status?: string
          updated_at?: string
          verification_cycle_hours?: number | null
          verified_at?: string | null
          verified_by?: string | null
          workspace_id?: string
        }
        Update: {
          applied_to_final_invoice?: boolean | null
          created_at?: string
          created_by?: string | null
          deal_id?: string
          deposit_tier?: string
          equipment_value?: number
          id?: string
          invoice_reference?: string | null
          payment_method?: string | null
          received_at?: string | null
          refund_completed_at?: string | null
          refund_initiated_at?: string | null
          refund_policy?: string
          required_amount?: number
          status?: string
          updated_at?: string
          verification_cycle_hours?: number | null
          verified_at?: string | null
          verified_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deposits_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deposits_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dge_learning_events: {
        Row: {
          accuracy_delta: number | null
          created_at: string
          deal_id: string
          deal_outcome: string | null
          final_amount: number | null
          final_margin_pct: number | null
          id: string
          outcome_at: string | null
          scenario_type: Database["public"]["Enums"]["scenario_type"]
          selected_at: string
          selected_by: string | null
          workspace_id: string
        }
        Insert: {
          accuracy_delta?: number | null
          created_at?: string
          deal_id: string
          deal_outcome?: string | null
          final_amount?: number | null
          final_margin_pct?: number | null
          id?: string
          outcome_at?: string | null
          scenario_type: Database["public"]["Enums"]["scenario_type"]
          selected_at?: string
          selected_by?: string | null
          workspace_id?: string
        }
        Update: {
          accuracy_delta?: number | null
          created_at?: string
          deal_id?: string
          deal_outcome?: string | null
          final_amount?: number | null
          final_margin_pct?: number | null
          id?: string
          outcome_at?: string | null
          scenario_type?: Database["public"]["Enums"]["scenario_type"]
          selected_at?: string
          selected_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dge_learning_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dge_learning_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dge_learning_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dge_learning_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dge_learning_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dge_learning_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "dge_learning_events_selected_by_fkey"
            columns: ["selected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dge_refresh_jobs: {
        Row: {
          attempt_count: number
          created_at: string
          dedupe_key: string
          deleted_at: string | null
          finished_at: string | null
          id: string
          job_type: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          priority: number
          request_payload: Json
          requested_by: string | null
          result_payload: Json
          started_at: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          dedupe_key: string
          deleted_at?: string | null
          finished_at?: string | null
          id?: string
          job_type: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          priority?: number
          request_payload?: Json
          requested_by?: string | null
          result_payload?: Json
          started_at?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          dedupe_key?: string
          deleted_at?: string | null
          finished_at?: string | null
          id?: string
          job_type?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          priority?: number
          request_payload?: Json
          requested_by?: string | null
          result_payload?: Json
          started_at?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dge_refresh_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dge_variable_breakdown: {
        Row: {
          created_at: string
          deal_scenario_id: string
          description: string | null
          display_order: number
          id: string
          impact_direction: string
          variable_name: string
          variable_unit: string
          variable_value: number | null
          weight: number | null
        }
        Insert: {
          created_at?: string
          deal_scenario_id: string
          description?: string | null
          display_order?: number
          id?: string
          impact_direction: string
          variable_name: string
          variable_unit?: string
          variable_value?: number | null
          weight?: number | null
        }
        Update: {
          created_at?: string
          deal_scenario_id?: string
          description?: string | null
          display_order?: number
          id?: string
          impact_direction?: string
          variable_name?: string
          variable_unit?: string
          variable_value?: number | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dge_variable_breakdown_deal_scenario_id_fkey"
            columns: ["deal_scenario_id"]
            isOneToOne: false
            referencedRelation: "deal_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      document_audit_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          document_id: string | null
          document_title_snapshot: string | null
          event_type: Database["public"]["Enums"]["document_audit_event_type"]
          id: string
          metadata: Json
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          document_id?: string | null
          document_title_snapshot?: string | null
          event_type: Database["public"]["Enums"]["document_audit_event_type"]
          id?: string
          metadata?: Json
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          document_id?: string | null
          document_title_snapshot?: string | null
          event_type?: Database["public"]["Enums"]["document_audit_event_type"]
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "document_audit_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_audit_events_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_visibility_audit: {
        Row: {
          changed_by: string | null
          created_at: string
          document_id: string
          id: string
          reason: string | null
          visibility_after: boolean | null
          visibility_before: boolean | null
          workspace_id: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          document_id: string
          id?: string
          reason?: string | null
          visibility_after?: boolean | null
          visibility_before?: boolean | null
          workspace_id?: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          document_id?: string
          id?: string
          reason?: string | null
          visibility_after?: boolean | null
          visibility_before?: boolean | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_visibility_audit_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          audience: Database["public"]["Enums"]["document_audience"]
          classification_updated_at: string | null
          classification_updated_by: string | null
          created_at: string
          id: string
          is_active: boolean
          metadata: Json | null
          mime_type: string | null
          raw_text: string | null
          review_due_at: string | null
          review_interval_days: number
          review_owner_user_id: string | null
          source: Database["public"]["Enums"]["document_source"]
          source_id: string | null
          source_url: string | null
          status: Database["public"]["Enums"]["document_status"]
          summary: string | null
          title: string
          updated_at: string
          uploaded_by: string | null
          word_count: number | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          audience?: Database["public"]["Enums"]["document_audience"]
          classification_updated_at?: string | null
          classification_updated_by?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json | null
          mime_type?: string | null
          raw_text?: string | null
          review_due_at?: string | null
          review_interval_days?: number
          review_owner_user_id?: string | null
          source: Database["public"]["Enums"]["document_source"]
          source_id?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          summary?: string | null
          title: string
          updated_at?: string
          uploaded_by?: string | null
          word_count?: number | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          audience?: Database["public"]["Enums"]["document_audience"]
          classification_updated_at?: string | null
          classification_updated_by?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json | null
          mime_type?: string | null
          raw_text?: string | null
          review_due_at?: string | null
          review_interval_days?: number
          review_owner_user_id?: string | null
          source?: Database["public"]["Enums"]["document_source"]
          source_id?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          summary?: string | null
          title?: string
          updated_at?: string
          uploaded_by?: string | null
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_classification_updated_by_fkey"
            columns: ["classification_updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_review_owner_user_id_fkey"
            columns: ["review_owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      eaas_subscriptions: {
        Row: {
          auto_renew: boolean | null
          base_monthly_rate: number
          billing_cycle: string | null
          created_at: string
          end_date: string | null
          equipment_id: string | null
          id: string
          includes_maintenance: boolean | null
          last_rotation_date: string | null
          maintenance_schedule_id: string | null
          next_billing_date: string | null
          next_rotation_date: string | null
          overage_rate: number | null
          plan_name: string
          plan_type: string
          portal_customer_id: string
          renewal_terms: Json | null
          rotation_eligible: boolean | null
          rotation_interval_months: number | null
          start_date: string
          status: string
          total_billed: number | null
          updated_at: string
          usage_cap_hours: number | null
          usage_rate_per_hour: number | null
          workspace_id: string
        }
        Insert: {
          auto_renew?: boolean | null
          base_monthly_rate: number
          billing_cycle?: string | null
          created_at?: string
          end_date?: string | null
          equipment_id?: string | null
          id?: string
          includes_maintenance?: boolean | null
          last_rotation_date?: string | null
          maintenance_schedule_id?: string | null
          next_billing_date?: string | null
          next_rotation_date?: string | null
          overage_rate?: number | null
          plan_name: string
          plan_type: string
          portal_customer_id: string
          renewal_terms?: Json | null
          rotation_eligible?: boolean | null
          rotation_interval_months?: number | null
          start_date: string
          status?: string
          total_billed?: number | null
          updated_at?: string
          usage_cap_hours?: number | null
          usage_rate_per_hour?: number | null
          workspace_id?: string
        }
        Update: {
          auto_renew?: boolean | null
          base_monthly_rate?: number
          billing_cycle?: string | null
          created_at?: string
          end_date?: string | null
          equipment_id?: string | null
          id?: string
          includes_maintenance?: boolean | null
          last_rotation_date?: string | null
          maintenance_schedule_id?: string | null
          next_billing_date?: string | null
          next_rotation_date?: string | null
          overage_rate?: number | null
          plan_name?: string
          plan_type?: string
          portal_customer_id?: string
          renewal_terms?: Json | null
          rotation_eligible?: boolean | null
          rotation_interval_months?: number | null
          start_date?: string
          status?: string
          total_billed?: number | null
          updated_at?: string
          usage_cap_hours?: number | null
          usage_rate_per_hour?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eaas_subscriptions_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eaas_subscriptions_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "eaas_subscriptions_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eaas_subscriptions_portal_customer_id_fkey"
            columns: ["portal_customer_id"]
            isOneToOne: false
            referencedRelation: "portal_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      eaas_usage_records: {
        Row: {
          base_charge: number
          created_at: string
          hours_included: number | null
          hours_used: number
          id: string
          invoice_id: string | null
          invoiced: boolean | null
          overage_charge: number | null
          overage_hours: number | null
          period_end: string
          period_start: string
          source: string
          subscription_id: string
          telematics_device_id: string | null
          total_charge: number | null
        }
        Insert: {
          base_charge?: number
          created_at?: string
          hours_included?: number | null
          hours_used?: number
          id?: string
          invoice_id?: string | null
          invoiced?: boolean | null
          overage_charge?: number | null
          overage_hours?: number | null
          period_end: string
          period_start: string
          source?: string
          subscription_id: string
          telematics_device_id?: string | null
          total_charge?: number | null
        }
        Update: {
          base_charge?: number
          created_at?: string
          hours_included?: number | null
          hours_used?: number
          id?: string
          invoice_id?: string | null
          invoiced?: boolean | null
          overage_charge?: number | null
          overage_hours?: number | null
          period_end?: string
          period_start?: string
          source?: string
          subscription_id?: string
          telematics_device_id?: string | null
          total_charge?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "eaas_usage_records_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "customer_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eaas_usage_records_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "eaas_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      economic_indicators: {
        Row: {
          created_at: string
          id: string
          indicator_key: string
          indicator_name: string
          metadata: Json | null
          observation_date: string
          series_id: string | null
          source: string
          unit: string | null
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          indicator_key: string
          indicator_name: string
          metadata?: Json | null
          observation_date: string
          series_id?: string | null
          source: string
          unit?: string | null
          value: number
        }
        Update: {
          created_at?: string
          id?: string
          indicator_key?: string
          indicator_name?: string
          metadata?: Json | null
          observation_date?: string
          series_id?: string | null
          source?: string
          unit?: string | null
          value?: number
        }
        Relationships: []
      }
      economic_sync_runs: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          error: string | null
          finished_at: string | null
          id: string
          indicators: string[]
          mode: string
          rows_upserted: number
          started_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          indicators?: string[]
          mode?: string
          rows_upserted?: number
          started_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          indicators?: string[]
          mode?: string
          rows_upserted?: number
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "economic_sync_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_drafts: {
        Row: {
          body: string
          company_id: string | null
          contact_id: string | null
          context: Json
          created_at: string
          created_by: string | null
          deal_id: string | null
          equipment_id: string | null
          id: string
          preview: string | null
          scenario: string
          sent_at: string | null
          sent_via: string | null
          status: string
          subject: string
          to_email: string | null
          tone: string
          updated_at: string
          urgency_score: number | null
          workspace_id: string
        }
        Insert: {
          body: string
          company_id?: string | null
          contact_id?: string | null
          context?: Json
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          equipment_id?: string | null
          id?: string
          preview?: string | null
          scenario: string
          sent_at?: string | null
          sent_via?: string | null
          status?: string
          subject: string
          to_email?: string | null
          tone?: string
          updated_at?: string
          urgency_score?: number | null
          workspace_id?: string
        }
        Update: {
          body?: string
          company_id?: string | null
          contact_id?: string | null
          context?: Json
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          equipment_id?: string | null
          id?: string
          preview?: string | null
          scenario?: string
          sent_at?: string | null
          sent_via?: string | null
          status?: string
          subject?: string
          to_email?: string | null
          tone?: string
          updated_at?: string
          urgency_score?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_drafts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "email_drafts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "email_drafts_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "email_drafts_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_age_categories: {
        Row: {
          age_bracket_label: string
          category: string
          created_at: string
          id: string
          make: string | null
          max_hours: number | null
          max_years: number | null
          min_hours: number | null
          min_years: number | null
          model: string | null
          replacement_probability: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          age_bracket_label: string
          category: string
          created_at?: string
          id?: string
          make?: string | null
          max_hours?: number | null
          max_years?: number | null
          min_hours?: number | null
          min_years?: number | null
          model?: string | null
          replacement_probability?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          age_bracket_label?: string
          category?: string
          created_at?: string
          id?: string
          make?: string | null
          max_hours?: number | null
          max_years?: number | null
          min_hours?: number | null
          min_years?: number | null
          model?: string | null
          replacement_probability?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      equipment_documents: {
        Row: {
          created_at: string
          crm_equipment_id: string | null
          customer_visible: boolean
          description: string | null
          document_type: string
          file_size_bytes: number | null
          file_url: string
          fleet_id: string | null
          id: string
          mime_type: string | null
          portal_customer_id: string | null
          title: string
          updated_at: string
          uploaded_by: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          crm_equipment_id?: string | null
          customer_visible?: boolean
          description?: string | null
          document_type: string
          file_size_bytes?: number | null
          file_url: string
          fleet_id?: string | null
          id?: string
          mime_type?: string | null
          portal_customer_id?: string | null
          title: string
          updated_at?: string
          uploaded_by?: string | null
          workspace_id?: string
        }
        Update: {
          created_at?: string
          crm_equipment_id?: string | null
          customer_visible?: boolean
          description?: string | null
          document_type?: string
          file_size_bytes?: number | null
          file_url?: string
          fleet_id?: string | null
          id?: string
          mime_type?: string | null
          portal_customer_id?: string | null
          title?: string
          updated_at?: string
          uploaded_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_documents_crm_equipment_id_fkey"
            columns: ["crm_equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_documents_crm_equipment_id_fkey"
            columns: ["crm_equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "equipment_documents_crm_equipment_id_fkey"
            columns: ["crm_equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_documents_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "customer_fleet"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_documents_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "portal_trade_in_opportunities"
            referencedColumns: ["fleet_id"]
          },
          {
            foreignKeyName: "equipment_documents_portal_customer_id_fkey"
            columns: ["portal_customer_id"]
            isOneToOne: false
            referencedRelation: "portal_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_intake: {
        Row: {
          arrival_date: string | null
          arrival_photos: Json | null
          attachments_mounted: boolean | null
          barcode_exterior: boolean | null
          barcode_interior: boolean | null
          created_at: string
          current_stage: number
          decals_installed: boolean | null
          demand_assessment: string | null
          detail_contractor: string | null
          detail_needed: boolean | null
          detail_scheduled: boolean | null
          equipment_id: string | null
          equipment_trader_listed: boolean | null
          estimated_arrival: string | null
          facebook_listed: boolean | null
          freight_damage_found: boolean | null
          freight_damage_notes: string | null
          freight_method: string | null
          high_demand_flagged: boolean | null
          id: string
          intellidealer_notes_added: boolean | null
          listing_photos: Json | null
          machinery_trader_listed: boolean | null
          pdi_checklist: Json | null
          pdi_completed: boolean | null
          pdi_signed_off_by: string | null
          photo_ready: boolean | null
          po_number: string | null
          pricing_verified: boolean | null
          qr_code_installed: boolean | null
          received_in_intellidealer: boolean | null
          ship_to_branch: string | null
          spare_parts_documented: boolean | null
          special_setup_documented: boolean | null
          stage_history: Json | null
          stock_number: string | null
          team_notified: boolean | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          arrival_date?: string | null
          arrival_photos?: Json | null
          attachments_mounted?: boolean | null
          barcode_exterior?: boolean | null
          barcode_interior?: boolean | null
          created_at?: string
          current_stage?: number
          decals_installed?: boolean | null
          demand_assessment?: string | null
          detail_contractor?: string | null
          detail_needed?: boolean | null
          detail_scheduled?: boolean | null
          equipment_id?: string | null
          equipment_trader_listed?: boolean | null
          estimated_arrival?: string | null
          facebook_listed?: boolean | null
          freight_damage_found?: boolean | null
          freight_damage_notes?: string | null
          freight_method?: string | null
          high_demand_flagged?: boolean | null
          id?: string
          intellidealer_notes_added?: boolean | null
          listing_photos?: Json | null
          machinery_trader_listed?: boolean | null
          pdi_checklist?: Json | null
          pdi_completed?: boolean | null
          pdi_signed_off_by?: string | null
          photo_ready?: boolean | null
          po_number?: string | null
          pricing_verified?: boolean | null
          qr_code_installed?: boolean | null
          received_in_intellidealer?: boolean | null
          ship_to_branch?: string | null
          spare_parts_documented?: boolean | null
          special_setup_documented?: boolean | null
          stage_history?: Json | null
          stock_number?: string | null
          team_notified?: boolean | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          arrival_date?: string | null
          arrival_photos?: Json | null
          attachments_mounted?: boolean | null
          barcode_exterior?: boolean | null
          barcode_interior?: boolean | null
          created_at?: string
          current_stage?: number
          decals_installed?: boolean | null
          demand_assessment?: string | null
          detail_contractor?: string | null
          detail_needed?: boolean | null
          detail_scheduled?: boolean | null
          equipment_id?: string | null
          equipment_trader_listed?: boolean | null
          estimated_arrival?: string | null
          facebook_listed?: boolean | null
          freight_damage_found?: boolean | null
          freight_damage_notes?: string | null
          freight_method?: string | null
          high_demand_flagged?: boolean | null
          id?: string
          intellidealer_notes_added?: boolean | null
          listing_photos?: Json | null
          machinery_trader_listed?: boolean | null
          pdi_checklist?: Json | null
          pdi_completed?: boolean | null
          pdi_signed_off_by?: string | null
          photo_ready?: boolean | null
          po_number?: string | null
          pricing_verified?: boolean | null
          qr_code_installed?: boolean | null
          received_in_intellidealer?: boolean | null
          ship_to_branch?: string | null
          spare_parts_documented?: boolean | null
          special_setup_documented?: boolean | null
          stage_history?: Json | null
          stock_number?: string | null
          team_notified?: boolean | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_intake_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_intake_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "equipment_intake_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_intake_pdi_signed_off_by_fkey"
            columns: ["pdi_signed_off_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_service_intervals: {
        Row: {
          created_at: string
          equipment_id: string
          id: string
          interval_hours: number
          interval_label: string
          last_completed_at: string | null
          last_completed_hours: number | null
          next_due_hours: number | null
          notes: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          equipment_id: string
          id?: string
          interval_hours: number
          interval_label: string
          last_completed_at?: string | null
          last_completed_hours?: number | null
          next_due_hours?: number | null
          notes?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          equipment_id?: string
          id?: string
          interval_hours?: number
          interval_label?: string
          last_completed_at?: string | null
          last_completed_hours?: number | null
          next_due_hours?: number | null
          notes?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_service_intervals_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_service_intervals_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "equipment_service_intervals_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      escalation_tickets: {
        Row: {
          assigned_to: string | null
          branch: string | null
          contact_id: string | null
          created_at: string
          deal_id: string | null
          department: string | null
          email_draft_content: string | null
          email_draft_subject: string | null
          email_drafted: boolean | null
          email_recipient: string | null
          escalated_by: string | null
          follow_up_task_created: boolean | null
          follow_up_task_id: string | null
          id: string
          issue_description: string
          resolution_notes: string | null
          resolved_at: string | null
          severity: string | null
          status: string
          touchpoint_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assigned_to?: string | null
          branch?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          department?: string | null
          email_draft_content?: string | null
          email_draft_subject?: string | null
          email_drafted?: boolean | null
          email_recipient?: string | null
          escalated_by?: string | null
          follow_up_task_created?: boolean | null
          follow_up_task_id?: string | null
          id?: string
          issue_description: string
          resolution_notes?: string | null
          resolved_at?: string | null
          severity?: string | null
          status?: string
          touchpoint_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          assigned_to?: string | null
          branch?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          department?: string | null
          email_draft_content?: string | null
          email_draft_subject?: string | null
          email_drafted?: boolean | null
          email_recipient?: string | null
          escalated_by?: string | null
          follow_up_task_created?: boolean | null
          follow_up_task_id?: string | null
          id?: string
          issue_description?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          severity?: string | null
          status?: string
          touchpoint_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "escalation_tickets_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_tickets_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_tickets_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_tickets_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_tickets_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_tickets_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_tickets_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_tickets_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_tickets_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "escalation_tickets_escalated_by_fkey"
            columns: ["escalated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_tickets_follow_up_task_id_fkey"
            columns: ["follow_up_task_id"]
            isOneToOne: false
            referencedRelation: "crm_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_tickets_follow_up_task_id_fkey"
            columns: ["follow_up_task_id"]
            isOneToOne: false
            referencedRelation: "qrm_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_tickets_touchpoint_id_fkey"
            columns: ["touchpoint_id"]
            isOneToOne: false
            referencedRelation: "follow_up_touchpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      exception_queue: {
        Row: {
          assigned_to: string | null
          created_at: string
          detail: string | null
          entity_id: string | null
          entity_table: string | null
          id: string
          payload: Json
          resolution_reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          source: string
          status: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          detail?: string | null
          entity_id?: string | null
          entity_table?: string | null
          id?: string
          payload?: Json
          resolution_reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source: string
          status?: string
          title: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          detail?: string | null
          entity_id?: string | null
          entity_table?: string | null
          id?: string
          payload?: Json
          resolution_reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source?: string
          status?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exception_queue_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exception_queue_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      exec_data_quality_summary: {
        Row: {
          description: string
          issue_class: string
          open_count: number
          severity: string
          suggested_action: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          description: string
          issue_class: string
          open_count?: number
          severity: string
          suggested_action?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          description?: string
          issue_class?: string
          open_count?: number
          severity?: string
          suggested_action?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      exec_packet_runs: {
        Row: {
          alerts_count: number
          delivered_at: string | null
          delivery_status: string | null
          delivery_target: string | null
          generated_at: string
          generated_by: string | null
          id: string
          metadata: Json
          metrics_count: number
          packet_json: Json
          packet_md: string
          period_end: string | null
          period_start: string | null
          role: string
          workspace_id: string
        }
        Insert: {
          alerts_count?: number
          delivered_at?: string | null
          delivery_status?: string | null
          delivery_target?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          metadata?: Json
          metrics_count?: number
          packet_json?: Json
          packet_md: string
          period_end?: string | null
          period_start?: string | null
          role: string
          workspace_id?: string
        }
        Update: {
          alerts_count?: number
          delivered_at?: string | null
          delivery_status?: string | null
          delivery_target?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          metadata?: Json
          metrics_count?: number
          packet_json?: Json
          packet_md?: string
          period_end?: string | null
          period_start?: string | null
          role?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exec_packet_runs_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      financing_rate_matrix: {
        Row: {
          created_at: string
          credit_tier: string
          dealer_holdback_pct: number | null
          effective_date: string | null
          entered_by: string | null
          expiry_date: string | null
          id: string
          is_active: boolean
          lender_name: string
          max_amount: number | null
          min_amount: number | null
          notes: string | null
          rate_pct: number
          term_months: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          credit_tier: string
          dealer_holdback_pct?: number | null
          effective_date?: string | null
          entered_by?: string | null
          expiry_date?: string | null
          id?: string
          is_active?: boolean
          lender_name: string
          max_amount?: number | null
          min_amount?: number | null
          notes?: string | null
          rate_pct: number
          term_months: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          credit_tier?: string
          dealer_holdback_pct?: number | null
          effective_date?: string | null
          entered_by?: string | null
          expiry_date?: string | null
          id?: string
          is_active?: boolean
          lender_name?: string
          max_amount?: number | null
          min_amount?: number | null
          notes?: string | null
          rate_pct?: number
          term_months?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financing_rate_matrix_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      flare_rate_limits: {
        Row: {
          count: number
          reporter_id: string
          window_start: string
        }
        Insert: {
          count?: number
          reporter_id: string
          window_start: string
        }
        Update: {
          count?: number
          reporter_id?: string
          window_start?: string
        }
        Relationships: []
      }
      flare_reports: {
        Row: {
          ai_confidence: number | null
          ai_severity_reasoning: string | null
          ai_severity_recommendation: string | null
          annotations: Json
          app_version: string | null
          assigned_to: string | null
          browser: string | null
          build_timestamp: string | null
          click_trail: Json
          console_errors: Json
          created_at: string
          deleted_at: string | null
          dispatch_errors: Json
          dom_snapshot_path: string | null
          duplicate_of: string | null
          exception_queue_id: string | null
          feature_flags: Json
          fix_deploy_sha: string | null
          fixed_at: string | null
          git_sha: string | null
          hypothesis_pattern: string | null
          id: string
          linear_issue_id: string | null
          linear_issue_url: string | null
          linked_voice_capture_id: string | null
          network_trail: Json
          network_type: string | null
          os: string | null
          page_title: string | null
          paperclip_issue_id: string | null
          paperclip_issue_url: string | null
          performance_metrics: Json | null
          react_query_cache_keys: Json
          recent_activity_id: string | null
          reporter_email: string | null
          reporter_id: string | null
          reporter_iron_role: string | null
          reporter_role: string | null
          reproducer_steps: string | null
          resolution_notes: string | null
          route: string | null
          route_trail: Json
          screenshot_path: string | null
          session_id: string | null
          severity: string
          slack_ts: string | null
          status: string
          store_snapshot: Json | null
          tab_id: string | null
          time_on_page_ms: number | null
          triaged_at: string | null
          triaged_by: string | null
          updated_at: string
          url: string
          user_description: string
          viewport: Json | null
          visible_entities: Json
          workspace_id: string
        }
        Insert: {
          ai_confidence?: number | null
          ai_severity_reasoning?: string | null
          ai_severity_recommendation?: string | null
          annotations?: Json
          app_version?: string | null
          assigned_to?: string | null
          browser?: string | null
          build_timestamp?: string | null
          click_trail?: Json
          console_errors?: Json
          created_at?: string
          deleted_at?: string | null
          dispatch_errors?: Json
          dom_snapshot_path?: string | null
          duplicate_of?: string | null
          exception_queue_id?: string | null
          feature_flags?: Json
          fix_deploy_sha?: string | null
          fixed_at?: string | null
          git_sha?: string | null
          hypothesis_pattern?: string | null
          id?: string
          linear_issue_id?: string | null
          linear_issue_url?: string | null
          linked_voice_capture_id?: string | null
          network_trail?: Json
          network_type?: string | null
          os?: string | null
          page_title?: string | null
          paperclip_issue_id?: string | null
          paperclip_issue_url?: string | null
          performance_metrics?: Json | null
          react_query_cache_keys?: Json
          recent_activity_id?: string | null
          reporter_email?: string | null
          reporter_id?: string | null
          reporter_iron_role?: string | null
          reporter_role?: string | null
          reproducer_steps?: string | null
          resolution_notes?: string | null
          route?: string | null
          route_trail?: Json
          screenshot_path?: string | null
          session_id?: string | null
          severity: string
          slack_ts?: string | null
          status?: string
          store_snapshot?: Json | null
          tab_id?: string | null
          time_on_page_ms?: number | null
          triaged_at?: string | null
          triaged_by?: string | null
          updated_at?: string
          url: string
          user_description: string
          viewport?: Json | null
          visible_entities?: Json
          workspace_id?: string
        }
        Update: {
          ai_confidence?: number | null
          ai_severity_reasoning?: string | null
          ai_severity_recommendation?: string | null
          annotations?: Json
          app_version?: string | null
          assigned_to?: string | null
          browser?: string | null
          build_timestamp?: string | null
          click_trail?: Json
          console_errors?: Json
          created_at?: string
          deleted_at?: string | null
          dispatch_errors?: Json
          dom_snapshot_path?: string | null
          duplicate_of?: string | null
          exception_queue_id?: string | null
          feature_flags?: Json
          fix_deploy_sha?: string | null
          fixed_at?: string | null
          git_sha?: string | null
          hypothesis_pattern?: string | null
          id?: string
          linear_issue_id?: string | null
          linear_issue_url?: string | null
          linked_voice_capture_id?: string | null
          network_trail?: Json
          network_type?: string | null
          os?: string | null
          page_title?: string | null
          paperclip_issue_id?: string | null
          paperclip_issue_url?: string | null
          performance_metrics?: Json | null
          react_query_cache_keys?: Json
          recent_activity_id?: string | null
          reporter_email?: string | null
          reporter_id?: string | null
          reporter_iron_role?: string | null
          reporter_role?: string | null
          reproducer_steps?: string | null
          resolution_notes?: string | null
          route?: string | null
          route_trail?: Json
          screenshot_path?: string | null
          session_id?: string | null
          severity?: string
          slack_ts?: string | null
          status?: string
          store_snapshot?: Json | null
          tab_id?: string | null
          time_on_page_ms?: number | null
          triaged_at?: string | null
          triaged_by?: string | null
          updated_at?: string
          url?: string
          user_description?: string
          viewport?: Json | null
          visible_entities?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flare_reports_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flare_reports_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "flare_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flare_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flare_reports_triaged_by_fkey"
            columns: ["triaged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_import_history: {
        Row: {
          created_at: string
          error_log: Json | null
          id: string
          import_type: string
          imported_by: string | null
          records_failed: number
          records_imported: number
          records_updated: number
        }
        Insert: {
          created_at?: string
          error_log?: Json | null
          id?: string
          import_type: string
          imported_by?: string | null
          records_failed?: number
          records_imported?: number
          records_updated?: number
        }
        Update: {
          created_at?: string
          error_log?: Json | null
          id?: string
          import_type?: string
          imported_by?: string | null
          records_failed?: number
          records_imported?: number
          records_updated?: number
        }
        Relationships: [
          {
            foreignKeyName: "fleet_import_history_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_intelligence: {
        Row: {
          created_at: string
          current_hours: number | null
          customer_name: string
          customer_profile_id: string | null
          equipment_serial: string | null
          id: string
          last_service_date: string | null
          last_service_hours: number | null
          make: string
          metadata: Json | null
          model: string
          outreach_deal_value: number | null
          outreach_status: Database["public"]["Enums"]["outreach_status"] | null
          predicted_replacement_date: string | null
          replacement_confidence: number | null
          replacement_model_version: string | null
          telematics_source: string | null
          updated_at: string
          utilization_trend: string | null
          year: number | null
        }
        Insert: {
          created_at?: string
          current_hours?: number | null
          customer_name: string
          customer_profile_id?: string | null
          equipment_serial?: string | null
          id?: string
          last_service_date?: string | null
          last_service_hours?: number | null
          make: string
          metadata?: Json | null
          model: string
          outreach_deal_value?: number | null
          outreach_status?:
            | Database["public"]["Enums"]["outreach_status"]
            | null
          predicted_replacement_date?: string | null
          replacement_confidence?: number | null
          replacement_model_version?: string | null
          telematics_source?: string | null
          updated_at?: string
          utilization_trend?: string | null
          year?: number | null
        }
        Update: {
          created_at?: string
          current_hours?: number | null
          customer_name?: string
          customer_profile_id?: string | null
          equipment_serial?: string | null
          id?: string
          last_service_date?: string | null
          last_service_hours?: number | null
          make?: string
          metadata?: Json | null
          model?: string
          outreach_deal_value?: number | null
          outreach_status?:
            | Database["public"]["Enums"]["outreach_status"]
            | null
          predicted_replacement_date?: string | null
          replacement_confidence?: number | null
          replacement_model_version?: string | null
          telematics_source?: string | null
          updated_at?: string
          utilization_trend?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fleet_intelligence_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "customer_profiles_extended"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_intelligence_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "exec_health_movers"
            referencedColumns: ["customer_profile_id"]
          },
        ]
      }
      flow_action_idempotency: {
        Row: {
          action_key: string
          created_at: string
          expires_at: string
          idempotency_key: string
          result: Json | null
          run_id: string | null
          workspace_id: string
        }
        Insert: {
          action_key: string
          created_at?: string
          expires_at?: string
          idempotency_key: string
          result?: Json | null
          run_id?: string | null
          workspace_id: string
        }
        Update: {
          action_key?: string
          created_at?: string
          expires_at?: string
          idempotency_key?: string
          result?: Json | null
          run_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_action_idempotency_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "flow_workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_approvals: {
        Row: {
          assigned_role: string | null
          assigned_to: string | null
          context_summary: Json
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          detail: string | null
          due_at: string | null
          escalate_at: string | null
          id: string
          reminder_sent_at: string | null
          requested_at: string
          requested_by_role: string | null
          run_id: string
          status: string
          step_id: string | null
          subject: string
          updated_at: string
          workflow_slug: string
          workspace_id: string
        }
        Insert: {
          assigned_role?: string | null
          assigned_to?: string | null
          context_summary?: Json
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          detail?: string | null
          due_at?: string | null
          escalate_at?: string | null
          id?: string
          reminder_sent_at?: string | null
          requested_at?: string
          requested_by_role?: string | null
          run_id: string
          status?: string
          step_id?: string | null
          subject: string
          updated_at?: string
          workflow_slug: string
          workspace_id?: string
        }
        Update: {
          assigned_role?: string | null
          assigned_to?: string | null
          context_summary?: Json
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          detail?: string | null
          due_at?: string | null
          escalate_at?: string | null
          id?: string
          reminder_sent_at?: string | null
          requested_at?: string
          requested_by_role?: string | null
          run_id?: string
          status?: string
          step_id?: string | null
          subject?: string
          updated_at?: string
          workflow_slug?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_approvals_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_approvals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_approvals_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "flow_workflow_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_approvals_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "flow_workflow_run_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_event_types: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          schema: Json | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          schema?: Json | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          schema?: Json | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      flow_events: {
        Row: {
          commercial_relevance: string | null
          company_id: string | null
          correlation_id: string | null
          created_at: string
          customer_id: string | null
          deal_id: string | null
          draft_message: string | null
          equipment_id: string | null
          escalation_rule: string | null
          event_id: string
          event_type: string
          id: string
          idempotency_key: string | null
          parent_event_id: string | null
          payload: Json
          published_at: string
          recommended_deadline: string | null
          required_action: string | null
          severity: string | null
          source_module: string
          source_record_id: string | null
          status: string
          suggested_owner: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          commercial_relevance?: string | null
          company_id?: string | null
          correlation_id?: string | null
          created_at?: string
          customer_id?: string | null
          deal_id?: string | null
          draft_message?: string | null
          equipment_id?: string | null
          escalation_rule?: string | null
          event_id?: string
          event_type: string
          id?: string
          idempotency_key?: string | null
          parent_event_id?: string | null
          payload?: Json
          published_at?: string
          recommended_deadline?: string | null
          required_action?: string | null
          severity?: string | null
          source_module: string
          source_record_id?: string | null
          status?: string
          suggested_owner?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          commercial_relevance?: string | null
          company_id?: string | null
          correlation_id?: string | null
          created_at?: string
          customer_id?: string | null
          deal_id?: string | null
          draft_message?: string | null
          equipment_id?: string | null
          escalation_rule?: string | null
          event_id?: string
          event_type?: string
          id?: string
          idempotency_key?: string | null
          parent_event_id?: string | null
          payload?: Json
          published_at?: string
          recommended_deadline?: string | null
          required_action?: string | null
          severity?: string | null
          source_module?: string
          source_record_id?: string | null
          status?: string
          suggested_owner?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_events_suggested_owner_fkey"
            columns: ["suggested_owner"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_subscriptions: {
        Row: {
          created_at: string
          enabled: boolean
          event_type_pattern: string
          handler_module: string
          handler_name: string
          id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          event_type_pattern: string
          handler_module: string
          handler_name: string
          id?: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          event_type_pattern?: string
          handler_module?: string
          handler_name?: string
          id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      flow_workflow_definitions: {
        Row: {
          action_chain: Json
          affects_modules: Json
          condition_dsl: Json
          created_at: string
          definition_hash: string | null
          description: string | null
          dry_run: boolean
          enabled: boolean
          feature_flag: string | null
          high_value_threshold_cents: number | null
          id: string
          iron_metadata: Json | null
          name: string
          owner_role: string
          retry_policy: Json
          roles_allowed: string[] | null
          run_cadence_seconds: number
          slug: string
          surface: string
          trigger_event_pattern: string
          undo_handler: string | null
          undo_semantic_rule: string | null
          updated_at: string
          version: number
          workspace_id: string
        }
        Insert: {
          action_chain?: Json
          affects_modules?: Json
          condition_dsl?: Json
          created_at?: string
          definition_hash?: string | null
          description?: string | null
          dry_run?: boolean
          enabled?: boolean
          feature_flag?: string | null
          high_value_threshold_cents?: number | null
          id?: string
          iron_metadata?: Json | null
          name: string
          owner_role?: string
          retry_policy?: Json
          roles_allowed?: string[] | null
          run_cadence_seconds?: number
          slug: string
          surface?: string
          trigger_event_pattern: string
          undo_handler?: string | null
          undo_semantic_rule?: string | null
          updated_at?: string
          version?: number
          workspace_id?: string
        }
        Update: {
          action_chain?: Json
          affects_modules?: Json
          condition_dsl?: Json
          created_at?: string
          definition_hash?: string | null
          description?: string | null
          dry_run?: boolean
          enabled?: boolean
          feature_flag?: string | null
          high_value_threshold_cents?: number | null
          id?: string
          iron_metadata?: Json | null
          name?: string
          owner_role?: string
          retry_policy?: Json
          roles_allowed?: string[] | null
          run_cadence_seconds?: number
          slug?: string
          surface?: string
          trigger_event_pattern?: string
          undo_handler?: string | null
          undo_semantic_rule?: string | null
          updated_at?: string
          version?: number
          workspace_id?: string
        }
        Relationships: []
      }
      flow_workflow_run_steps: {
        Row: {
          action_key: string | null
          error_text: string | null
          finished_at: string | null
          id: string
          idempotency_key: string | null
          params: Json | null
          result: Json | null
          run_id: string
          started_at: string
          status: string
          step_index: number
          step_type: string
        }
        Insert: {
          action_key?: string | null
          error_text?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          params?: Json | null
          result?: Json | null
          run_id: string
          started_at?: string
          status?: string
          step_index: number
          step_type: string
        }
        Update: {
          action_key?: string | null
          error_text?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          params?: Json | null
          result?: Json | null
          run_id?: string
          started_at?: string
          status?: string
          step_index?: number
          step_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_workflow_run_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "flow_workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_workflow_runs: {
        Row: {
          attempt: number
          attributed_user_id: string | null
          conversation_id: string | null
          created_at: string
          dead_letter_id: string | null
          dry_run: boolean
          duration_ms: number | null
          error_text: string | null
          event_id: string | null
          finished_at: string | null
          id: string
          idempotency_key: string | null
          metadata: Json
          resolved_context: Json | null
          started_at: string
          status: string
          surface: string | null
          undo_deadline: string | null
          undone_at: string | null
          undone_by: string | null
          workflow_id: string
          workflow_slug: string
          workspace_id: string
        }
        Insert: {
          attempt?: number
          attributed_user_id?: string | null
          conversation_id?: string | null
          created_at?: string
          dead_letter_id?: string | null
          dry_run?: boolean
          duration_ms?: number | null
          error_text?: string | null
          event_id?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          resolved_context?: Json | null
          started_at?: string
          status?: string
          surface?: string | null
          undo_deadline?: string | null
          undone_at?: string | null
          undone_by?: string | null
          workflow_id: string
          workflow_slug: string
          workspace_id?: string
        }
        Update: {
          attempt?: number
          attributed_user_id?: string | null
          conversation_id?: string | null
          created_at?: string
          dead_letter_id?: string | null
          dry_run?: boolean
          duration_ms?: number | null
          error_text?: string | null
          event_id?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          resolved_context?: Json | null
          started_at?: string
          status?: string
          surface?: string | null
          undo_deadline?: string | null
          undone_at?: string | null
          undone_by?: string | null
          workflow_id?: string
          workflow_slug?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_workflow_runs_dead_letter_id_fkey"
            columns: ["dead_letter_id"]
            isOneToOne: false
            referencedRelation: "exception_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_workflow_runs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "analytics_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "flow_workflow_runs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "flow_pending_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "flow_workflow_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "flow_workflow_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_up_cadences: {
        Row: {
          assigned_to: string | null
          cadence_type: string
          contact_id: string | null
          created_at: string
          deal_id: string
          id: string
          started_at: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assigned_to?: string | null
          cadence_type: string
          contact_id?: string | null
          created_at?: string
          deal_id: string
          id?: string
          started_at?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          assigned_to?: string | null
          cadence_type?: string
          contact_id?: string | null
          created_at?: string
          deal_id?: string
          id?: string
          started_at?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_cadences_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_cadences_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_cadences_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_cadences_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_cadences_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_cadences_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_cadences_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_cadences_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_cadences_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      follow_up_sequences: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          trigger_stage: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          trigger_stage?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          trigger_stage?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_sequences_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_up_steps: {
        Row: {
          body_template: string | null
          created_at: string
          day_offset: number
          id: string
          sequence_id: string
          step_number: number
          step_type: Database["public"]["Enums"]["followup_step_type"]
          subject: string | null
          task_priority: string | null
        }
        Insert: {
          body_template?: string | null
          created_at?: string
          day_offset: number
          id?: string
          sequence_id: string
          step_number: number
          step_type: Database["public"]["Enums"]["followup_step_type"]
          subject?: string | null
          task_priority?: string | null
        }
        Update: {
          body_template?: string | null
          created_at?: string
          day_offset?: number
          id?: string
          sequence_id?: string
          step_number?: number
          step_type?: Database["public"]["Enums"]["followup_step_type"]
          subject?: string | null
          task_priority?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_steps_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "follow_up_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_up_touchpoints: {
        Row: {
          cadence_id: string
          completed_at: string | null
          completed_by: string | null
          completion_notes: string | null
          content_context: Json | null
          content_generated_at: string | null
          created_at: string
          delivery_method: string | null
          id: string
          purpose: string
          scheduled_date: string
          status: string
          suggested_message: string | null
          touchpoint_type: string
          updated_at: string
          value_type: string | null
        }
        Insert: {
          cadence_id: string
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          content_context?: Json | null
          content_generated_at?: string | null
          created_at?: string
          delivery_method?: string | null
          id?: string
          purpose: string
          scheduled_date: string
          status?: string
          suggested_message?: string | null
          touchpoint_type: string
          updated_at?: string
          value_type?: string | null
        }
        Update: {
          cadence_id?: string
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          content_context?: Json | null
          content_generated_at?: string | null
          created_at?: string
          delivery_method?: string | null
          id?: string
          purpose?: string
          scheduled_date?: string
          status?: string
          suggested_message?: string | null
          touchpoint_type?: string
          updated_at?: string
          value_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_touchpoints_cadence_id_fkey"
            columns: ["cadence_id"]
            isOneToOne: false
            referencedRelation: "follow_up_cadences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_touchpoints_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      geofence_events: {
        Row: {
          ai_confidence: number | null
          created_at: string
          equipment_id: string
          event_at: string
          event_type: string
          geofence_id: string
          id: string
          reading_lat: number | null
          reading_lng: number | null
          triggered_action_id: string | null
          workspace_id: string
        }
        Insert: {
          ai_confidence?: number | null
          created_at?: string
          equipment_id: string
          event_at?: string
          event_type: string
          geofence_id: string
          id?: string
          reading_lat?: number | null
          reading_lng?: number | null
          triggered_action_id?: string | null
          workspace_id?: string
        }
        Update: {
          ai_confidence?: number | null
          created_at?: string
          equipment_id?: string
          event_at?: string
          event_type?: string
          geofence_id?: string
          id?: string
          reading_lat?: number | null
          reading_lng?: number | null
          triggered_action_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "geofence_events_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geofence_events_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "geofence_events_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geofence_events_geofence_id_fkey"
            columns: ["geofence_id"]
            isOneToOne: false
            referencedRelation: "crm_geofences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geofence_events_geofence_id_fkey"
            columns: ["geofence_id"]
            isOneToOne: false
            referencedRelation: "qrm_geofences"
            referencedColumns: ["id"]
          },
        ]
      }
      gl_routing_rules: {
        Row: {
          created_at: string
          description: string | null
          equipment_status: string | null
          gl_code: string
          gl_name: string
          gl_number: string | null
          has_ldw: boolean | null
          id: string
          is_customer_damage: boolean | null
          is_event_related: boolean | null
          is_sales_truck: boolean | null
          requires_ownership_approval: boolean | null
          ticket_type: string | null
          truck_numbers: string[] | null
          usage_examples: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          equipment_status?: string | null
          gl_code: string
          gl_name: string
          gl_number?: string | null
          has_ldw?: boolean | null
          id?: string
          is_customer_damage?: boolean | null
          is_event_related?: boolean | null
          is_sales_truck?: boolean | null
          requires_ownership_approval?: boolean | null
          ticket_type?: string | null
          truck_numbers?: string[] | null
          usage_examples?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          equipment_status?: string | null
          gl_code?: string
          gl_name?: string
          gl_number?: string | null
          has_ldw?: boolean | null
          id?: string
          is_customer_damage?: boolean | null
          is_event_related?: boolean | null
          is_sales_truck?: boolean | null
          requires_ownership_approval?: boolean | null
          ticket_type?: string | null
          truck_numbers?: string[] | null
          usage_examples?: string | null
        }
        Relationships: []
      }
      handoff_events: {
        Row: {
          composite_score: number | null
          created_at: string
          evidence: Json
          from_iron_role: string
          from_user_id: string
          handoff_at: string
          handoff_reason: string | null
          id: string
          info_completeness: number | null
          outcome: string | null
          outcome_alignment: number | null
          recipient_readiness: number | null
          scored_at: string | null
          source_event_id: string | null
          source_fingerprint: string | null
          source_status_from: string | null
          source_status_to: string | null
          source_table: string | null
          subject_id: string
          subject_label: string | null
          subject_type: string
          to_iron_role: string
          to_user_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          composite_score?: number | null
          created_at?: string
          evidence?: Json
          from_iron_role: string
          from_user_id: string
          handoff_at?: string
          handoff_reason?: string | null
          id?: string
          info_completeness?: number | null
          outcome?: string | null
          outcome_alignment?: number | null
          recipient_readiness?: number | null
          scored_at?: string | null
          source_event_id?: string | null
          source_fingerprint?: string | null
          source_status_from?: string | null
          source_status_to?: string | null
          source_table?: string | null
          subject_id: string
          subject_label?: string | null
          subject_type: string
          to_iron_role: string
          to_user_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          composite_score?: number | null
          created_at?: string
          evidence?: Json
          from_iron_role?: string
          from_user_id?: string
          handoff_at?: string
          handoff_reason?: string | null
          id?: string
          info_completeness?: number | null
          outcome?: string | null
          outcome_alignment?: number | null
          recipient_readiness?: number | null
          scored_at?: string | null
          source_event_id?: string | null
          source_fingerprint?: string | null
          source_status_from?: string | null
          source_status_to?: string | null
          source_table?: string | null
          subject_id?: string
          subject_label?: string | null
          subject_type?: string
          to_iron_role?: string
          to_user_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "handoff_events_from_user_id_fkey"
            columns: ["from_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handoff_events_to_user_id_fkey"
            columns: ["to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      handoff_role_seam_scores: {
        Row: {
          avg_composite: number | null
          avg_info_completeness: number | null
          avg_outcome_alignment: number | null
          avg_recipient_readiness: number | null
          created_at: string
          degraded_pct: number | null
          from_iron_role: string
          handoff_count: number
          id: string
          improved_pct: number | null
          period_end: string
          period_start: string
          scored_count: number
          to_iron_role: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          avg_composite?: number | null
          avg_info_completeness?: number | null
          avg_outcome_alignment?: number | null
          avg_recipient_readiness?: number | null
          created_at?: string
          degraded_pct?: number | null
          from_iron_role: string
          handoff_count?: number
          id?: string
          improved_pct?: number | null
          period_end: string
          period_start: string
          scored_count?: number
          to_iron_role: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          avg_composite?: number | null
          avg_info_completeness?: number | null
          avg_outcome_alignment?: number | null
          avg_recipient_readiness?: number | null
          created_at?: string
          degraded_pct?: number | null
          from_iron_role?: string
          handoff_count?: number
          id?: string
          improved_pct?: number | null
          period_end?: string
          period_start?: string
          scored_count?: number
          to_iron_role?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      health_score_history: {
        Row: {
          components: Json
          customer_profile_id: string
          id: string
          score: number
          snapshot_at: string
          workspace_id: string
        }
        Insert: {
          components?: Json
          customer_profile_id: string
          id?: string
          score: number
          snapshot_at?: string
          workspace_id?: string
        }
        Update: {
          components?: Json
          customer_profile_id?: string
          id?: string
          score?: number
          snapshot_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "health_score_history_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "customer_profiles_extended"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_score_history_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "exec_health_movers"
            referencedColumns: ["customer_profile_id"]
          },
        ]
      }
      hubspot_connections: {
        Row: {
          access_token: string
          created_at: string
          hub_domain: string | null
          hub_id: string
          id: string
          is_active: boolean
          refresh_token: string
          scopes: string[] | null
          token_expires_at: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          access_token: string
          created_at?: string
          hub_domain?: string | null
          hub_id: string
          id?: string
          is_active?: boolean
          refresh_token: string
          scopes?: string[] | null
          token_expires_at: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          access_token?: string
          created_at?: string
          hub_domain?: string | null
          hub_id?: string
          id?: string
          is_active?: boolean
          refresh_token?: string
          scopes?: string[] | null
          token_expires_at?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hubspot_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hubspot_webhook_receipts: {
        Row: {
          created_at: string
          error: string | null
          hub_id: string
          id: string
          payload_hash: string | null
          processing_status: string
          receipt_key: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          hub_id: string
          id?: string
          payload_hash?: string | null
          processing_status?: string
          receipt_key: string
        }
        Update: {
          created_at?: string
          error?: string | null
          hub_id?: string
          id?: string
          payload_hash?: string | null
          processing_status?: string
          receipt_key?: string
        }
        Relationships: []
      }
      integration_status: {
        Row: {
          auth_type: string | null
          config: Json | null
          created_at: string
          credentials_encrypted: string | null
          display_name: string
          endpoint_url: string | null
          id: string
          integration_key: string
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_records: number | null
          last_test_at: string | null
          last_test_error: string | null
          last_test_latency_ms: number | null
          last_test_success: boolean | null
          status: Database["public"]["Enums"]["integration_status_enum"]
          sync_frequency: Database["public"]["Enums"]["sync_frequency"] | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          auth_type?: string | null
          config?: Json | null
          created_at?: string
          credentials_encrypted?: string | null
          display_name: string
          endpoint_url?: string | null
          id?: string
          integration_key: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_records?: number | null
          last_test_at?: string | null
          last_test_error?: string | null
          last_test_latency_ms?: number | null
          last_test_success?: boolean | null
          status?: Database["public"]["Enums"]["integration_status_enum"]
          sync_frequency?: Database["public"]["Enums"]["sync_frequency"] | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          auth_type?: string | null
          config?: Json | null
          created_at?: string
          credentials_encrypted?: string | null
          display_name?: string
          endpoint_url?: string | null
          id?: string
          integration_key?: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_records?: number | null
          last_test_at?: string | null
          last_test_error?: string | null
          last_test_latency_ms?: number | null
          last_test_success?: boolean | null
          status?: Database["public"]["Enums"]["integration_status_enum"]
          sync_frequency?: Database["public"]["Enums"]["sync_frequency"] | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      integration_status_credential_audit_events: {
        Row: {
          actor_role: string | null
          actor_user_id: string | null
          changed_fields: string[]
          event_type: string
          id: string
          integration_key: string
          metadata: Json
          occurred_at: string
          request_id: string | null
          workspace_id: string
        }
        Insert: {
          actor_role?: string | null
          actor_user_id?: string | null
          changed_fields?: string[]
          event_type: string
          id?: string
          integration_key: string
          metadata?: Json
          occurred_at?: string
          request_id?: string | null
          workspace_id?: string
        }
        Update: {
          actor_role?: string | null
          actor_user_id?: string | null
          changed_fields?: string[]
          event_type?: string
          id?: string
          integration_key?: string
          metadata?: Json
          occurred_at?: string
          request_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_status_credential_audit_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_status_credential_audit_events_workspace_key_fkey"
            columns: ["workspace_id", "integration_key"]
            isOneToOne: false
            referencedRelation: "integration_status"
            referencedColumns: ["workspace_id", "integration_key"]
          },
        ]
      }
      intervention_memory: {
        Row: {
          alert_severity: string
          alert_title_pattern: string
          alert_type: string
          created_at: string
          id: string
          last_recurred_at: string | null
          recurrence_count: number
          resolution_notes: string | null
          resolution_type: string
          resolved_at: string
          resolved_by: string | null
          time_to_resolve_minutes: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          alert_severity: string
          alert_title_pattern: string
          alert_type: string
          created_at?: string
          id?: string
          last_recurred_at?: string | null
          recurrence_count?: number
          resolution_notes?: string | null
          resolution_type: string
          resolved_at?: string
          resolved_by?: string | null
          time_to_resolve_minutes?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          alert_severity?: string
          alert_title_pattern?: string
          alert_type?: string
          created_at?: string
          id?: string
          last_recurred_at?: string | null
          recurrence_count?: number
          resolution_notes?: string | null
          resolution_type?: string
          resolved_at?: string
          resolved_by?: string | null
          time_to_resolve_minutes?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intervention_memory_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_event_triggers: {
        Row: {
          auto_create_campaign: boolean | null
          campaign_template_id: string | null
          created_at: string
          equipment_filter: Json | null
          event_type: string
          id: string
          is_active: boolean
          last_triggered_at: string | null
          target_segment: Json | null
          trigger_count: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          auto_create_campaign?: boolean | null
          campaign_template_id?: string | null
          created_at?: string
          equipment_filter?: Json | null
          event_type: string
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          target_segment?: Json | null
          trigger_count?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          auto_create_campaign?: boolean | null
          campaign_template_id?: string | null
          created_at?: string
          equipment_filter?: Json | null
          event_type?: string
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          target_segment?: Json | null
          trigger_count?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_event_triggers_campaign_template_id_fkey"
            columns: ["campaign_template_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      iron_conversations: {
        Row: {
          created_at: string
          ended_at: string | null
          id: string
          input_mode: string
          metadata: Json
          route_at_start: string | null
          started_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          id?: string
          input_mode?: string
          metadata?: Json
          route_at_start?: string | null
          started_at?: string
          user_id: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          id?: string
          input_mode?: string
          metadata?: Json
          route_at_start?: string | null
          started_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: []
      }
      iron_flow_suggestions: {
        Row: {
          created_at: string
          dismissed_at: string | null
          dismissed_by: string | null
          dismissed_reason: string | null
          first_seen_at: string | null
          id: string
          intent_examples: Json
          last_seen_at: string | null
          occurrence_count: number
          pattern_signature: string
          promoted_at: string | null
          promoted_by: string | null
          promoted_flow_id: string | null
          short_label: string | null
          snoozed_until: string | null
          status: string
          suggested_flow_slug: string | null
          unique_users: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          dismissed_at?: string | null
          dismissed_by?: string | null
          dismissed_reason?: string | null
          first_seen_at?: string | null
          id?: string
          intent_examples?: Json
          last_seen_at?: string | null
          occurrence_count?: number
          pattern_signature: string
          promoted_at?: string | null
          promoted_by?: string | null
          promoted_flow_id?: string | null
          short_label?: string | null
          snoozed_until?: string | null
          status?: string
          suggested_flow_slug?: string | null
          unique_users?: number
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          dismissed_at?: string | null
          dismissed_by?: string | null
          dismissed_reason?: string | null
          first_seen_at?: string | null
          id?: string
          intent_examples?: Json
          last_seen_at?: string | null
          occurrence_count?: number
          pattern_signature?: string
          promoted_at?: string | null
          promoted_by?: string | null
          promoted_flow_id?: string | null
          short_label?: string | null
          snoozed_until?: string | null
          status?: string
          suggested_flow_slug?: string | null
          unique_users?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "iron_flow_suggestions_promoted_flow_id_fkey"
            columns: ["promoted_flow_id"]
            isOneToOne: false
            referencedRelation: "flow_workflow_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      iron_handoffs: {
        Row: {
          assigned_to: string | null
          brief: string
          context: Json
          conversation_id: string
          created_at: string
          id: string
          result: Json | null
          sentry_trace_id: string | null
          status: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          assigned_to?: string | null
          brief: string
          context?: Json
          conversation_id: string
          created_at?: string
          id?: string
          result?: Json | null
          sentry_trace_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
          workspace_id?: string
        }
        Update: {
          assigned_to?: string | null
          brief?: string
          context?: Json
          conversation_id?: string
          created_at?: string
          id?: string
          result?: Json | null
          sentry_trace_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "iron_handoffs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "iron_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      iron_memory: {
        Row: {
          access_count: number
          entity_id: string
          entity_type: string
          first_seen_at: string
          last_accessed_at: string
          last_action_type: string
          relevance_score: number
          user_id: string
          workspace_id: string
        }
        Insert: {
          access_count?: number
          entity_id: string
          entity_type: string
          first_seen_at?: string
          last_accessed_at?: string
          last_action_type?: string
          relevance_score?: number
          user_id: string
          workspace_id?: string
        }
        Update: {
          access_count?: number
          entity_id?: string
          entity_type?: string
          first_seen_at?: string
          last_accessed_at?: string
          last_action_type?: string
          relevance_score?: number
          user_id?: string
          workspace_id?: string
        }
        Relationships: []
      }
      iron_messages: {
        Row: {
          classifier_output: Json | null
          content: string
          conversation_id: string
          created_at: string
          flow_run_id: string | null
          id: string
          latency_ms: number | null
          model: string | null
          role: string
          tokens_in: number | null
          tokens_out: number | null
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          classifier_output?: Json | null
          content: string
          conversation_id: string
          created_at?: string
          flow_run_id?: string | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          role: string
          tokens_in?: number | null
          tokens_out?: number | null
          user_id?: string | null
          workspace_id?: string
        }
        Update: {
          classifier_output?: Json | null
          content?: string
          conversation_id?: string
          created_at?: string
          flow_run_id?: string | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          role?: string
          tokens_in?: number | null
          tokens_out?: number | null
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "iron_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "iron_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iron_messages_flow_run_id_fkey"
            columns: ["flow_run_id"]
            isOneToOne: false
            referencedRelation: "flow_workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      iron_oem_doc_cache: {
        Row: {
          content: string
          doc_type: string
          expires_at: string
          fetched_at: string
          id: string
          model: string
          oem: string
          source_url: string
          title: string
          workspace_id: string
        }
        Insert: {
          content: string
          doc_type: string
          expires_at?: string
          fetched_at?: string
          id?: string
          model: string
          oem: string
          source_url: string
          title: string
          workspace_id?: string
        }
        Update: {
          content?: string
          doc_type?: string
          expires_at?: string
          fetched_at?: string
          id?: string
          model?: string
          oem?: string
          source_url?: string
          title?: string
          workspace_id?: string
        }
        Relationships: []
      }
      iron_redteam_history: {
        Row: {
          attack_id: string
          attack_string: string
          classifier_category: string | null
          flow_id_returned: string | null
          id: number
          notes: string | null
          ran_at: string
          was_caught: boolean
        }
        Insert: {
          attack_id: string
          attack_string: string
          classifier_category?: string | null
          flow_id_returned?: string | null
          id?: number
          notes?: string | null
          ran_at?: string
          was_caught: boolean
        }
        Update: {
          attack_id?: string
          attack_string?: string
          classifier_category?: string | null
          flow_id_returned?: string | null
          id?: number
          notes?: string | null
          ran_at?: string
          was_caught?: boolean
        }
        Relationships: []
      }
      iron_settings: {
        Row: {
          avatar_corner: string
          created_at: string
          first_run_completed: boolean
          iron_role: string
          pinned_flows: string[]
          sandbox_mode: boolean
          updated_at: string
          user_id: string
          voice_enabled: boolean
          workspace_id: string
        }
        Insert: {
          avatar_corner?: string
          created_at?: string
          first_run_completed?: boolean
          iron_role?: string
          pinned_flows?: string[]
          sandbox_mode?: boolean
          updated_at?: string
          user_id: string
          voice_enabled?: boolean
          workspace_id?: string
        }
        Update: {
          avatar_corner?: string
          created_at?: string
          first_run_completed?: boolean
          iron_role?: string
          pinned_flows?: string[]
          sandbox_mode?: boolean
          updated_at?: string
          user_id?: string
          voice_enabled?: boolean
          workspace_id?: string
        }
        Relationships: []
      }
      iron_slo_history: {
        Row: {
          computed_at: string
          id: string
          snapshot: Json
          workspace_id: string
        }
        Insert: {
          computed_at?: string
          id?: string
          snapshot: Json
          workspace_id?: string
        }
        Update: {
          computed_at?: string
          id?: string
          snapshot?: Json
          workspace_id?: string
        }
        Relationships: []
      }
      iron_usage_counters: {
        Row: {
          bucket_date: string
          classifications: number
          cost_usd_micro: number
          degradation_state: string
          flow_executes: number
          tokens_in: number
          tokens_out: number
          user_id: string
          workspace_id: string
        }
        Insert: {
          bucket_date?: string
          classifications?: number
          cost_usd_micro?: number
          degradation_state?: string
          flow_executes?: number
          tokens_in?: number
          tokens_out?: number
          user_id: string
          workspace_id?: string
        }
        Update: {
          bucket_date?: string
          classifications?: number
          cost_usd_micro?: number
          degradation_state?: string
          flow_executes?: number
          tokens_in?: number
          tokens_out?: number
          user_id?: string
          workspace_id?: string
        }
        Relationships: []
      }
      iron_web_search_cache: {
        Row: {
          created_at: string
          id: string
          query_hash: string
          query_text: string
          results: Json
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          query_hash: string
          query_text: string
          results?: Json
          workspace_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          query_hash?: string
          query_text?: string
          results?: Json
          workspace_id?: string
        }
        Relationships: []
      }
      job_code_observations: {
        Row: {
          actual_hours: number | null
          created_at: string
          discovered_add_ons: Json
          estimated_hours: number | null
          id: string
          job_code_id: string
          job_id: string
          notes: string | null
          parts_consumed: Json
          parts_quoted: Json
          technician_id: string | null
          workspace_id: string
        }
        Insert: {
          actual_hours?: number | null
          created_at?: string
          discovered_add_ons?: Json
          estimated_hours?: number | null
          id?: string
          job_code_id: string
          job_id: string
          notes?: string | null
          parts_consumed?: Json
          parts_quoted?: Json
          technician_id?: string | null
          workspace_id?: string
        }
        Update: {
          actual_hours?: number | null
          created_at?: string
          discovered_add_ons?: Json
          estimated_hours?: number | null
          id?: string
          job_code_id?: string
          job_id?: string
          notes?: string | null
          parts_consumed?: Json
          parts_quoted?: Json
          technician_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_code_observations_job_code_id_fkey"
            columns: ["job_code_id"]
            isOneToOne: false
            referencedRelation: "job_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_code_observations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_code_observations_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_code_template_suggestions: {
        Row: {
          created_at: string
          id: string
          job_code_id: string
          observation_count: number
          review_status: string
          suggested_common_add_ons: Json
          suggested_parts_template: Json
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_code_id: string
          observation_count?: number
          review_status?: string
          suggested_common_add_ons?: Json
          suggested_parts_template?: Json
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          job_code_id?: string
          observation_count?: number
          review_status?: string
          suggested_common_add_ons?: Json
          suggested_parts_template?: Json
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_code_template_suggestions_job_code_id_fkey"
            columns: ["job_code_id"]
            isOneToOne: false
            referencedRelation: "job_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      job_codes: {
        Row: {
          common_add_ons: Json
          confidence_score: number | null
          created_at: string
          id: string
          is_system_generated: boolean
          job_name: string
          make: string
          manufacturer_estimated_hours: number | null
          model_family: string | null
          parts_template: Json
          senior_tech_average_hours: number | null
          shop_average_hours: number | null
          source_of_truth_notes: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          common_add_ons?: Json
          confidence_score?: number | null
          created_at?: string
          id?: string
          is_system_generated?: boolean
          job_name: string
          make: string
          manufacturer_estimated_hours?: number | null
          model_family?: string | null
          parts_template?: Json
          senior_tech_average_hours?: number | null
          shop_average_hours?: number | null
          source_of_truth_notes?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          common_add_ons?: Json
          confidence_score?: number | null
          created_at?: string
          id?: string
          is_system_generated?: boolean
          job_name?: string
          make?: string
          manufacturer_estimated_hours?: number | null
          model_family?: string | null
          parts_template?: Json
          senior_tech_average_hours?: number | null
          shop_average_hours?: number | null
          source_of_truth_notes?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      kb_job_runs: {
        Row: {
          created_at: string
          error_count: number
          finished_at: string | null
          id: string
          job_name: string
          metadata: Json
          processed_count: number
          started_at: string
          status: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          error_count?: number
          finished_at?: string | null
          id?: string
          job_name: string
          metadata?: Json
          processed_count?: number
          started_at?: string
          status: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          error_count?: number
          finished_at?: string | null
          id?: string
          job_name?: string
          metadata?: Json
          processed_count?: number
          started_at?: string
          status?: string
          workspace_id?: string
        }
        Relationships: []
      }
      knowledge_gaps: {
        Row: {
          created_at: string
          frequency: number
          id: string
          last_asked_at: string
          question: string
          question_normalized: string | null
          resolved: boolean
          trace_id: string | null
          updated_at: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          frequency?: number
          id?: string
          last_asked_at?: string
          question: string
          question_normalized?: string | null
          resolved?: boolean
          trace_id?: string | null
          updated_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Update: {
          created_at?: string
          frequency?: number
          id?: string
          last_asked_at?: string
          question?: string
          question_normalized?: string | null
          resolved?: boolean
          trace_id?: string | null
          updated_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_gaps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      machine_knowledge_notes: {
        Row: {
          content: string
          created_at: string
          embedding: string | null
          equipment_id: string | null
          id: string
          job_id: string | null
          metadata: Json
          note_type: string
          source_user_id: string | null
          workspace_id: string
        }
        Insert: {
          content: string
          created_at?: string
          embedding?: string | null
          equipment_id?: string | null
          id?: string
          job_id?: string | null
          metadata?: Json
          note_type: string
          source_user_id?: string | null
          workspace_id?: string
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string | null
          equipment_id?: string | null
          id?: string
          job_id?: string | null
          metadata?: Json
          note_type?: string
          source_user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "machine_knowledge_notes_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_knowledge_notes_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "machine_knowledge_notes_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_knowledge_notes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_knowledge_notes_source_user_id_fkey"
            columns: ["source_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      machine_parts_links: {
        Row: {
          association_strength: number
          created_at: string
          id: string
          link_source: string
          machine_id: string
          notes: string | null
          part_id: string
          part_number: string
          updated_at: string
          usage_frequency: string | null
          workspace_id: string
        }
        Insert: {
          association_strength?: number
          created_at?: string
          id?: string
          link_source: string
          machine_id: string
          notes?: string | null
          part_id: string
          part_number: string
          updated_at?: string
          usage_frequency?: string | null
          workspace_id?: string
        }
        Update: {
          association_strength?: number
          created_at?: string
          id?: string
          link_source?: string
          machine_id?: string
          notes?: string | null
          part_id?: string
          part_number?: string
          updated_at?: string
          usage_frequency?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "machine_parts_links_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machine_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_parts_links_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_parts_links_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_dead_capital"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "machine_parts_links_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_embedding_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_parts_links_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_import_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "machine_parts_links_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_intelligence"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "machine_parts_links_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_margin_signal"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "machine_parts_links_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_pricing_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "machine_parts_links_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_stockout_risk"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "machine_parts_links_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_velocity"
            referencedColumns: ["part_id"]
          },
        ]
      }
      machine_profiles: {
        Row: {
          category: string
          common_wear_parts: Json
          created_at: string
          deleted_at: string | null
          extraction_confidence: number | null
          fluid_capacities: Json
          id: string
          maintenance_schedule: Json
          manually_verified: boolean
          manufacturer: string
          model: string
          model_family: string | null
          notes: string | null
          source_documents: string[] | null
          specs: Json
          updated_at: string
          workspace_id: string
          year_range_end: number | null
          year_range_start: number | null
        }
        Insert: {
          category: string
          common_wear_parts?: Json
          created_at?: string
          deleted_at?: string | null
          extraction_confidence?: number | null
          fluid_capacities?: Json
          id?: string
          maintenance_schedule?: Json
          manually_verified?: boolean
          manufacturer: string
          model: string
          model_family?: string | null
          notes?: string | null
          source_documents?: string[] | null
          specs?: Json
          updated_at?: string
          workspace_id?: string
          year_range_end?: number | null
          year_range_start?: number | null
        }
        Update: {
          category?: string
          common_wear_parts?: Json
          created_at?: string
          deleted_at?: string | null
          extraction_confidence?: number | null
          fluid_capacities?: Json
          id?: string
          maintenance_schedule?: Json
          manually_verified?: boolean
          manufacturer?: string
          model?: string
          model_family?: string | null
          notes?: string | null
          source_documents?: string[] | null
          specs?: Json
          updated_at?: string
          workspace_id?: string
          year_range_end?: number | null
          year_range_start?: number | null
        }
        Relationships: []
      }
      maintenance_schedules: {
        Row: {
          actual_cost: number | null
          completed_at: string | null
          completed_by: string | null
          completion_notes: string | null
          created_at: string
          description: string
          equipment_id: string | null
          estimated_cost: number | null
          estimated_duration_hours: number | null
          fleet_id: string | null
          id: string
          maintenance_type: string
          parts_used: Json | null
          prediction_confidence: number | null
          prediction_model: string | null
          prediction_signals: Json | null
          scheduled_date: string
          scheduled_hours: number | null
          status: string
          subscription_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          actual_cost?: number | null
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          created_at?: string
          description: string
          equipment_id?: string | null
          estimated_cost?: number | null
          estimated_duration_hours?: number | null
          fleet_id?: string | null
          id?: string
          maintenance_type: string
          parts_used?: Json | null
          prediction_confidence?: number | null
          prediction_model?: string | null
          prediction_signals?: Json | null
          scheduled_date: string
          scheduled_hours?: number | null
          status?: string
          subscription_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          actual_cost?: number | null
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          created_at?: string
          description?: string
          equipment_id?: string | null
          estimated_cost?: number | null
          estimated_duration_hours?: number | null
          fleet_id?: string | null
          id?: string
          maintenance_type?: string
          parts_used?: Json | null
          prediction_confidence?: number | null
          prediction_model?: string | null
          prediction_signals?: Json | null
          scheduled_date?: string
          scheduled_hours?: number | null
          status?: string
          subscription_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_schedules_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_schedules_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_schedules_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "maintenance_schedules_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_schedules_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "customer_fleet"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_schedules_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "portal_trade_in_opportunities"
            referencedColumns: ["fleet_id"]
          },
          {
            foreignKeyName: "maintenance_schedules_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "eaas_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturer_incentives: {
        Row: {
          ai_confidence: number | null
          created_at: string
          description: string | null
          discount_type: string
          discount_value: number
          effective_date: string | null
          eligibility_criteria: string | null
          eligibility_rules: Json
          eligible_categories: string[] | null
          eligible_models: string[] | null
          end_date: string | null
          entered_by: string | null
          expiration_date: string | null
          id: string
          is_active: boolean
          manufacturer: string | null
          metadata: Json | null
          oem_name: string
          program_code: string | null
          program_name: string
          requires_approval: boolean
          source: string | null
          source_url: string | null
          stackable: boolean
          stacking_rules: string | null
          start_date: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          ai_confidence?: number | null
          created_at?: string
          description?: string | null
          discount_type: string
          discount_value: number
          effective_date?: string | null
          eligibility_criteria?: string | null
          eligibility_rules?: Json
          eligible_categories?: string[] | null
          eligible_models?: string[] | null
          end_date?: string | null
          entered_by?: string | null
          expiration_date?: string | null
          id?: string
          is_active?: boolean
          manufacturer?: string | null
          metadata?: Json | null
          oem_name: string
          program_code?: string | null
          program_name: string
          requires_approval?: boolean
          source?: string | null
          source_url?: string | null
          stackable?: boolean
          stacking_rules?: string | null
          start_date: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          ai_confidence?: number | null
          created_at?: string
          description?: string | null
          discount_type?: string
          discount_value?: number
          effective_date?: string | null
          eligibility_criteria?: string | null
          eligibility_rules?: Json
          eligible_categories?: string[] | null
          eligible_models?: string[] | null
          end_date?: string | null
          entered_by?: string | null
          expiration_date?: string | null
          id?: string
          is_active?: boolean
          manufacturer?: string | null
          metadata?: Json | null
          oem_name?: string
          program_code?: string | null
          program_name?: string
          requires_approval?: boolean
          source?: string | null
          source_url?: string | null
          stackable?: boolean
          stacking_rules?: string | null
          start_date?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manufacturer_incentives_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      margin_waterfalls: {
        Row: {
          amount: number
          created_at: string
          deal_scenario_id: string
          id: string
          is_margin_line: boolean | null
          line_category: string
          line_label: string
          line_order: number
          metadata: Json | null
        }
        Insert: {
          amount: number
          created_at?: string
          deal_scenario_id: string
          id?: string
          is_margin_line?: boolean | null
          line_category: string
          line_label: string
          line_order: number
          metadata?: Json | null
        }
        Update: {
          amount?: number
          created_at?: string
          deal_scenario_id?: string
          id?: string
          is_margin_line?: boolean | null
          line_category?: string
          line_label?: string
          line_order?: number
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "margin_waterfalls_deal_scenario_id_fkey"
            columns: ["deal_scenario_id"]
            isOneToOne: false
            referencedRelation: "deal_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      market_valuations: {
        Row: {
          condition: string | null
          confidence_score: number | null
          created_at: string
          estimated_fmv: number | null
          expires_at: string
          high_estimate: number | null
          hours: number | null
          id: string
          location: string | null
          low_estimate: number | null
          make: string
          model: string
          override_reason: string | null
          source: string
          source_detail: Json | null
          stock_number: string | null
          updated_at: string
          valued_by: string | null
          year: number
        }
        Insert: {
          condition?: string | null
          confidence_score?: number | null
          created_at?: string
          estimated_fmv?: number | null
          expires_at: string
          high_estimate?: number | null
          hours?: number | null
          id?: string
          location?: string | null
          low_estimate?: number | null
          make: string
          model: string
          override_reason?: string | null
          source: string
          source_detail?: Json | null
          stock_number?: string | null
          updated_at?: string
          valued_by?: string | null
          year: number
        }
        Update: {
          condition?: string | null
          confidence_score?: number | null
          created_at?: string
          estimated_fmv?: number | null
          expires_at?: string
          high_estimate?: number | null
          hours?: number | null
          id?: string
          location?: string | null
          low_estimate?: number | null
          make?: string
          model?: string
          override_reason?: string | null
          source?: string
          source_detail?: Json | null
          stock_number?: string | null
          updated_at?: string
          valued_by?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "market_valuations_valued_by_fkey"
            columns: ["valued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_campaigns: {
        Row: {
          ai_generated: boolean | null
          campaign_type: string
          channels: string[] | null
          click_count: number | null
          completed_at: string | null
          content_template: Json | null
          conversion_count: number | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          open_count: number | null
          revenue_attributed: number | null
          scheduled_at: string | null
          sent_count: number | null
          started_at: string | null
          status: string
          target_customer_count: number | null
          target_segment: Json | null
          trigger_config: Json | null
          trigger_type: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          ai_generated?: boolean | null
          campaign_type: string
          channels?: string[] | null
          click_count?: number | null
          completed_at?: string | null
          content_template?: Json | null
          conversion_count?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          open_count?: number | null
          revenue_attributed?: number | null
          scheduled_at?: string | null
          sent_count?: number | null
          started_at?: string | null
          status?: string
          target_customer_count?: number | null
          target_segment?: Json | null
          trigger_config?: Json | null
          trigger_type?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          ai_generated?: boolean | null
          campaign_type?: string
          channels?: string[] | null
          click_count?: number | null
          completed_at?: string | null
          content_template?: Json | null
          conversion_count?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          open_count?: number | null
          revenue_attributed?: number | null
          scheduled_at?: string | null
          sent_count?: number | null
          started_at?: string | null
          status?: string
          target_customer_count?: number | null
          target_segment?: Json | null
          trigger_config?: Json | null
          trigger_type?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      morning_briefings: {
        Row: {
          briefing_date: string
          content: string
          created_at: string
          data: Json
          id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          briefing_date?: string
          content: string
          created_at?: string
          data?: Json
          id?: string
          user_id: string
          workspace_id?: string
        }
        Update: {
          briefing_date?: string
          content?: string
          created_at?: string
          data?: Json
          id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "morning_briefings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      needs_assessments: {
        Row: {
          application: string | null
          attachments_needed: string[] | null
          brand_preference: string | null
          budget_amount: number | null
          budget_type: string | null
          completeness_pct: number | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          current_equipment: string | null
          current_equipment_issues: string | null
          deal_id: string | null
          decision_maker_name: string | null
          entry_method: string | null
          fields_corrected: number | null
          fields_populated: number
          fields_total: number
          financing_preference: string | null
          has_trade_in: boolean | null
          id: string
          is_decision_maker: boolean | null
          job_scheduled: boolean | null
          machine_interest: string | null
          monthly_payment_target: number | null
          next_step: string | null
          qrm_narrative: string | null
          terrain_material: string | null
          timeline_description: string | null
          timeline_urgency: string | null
          trade_in_details: string | null
          updated_at: string
          verified_at: string | null
          verified_by: string | null
          voice_capture_id: string | null
          work_type: string | null
          workspace_id: string
        }
        Insert: {
          application?: string | null
          attachments_needed?: string[] | null
          brand_preference?: string | null
          budget_amount?: number | null
          budget_type?: string | null
          completeness_pct?: number | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          current_equipment?: string | null
          current_equipment_issues?: string | null
          deal_id?: string | null
          decision_maker_name?: string | null
          entry_method?: string | null
          fields_corrected?: number | null
          fields_populated?: number
          fields_total?: number
          financing_preference?: string | null
          has_trade_in?: boolean | null
          id?: string
          is_decision_maker?: boolean | null
          job_scheduled?: boolean | null
          machine_interest?: string | null
          monthly_payment_target?: number | null
          next_step?: string | null
          qrm_narrative?: string | null
          terrain_material?: string | null
          timeline_description?: string | null
          timeline_urgency?: string | null
          trade_in_details?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          voice_capture_id?: string | null
          work_type?: string | null
          workspace_id?: string
        }
        Update: {
          application?: string | null
          attachments_needed?: string[] | null
          brand_preference?: string | null
          budget_amount?: number | null
          budget_type?: string | null
          completeness_pct?: number | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          current_equipment?: string | null
          current_equipment_issues?: string | null
          deal_id?: string | null
          decision_maker_name?: string | null
          entry_method?: string | null
          fields_corrected?: number | null
          fields_populated?: number
          fields_total?: number
          financing_preference?: string | null
          has_trade_in?: boolean | null
          id?: string
          is_decision_maker?: boolean | null
          job_scheduled?: boolean | null
          machine_interest?: string | null
          monthly_payment_target?: number | null
          next_step?: string | null
          qrm_narrative?: string | null
          terrain_material?: string | null
          timeline_description?: string | null
          timeline_urgency?: string | null
          trade_in_details?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          voice_capture_id?: string | null
          work_type?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "needs_assessments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "needs_assessments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "needs_assessments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "needs_assessments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "needs_assessments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "needs_assessments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "needs_assessments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "needs_assessments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "needs_assessments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "needs_assessments_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "needs_assessments_voice_capture_id_fkey"
            columns: ["voice_capture_id"]
            isOneToOne: false
            referencedRelation: "voice_captures"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_sync_queue: {
        Row: {
          action_type: string
          created_at: string
          error_message: string | null
          id: string
          payload: Json
          queued_at: string
          sync_status: string
          synced_at: string | null
          user_id: string
        }
        Insert: {
          action_type: string
          created_at?: string
          error_message?: string | null
          id?: string
          payload: Json
          queued_at: string
          sync_status?: string
          synced_at?: string | null
          user_id: string
        }
        Update: {
          action_type?: string
          created_at?: string
          error_message?: string | null
          id?: string
          payload?: Json
          queued_at?: string
          sync_status?: string
          synced_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      onedrive_sync_state: {
        Row: {
          access_token: string | null
          created_at: string
          delta_token: string | null
          drive_id: string | null
          id: string
          last_synced_at: string | null
          refresh_token: string | null
          token_expires_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          delta_token?: string | null
          drive_id?: string | null
          id?: string
          last_synced_at?: string | null
          refresh_token?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          access_token?: string | null
          created_at?: string
          delta_token?: string | null
          drive_id?: string | null
          id?: string
          last_synced_at?: string | null
          refresh_token?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onedrive_sync_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_queue: {
        Row: {
          actioned_at: string | null
          actioned_by: string | null
          assigned_rep_id: string | null
          created_at: string
          customer_name: string
          customer_profile_id: string | null
          equipment_description: string
          estimated_deal_value: number | null
          fleet_intelligence_id: string
          hubspot_sequence_id: string | null
          id: string
          notes: string | null
          priority_score: number | null
          status: Database["public"]["Enums"]["outreach_status"]
          trigger_reason: string
          updated_at: string
        }
        Insert: {
          actioned_at?: string | null
          actioned_by?: string | null
          assigned_rep_id?: string | null
          created_at?: string
          customer_name: string
          customer_profile_id?: string | null
          equipment_description: string
          estimated_deal_value?: number | null
          fleet_intelligence_id: string
          hubspot_sequence_id?: string | null
          id?: string
          notes?: string | null
          priority_score?: number | null
          status?: Database["public"]["Enums"]["outreach_status"]
          trigger_reason: string
          updated_at?: string
        }
        Update: {
          actioned_at?: string | null
          actioned_by?: string | null
          assigned_rep_id?: string | null
          created_at?: string
          customer_name?: string
          customer_profile_id?: string | null
          equipment_description?: string
          estimated_deal_value?: number | null
          fleet_intelligence_id?: string
          hubspot_sequence_id?: string | null
          id?: string
          notes?: string | null
          priority_score?: number | null
          status?: Database["public"]["Enums"]["outreach_status"]
          trigger_reason?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_queue_actioned_by_fkey"
            columns: ["actioned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_queue_assigned_rep_id_fkey"
            columns: ["assigned_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_queue_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "customer_profiles_extended"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_queue_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "exec_health_movers"
            referencedColumns: ["customer_profile_id"]
          },
          {
            foreignKeyName: "outreach_queue_fleet_intelligence_id_fkey"
            columns: ["fleet_intelligence_id"]
            isOneToOne: false
            referencedRelation: "equipment_lifecycle_summary"
            referencedColumns: ["fleet_intelligence_id"]
          },
          {
            foreignKeyName: "outreach_queue_fleet_intelligence_id_fkey"
            columns: ["fleet_intelligence_id"]
            isOneToOne: false
            referencedRelation: "fleet_intelligence"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_briefs: {
        Row: {
          brief_text: string
          created_at: string
          event_count: number | null
          generated_at: string
          model: string | null
          tokens_in: number | null
          tokens_out: number | null
          workspace_id: string
        }
        Insert: {
          brief_text: string
          created_at?: string
          event_count?: number | null
          generated_at?: string
          model?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
          workspace_id: string
        }
        Update: {
          brief_text?: string
          created_at?: string
          event_count?: number | null
          generated_at?: string
          model?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
          workspace_id?: string
        }
        Relationships: []
      }
      owner_predictive_interventions_cache: {
        Row: {
          created_at: string
          generated_at: string
          model: string | null
          payload: Json
          tokens_in: number | null
          tokens_out: number | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          generated_at?: string
          model?: string | null
          payload: Json
          tokens_in?: number | null
          tokens_out?: number | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          generated_at?: string
          model?: string | null
          payload?: Json
          tokens_in?: number | null
          tokens_out?: number | null
          workspace_id?: string
        }
        Relationships: []
      }
      parts_analytics_snapshots: {
        Row: {
          computation_batch_id: string | null
          created_at: string
          dead_stock_count: number
          dead_stock_value: number
          fastest_moving: Json
          id: string
          line_count: number
          order_count: number
          revenue_by_branch: Json
          revenue_by_category: Json
          revenue_by_source: Json
          slowest_moving: Json
          snapshot_date: string
          top_customers: Json
          total_cost: number
          total_inventory_value: number
          total_margin: number
          total_revenue: number
          workspace_id: string
        }
        Insert: {
          computation_batch_id?: string | null
          created_at?: string
          dead_stock_count?: number
          dead_stock_value?: number
          fastest_moving?: Json
          id?: string
          line_count?: number
          order_count?: number
          revenue_by_branch?: Json
          revenue_by_category?: Json
          revenue_by_source?: Json
          slowest_moving?: Json
          snapshot_date: string
          top_customers?: Json
          total_cost?: number
          total_inventory_value?: number
          total_margin?: number
          total_revenue?: number
          workspace_id?: string
        }
        Update: {
          computation_batch_id?: string | null
          created_at?: string
          dead_stock_count?: number
          dead_stock_value?: number
          fastest_moving?: Json
          id?: string
          line_count?: number
          order_count?: number
          revenue_by_branch?: Json
          revenue_by_category?: Json
          revenue_by_source?: Json
          slowest_moving?: Json
          snapshot_date?: string
          top_customers?: Json
          total_cost?: number
          total_inventory_value?: number
          total_margin?: number
          total_revenue?: number
          workspace_id?: string
        }
        Relationships: []
      }
      parts_auto_replenish_queue: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          branch_id: string
          cdk_vendor_list_price: number | null
          computation_batch_id: string | null
          created_at: string
          economic_order_qty: number | null
          edited_at: string | null
          edited_by: string | null
          estimated_total: number | null
          estimated_unit_cost: number | null
          expires_at: string
          forecast_covered_days: number | null
          forecast_driven: boolean
          id: string
          ordered_at: string | null
          ordered_by: string | null
          originating_play_id: string | null
          part_number: string
          parts_order_id: string | null
          po_reference: string | null
          potential_overpay_flag: boolean
          qty_on_hand: number
          recommended_qty: number
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          reorder_point: number
          scheduled_for: string | null
          selected_vendor_id: string | null
          source_type: string | null
          status: string
          updated_at: string
          vendor_price_corroborated: boolean
          vendor_score: number | null
          vendor_selection_reason: string | null
          workspace_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          branch_id: string
          cdk_vendor_list_price?: number | null
          computation_batch_id?: string | null
          created_at?: string
          economic_order_qty?: number | null
          edited_at?: string | null
          edited_by?: string | null
          estimated_total?: number | null
          estimated_unit_cost?: number | null
          expires_at?: string
          forecast_covered_days?: number | null
          forecast_driven?: boolean
          id?: string
          ordered_at?: string | null
          ordered_by?: string | null
          originating_play_id?: string | null
          part_number: string
          parts_order_id?: string | null
          po_reference?: string | null
          potential_overpay_flag?: boolean
          qty_on_hand: number
          recommended_qty: number
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          reorder_point: number
          scheduled_for?: string | null
          selected_vendor_id?: string | null
          source_type?: string | null
          status?: string
          updated_at?: string
          vendor_price_corroborated?: boolean
          vendor_score?: number | null
          vendor_selection_reason?: string | null
          workspace_id?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          branch_id?: string
          cdk_vendor_list_price?: number | null
          computation_batch_id?: string | null
          created_at?: string
          economic_order_qty?: number | null
          edited_at?: string | null
          edited_by?: string | null
          estimated_total?: number | null
          estimated_unit_cost?: number | null
          expires_at?: string
          forecast_covered_days?: number | null
          forecast_driven?: boolean
          id?: string
          ordered_at?: string | null
          ordered_by?: string | null
          originating_play_id?: string | null
          part_number?: string
          parts_order_id?: string | null
          po_reference?: string | null
          potential_overpay_flag?: boolean
          qty_on_hand?: number
          recommended_qty?: number
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          reorder_point?: number
          scheduled_for?: string | null
          selected_vendor_id?: string | null
          source_type?: string | null
          status?: string
          updated_at?: string
          vendor_price_corroborated?: boolean
          vendor_score?: number | null
          vendor_selection_reason?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_parts_auto_replenish_queue_branch"
            columns: ["workspace_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["workspace_id", "slug"]
          },
          {
            foreignKeyName: "parts_auto_replenish_queue_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_auto_replenish_queue_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_auto_replenish_queue_ordered_by_fkey"
            columns: ["ordered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_auto_replenish_queue_originating_play_id_fkey"
            columns: ["originating_play_id"]
            isOneToOne: false
            referencedRelation: "predicted_parts_plays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_auto_replenish_queue_originating_play_id_fkey"
            columns: ["originating_play_id"]
            isOneToOne: false
            referencedRelation: "v_predictive_plays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_auto_replenish_queue_parts_order_id_fkey"
            columns: ["parts_order_id"]
            isOneToOne: false
            referencedRelation: "parts_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_auto_replenish_queue_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_auto_replenish_queue_selected_vendor_id_fkey"
            columns: ["selected_vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_health_scorecard"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "parts_auto_replenish_queue_selected_vendor_id_fkey"
            columns: ["selected_vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      parts_catalog: {
        Row: {
          activity_code: string | null
          asl_category: string | null
          avatax_product_code: string | null
          avatax_use_exemption: string | null
          average_cost: number | null
          average_inventory: number | null
          back_ordered: number | null
          bin_location: string | null
          bin_location_manual_override: boolean
          branch_code: string
          category: string | null
          category_code: string | null
          category_manual_override: boolean
          class_code: string | null
          class_code_manual_override: boolean
          co_code: string
          compatible_machines: string[] | null
          cost_price: number | null
          created_at: string
          cross_references: Json
          deleted_at: string | null
          description: string | null
          description_manual_override: boolean
          div_code: string
          dms_date_added: string | null
          dms_last_modified: string | null
          dms_last_ordered: string | null
          dms_last_stock_ordered: string | null
          dms_status: string | null
          embedding: string | null
          embedding_computed_at: string | null
          embedding_model: string | null
          embedding_text: string | null
          eoq: number | null
          eoq_manual_override: boolean
          extraction_confidence: number | null
          frequently_ordered_with: string[] | null
          id: string
          intellidealer_part_id: string | null
          is_active: boolean
          last_12mo_sales: number | null
          last_count_date: string | null
          last_import_run_id: string | null
          last_known_price: number | null
          last_po_number: string | null
          last_sale_date: string | null
          last_year_sales_dollars: number | null
          last_year_sales_qty: number | null
          lead_time_days: number | null
          list_price: number | null
          list_price_manual_override: boolean
          machine_code: string | null
          manual_updated_at: string | null
          manual_updated_by: string | null
          manually_verified: boolean
          manufacturer: string | null
          model_code: string | null
          movement_code: string | null
          on_hand: number | null
          on_order: number | null
          part_number: string
          parts_per_package: number | null
          pkg_qty: number | null
          previous_bin_location: string | null
          price_updated_at: string | null
          pricing_level_1: number | null
          pricing_level_1_manual_override: boolean
          pricing_level_2: number | null
          pricing_level_2_manual_override: boolean
          pricing_level_3: number | null
          pricing_level_3_manual_override: boolean
          pricing_level_4: number | null
          pricing_level_4_manual_override: boolean
          quantity_allocated: number | null
          quantity_reserved: number | null
          raw_dms_row: Json | null
          region_last_12mo_sales: number | null
          reorder_point: number | null
          reorder_point_manual_override: boolean
          safety_stock_manual_override: boolean
          safety_stock_qty: number | null
          source_documents: string[] | null
          source_of_supply: string | null
          stocking_code: string | null
          superseded_by: string | null
          supersedes: string | null
          uom: string | null
          updated_at: string
          vendor_code: string | null
          weight_lb: number | null
          weight_lbs: number | null
          workspace_id: string
          ytd_sales_dollars: number | null
        }
        Insert: {
          activity_code?: string | null
          asl_category?: string | null
          avatax_product_code?: string | null
          avatax_use_exemption?: string | null
          average_cost?: number | null
          average_inventory?: number | null
          back_ordered?: number | null
          bin_location?: string | null
          bin_location_manual_override?: boolean
          branch_code?: string
          category?: string | null
          category_code?: string | null
          category_manual_override?: boolean
          class_code?: string | null
          class_code_manual_override?: boolean
          co_code?: string
          compatible_machines?: string[] | null
          cost_price?: number | null
          created_at?: string
          cross_references?: Json
          deleted_at?: string | null
          description?: string | null
          description_manual_override?: boolean
          div_code?: string
          dms_date_added?: string | null
          dms_last_modified?: string | null
          dms_last_ordered?: string | null
          dms_last_stock_ordered?: string | null
          dms_status?: string | null
          embedding?: string | null
          embedding_computed_at?: string | null
          embedding_model?: string | null
          embedding_text?: string | null
          eoq?: number | null
          eoq_manual_override?: boolean
          extraction_confidence?: number | null
          frequently_ordered_with?: string[] | null
          id?: string
          intellidealer_part_id?: string | null
          is_active?: boolean
          last_12mo_sales?: number | null
          last_count_date?: string | null
          last_import_run_id?: string | null
          last_known_price?: number | null
          last_po_number?: string | null
          last_sale_date?: string | null
          last_year_sales_dollars?: number | null
          last_year_sales_qty?: number | null
          lead_time_days?: number | null
          list_price?: number | null
          list_price_manual_override?: boolean
          machine_code?: string | null
          manual_updated_at?: string | null
          manual_updated_by?: string | null
          manually_verified?: boolean
          manufacturer?: string | null
          model_code?: string | null
          movement_code?: string | null
          on_hand?: number | null
          on_order?: number | null
          part_number: string
          parts_per_package?: number | null
          pkg_qty?: number | null
          previous_bin_location?: string | null
          price_updated_at?: string | null
          pricing_level_1?: number | null
          pricing_level_1_manual_override?: boolean
          pricing_level_2?: number | null
          pricing_level_2_manual_override?: boolean
          pricing_level_3?: number | null
          pricing_level_3_manual_override?: boolean
          pricing_level_4?: number | null
          pricing_level_4_manual_override?: boolean
          quantity_allocated?: number | null
          quantity_reserved?: number | null
          raw_dms_row?: Json | null
          region_last_12mo_sales?: number | null
          reorder_point?: number | null
          reorder_point_manual_override?: boolean
          safety_stock_manual_override?: boolean
          safety_stock_qty?: number | null
          source_documents?: string[] | null
          source_of_supply?: string | null
          stocking_code?: string | null
          superseded_by?: string | null
          supersedes?: string | null
          uom?: string | null
          updated_at?: string
          vendor_code?: string | null
          weight_lb?: number | null
          weight_lbs?: number | null
          workspace_id?: string
          ytd_sales_dollars?: number | null
        }
        Update: {
          activity_code?: string | null
          asl_category?: string | null
          avatax_product_code?: string | null
          avatax_use_exemption?: string | null
          average_cost?: number | null
          average_inventory?: number | null
          back_ordered?: number | null
          bin_location?: string | null
          bin_location_manual_override?: boolean
          branch_code?: string
          category?: string | null
          category_code?: string | null
          category_manual_override?: boolean
          class_code?: string | null
          class_code_manual_override?: boolean
          co_code?: string
          compatible_machines?: string[] | null
          cost_price?: number | null
          created_at?: string
          cross_references?: Json
          deleted_at?: string | null
          description?: string | null
          description_manual_override?: boolean
          div_code?: string
          dms_date_added?: string | null
          dms_last_modified?: string | null
          dms_last_ordered?: string | null
          dms_last_stock_ordered?: string | null
          dms_status?: string | null
          embedding?: string | null
          embedding_computed_at?: string | null
          embedding_model?: string | null
          embedding_text?: string | null
          eoq?: number | null
          eoq_manual_override?: boolean
          extraction_confidence?: number | null
          frequently_ordered_with?: string[] | null
          id?: string
          intellidealer_part_id?: string | null
          is_active?: boolean
          last_12mo_sales?: number | null
          last_count_date?: string | null
          last_import_run_id?: string | null
          last_known_price?: number | null
          last_po_number?: string | null
          last_sale_date?: string | null
          last_year_sales_dollars?: number | null
          last_year_sales_qty?: number | null
          lead_time_days?: number | null
          list_price?: number | null
          list_price_manual_override?: boolean
          machine_code?: string | null
          manual_updated_at?: string | null
          manual_updated_by?: string | null
          manually_verified?: boolean
          manufacturer?: string | null
          model_code?: string | null
          movement_code?: string | null
          on_hand?: number | null
          on_order?: number | null
          part_number?: string
          parts_per_package?: number | null
          pkg_qty?: number | null
          previous_bin_location?: string | null
          price_updated_at?: string | null
          pricing_level_1?: number | null
          pricing_level_1_manual_override?: boolean
          pricing_level_2?: number | null
          pricing_level_2_manual_override?: boolean
          pricing_level_3?: number | null
          pricing_level_3_manual_override?: boolean
          pricing_level_4?: number | null
          pricing_level_4_manual_override?: boolean
          quantity_allocated?: number | null
          quantity_reserved?: number | null
          raw_dms_row?: Json | null
          region_last_12mo_sales?: number | null
          reorder_point?: number | null
          reorder_point_manual_override?: boolean
          safety_stock_manual_override?: boolean
          safety_stock_qty?: number | null
          source_documents?: string[] | null
          source_of_supply?: string | null
          stocking_code?: string | null
          superseded_by?: string | null
          supersedes?: string | null
          uom?: string | null
          updated_at?: string
          vendor_code?: string | null
          weight_lb?: number | null
          weight_lbs?: number | null
          workspace_id?: string
          ytd_sales_dollars?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "parts_catalog_last_import_run_fk"
            columns: ["last_import_run_id"]
            isOneToOne: false
            referencedRelation: "parts_import_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_catalog_last_import_run_fk"
            columns: ["last_import_run_id"]
            isOneToOne: false
            referencedRelation: "v_parts_import_drift"
            referencedColumns: ["last_import_run_id"]
          },
          {
            foreignKeyName: "parts_catalog_manual_updated_by_fkey"
            columns: ["manual_updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      parts_cross_references: {
        Row: {
          confidence: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          fitment_notes: string | null
          id: string
          is_active: boolean
          lead_time_delta_days: number | null
          part_number_a: string
          part_number_b: string
          price_delta: number | null
          relationship: Database["public"]["Enums"]["parts_xref_relationship"]
          source: string
          updated_at: string
          verified_at: string | null
          verified_by: string | null
          workspace_id: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          fitment_notes?: string | null
          id?: string
          is_active?: boolean
          lead_time_delta_days?: number | null
          part_number_a: string
          part_number_b: string
          price_delta?: number | null
          relationship: Database["public"]["Enums"]["parts_xref_relationship"]
          source?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          workspace_id?: string
        }
        Update: {
          confidence?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          fitment_notes?: string | null
          id?: string
          is_active?: boolean
          lead_time_delta_days?: number | null
          part_number_a?: string
          part_number_b?: string
          price_delta?: number | null
          relationship?: Database["public"]["Enums"]["parts_xref_relationship"]
          source?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parts_cross_references_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_cross_references_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      parts_demand_forecasts: {
        Row: {
          branch_id: string
          computation_batch_id: string | null
          computed_at: string
          confidence_high: number
          confidence_low: number
          created_at: string
          drivers: Json
          forecast_month: string
          id: string
          input_sources: Json
          model_version: string
          part_number: string
          predicted_qty: number
          qty_on_hand_at_forecast: number | null
          reorder_point_at_forecast: number | null
          seeded_from_history: boolean
          stockout_risk: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          branch_id: string
          computation_batch_id?: string | null
          computed_at?: string
          confidence_high?: number
          confidence_low?: number
          created_at?: string
          drivers?: Json
          forecast_month: string
          id?: string
          input_sources?: Json
          model_version?: string
          part_number: string
          predicted_qty?: number
          qty_on_hand_at_forecast?: number | null
          reorder_point_at_forecast?: number | null
          seeded_from_history?: boolean
          stockout_risk?: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          branch_id?: string
          computation_batch_id?: string | null
          computed_at?: string
          confidence_high?: number
          confidence_low?: number
          created_at?: string
          drivers?: Json
          forecast_month?: string
          id?: string
          input_sources?: Json
          model_version?: string
          part_number?: string
          predicted_qty?: number
          qty_on_hand_at_forecast?: number | null
          reorder_point_at_forecast?: number | null
          seeded_from_history?: boolean
          stockout_risk?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_parts_demand_forecasts_branch"
            columns: ["workspace_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["workspace_id", "slug"]
          },
        ]
      }
      parts_fulfillment_events: {
        Row: {
          created_at: string
          event_type: string
          fulfillment_run_id: string
          id: string
          idempotency_key: string | null
          payload: Json
          workspace_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          fulfillment_run_id: string
          id?: string
          idempotency_key?: string | null
          payload?: Json
          workspace_id?: string
        }
        Update: {
          created_at?: string
          event_type?: string
          fulfillment_run_id?: string
          id?: string
          idempotency_key?: string | null
          payload?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parts_fulfillment_events_fulfillment_run_id_fkey"
            columns: ["fulfillment_run_id"]
            isOneToOne: false
            referencedRelation: "parts_fulfillment_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      parts_fulfillment_runs: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      parts_history_monthly: {
        Row: {
          bin_trips: number
          created_at: string
          demands: number
          id: string
          month_offset: number
          part_id: string
          period_end: string | null
          sales_qty: number
          source_import_run_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          bin_trips?: number
          created_at?: string
          demands?: number
          id?: string
          month_offset: number
          part_id: string
          period_end?: string | null
          sales_qty?: number
          source_import_run_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          bin_trips?: number
          created_at?: string
          demands?: number
          id?: string
          month_offset?: number
          part_id?: string
          period_end?: string | null
          sales_qty?: number
          source_import_run_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parts_history_monthly_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_history_monthly_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_dead_capital"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_history_monthly_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_embedding_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_history_monthly_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_import_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_history_monthly_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_intelligence"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_history_monthly_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_margin_signal"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_history_monthly_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_pricing_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_history_monthly_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_stockout_risk"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_history_monthly_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_velocity"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_history_monthly_run_fk"
            columns: ["source_import_run_id"]
            isOneToOne: false
            referencedRelation: "parts_import_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_history_monthly_run_fk"
            columns: ["source_import_run_id"]
            isOneToOne: false
            referencedRelation: "v_parts_import_drift"
            referencedColumns: ["last_import_run_id"]
          },
        ]
      }
      parts_import_conflicts: {
        Row: {
          created_at: string
          current_set_at: string | null
          current_set_by: string | null
          current_value: Json | null
          field_label: string | null
          field_name: string
          id: string
          incoming_source: string | null
          incoming_value: Json | null
          notes: string | null
          part_id: string
          part_number: string
          priority: Database["public"]["Enums"]["parts_import_conflict_priority"]
          resolution:
            | Database["public"]["Enums"]["parts_import_conflict_resolution"]
            | null
          resolution_value: Json | null
          resolved_at: string | null
          resolved_by: string | null
          run_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          current_set_at?: string | null
          current_set_by?: string | null
          current_value?: Json | null
          field_label?: string | null
          field_name: string
          id?: string
          incoming_source?: string | null
          incoming_value?: Json | null
          notes?: string | null
          part_id: string
          part_number: string
          priority?: Database["public"]["Enums"]["parts_import_conflict_priority"]
          resolution?:
            | Database["public"]["Enums"]["parts_import_conflict_resolution"]
            | null
          resolution_value?: Json | null
          resolved_at?: string | null
          resolved_by?: string | null
          run_id: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          current_set_at?: string | null
          current_set_by?: string | null
          current_value?: Json | null
          field_label?: string | null
          field_name?: string
          id?: string
          incoming_source?: string | null
          incoming_value?: Json | null
          notes?: string | null
          part_id?: string
          part_number?: string
          priority?: Database["public"]["Enums"]["parts_import_conflict_priority"]
          resolution?:
            | Database["public"]["Enums"]["parts_import_conflict_resolution"]
            | null
          resolution_value?: Json | null
          resolved_at?: string | null
          resolved_by?: string | null
          run_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parts_import_conflicts_current_set_by_fkey"
            columns: ["current_set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_import_conflicts_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_import_conflicts_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_dead_capital"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_import_conflicts_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_embedding_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_import_conflicts_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_import_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_import_conflicts_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_intelligence"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_import_conflicts_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_margin_signal"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_import_conflicts_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_pricing_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_import_conflicts_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_stockout_risk"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_import_conflicts_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_velocity"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_import_conflicts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_import_conflicts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "parts_import_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_import_conflicts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "v_parts_import_drift"
            referencedColumns: ["last_import_run_id"]
          },
        ]
      }
      parts_import_runs: {
        Row: {
          branch_scope: string | null
          completed_at: string | null
          created_at: string
          error_log: Json | null
          file_type: Database["public"]["Enums"]["parts_import_file_type"]
          id: string
          options: Json
          preview_diff: Json | null
          row_count: number
          rows_conflicted: number
          rows_errored: number
          rows_inserted: number
          rows_skipped: number
          rows_updated: number
          source_file_hash: string
          source_file_name: string
          source_storage_path: string | null
          started_at: string
          status: Database["public"]["Enums"]["parts_import_status"]
          updated_at: string
          uploaded_by: string | null
          vendor_code: string | null
          vendor_id: string | null
          workspace_id: string
        }
        Insert: {
          branch_scope?: string | null
          completed_at?: string | null
          created_at?: string
          error_log?: Json | null
          file_type?: Database["public"]["Enums"]["parts_import_file_type"]
          id?: string
          options?: Json
          preview_diff?: Json | null
          row_count?: number
          rows_conflicted?: number
          rows_errored?: number
          rows_inserted?: number
          rows_skipped?: number
          rows_updated?: number
          source_file_hash: string
          source_file_name: string
          source_storage_path?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["parts_import_status"]
          updated_at?: string
          uploaded_by?: string | null
          vendor_code?: string | null
          vendor_id?: string | null
          workspace_id?: string
        }
        Update: {
          branch_scope?: string | null
          completed_at?: string | null
          created_at?: string
          error_log?: Json | null
          file_type?: Database["public"]["Enums"]["parts_import_file_type"]
          id?: string
          options?: Json
          preview_diff?: Json | null
          row_count?: number
          rows_conflicted?: number
          rows_errored?: number
          rows_inserted?: number
          rows_skipped?: number
          rows_updated?: number
          source_file_hash?: string
          source_file_name?: string
          source_storage_path?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["parts_import_status"]
          updated_at?: string
          uploaded_by?: string | null
          vendor_code?: string | null
          vendor_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parts_import_runs_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_import_runs_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_health_scorecard"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "parts_import_runs_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      parts_inventory: {
        Row: {
          bin_location: string | null
          branch_id: string
          catalog_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          part_number: string
          qty_on_hand: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          bin_location?: string | null
          branch_id: string
          catalog_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          part_number: string
          qty_on_hand?: number
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          bin_location?: string | null
          branch_id?: string
          catalog_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          part_number?: string
          qty_on_hand?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parts_inventory_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "parts_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_inventory_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "v_parts_dead_capital"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_inventory_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "v_parts_embedding_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_inventory_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "v_parts_import_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_inventory_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "v_parts_intelligence"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_inventory_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "v_parts_margin_signal"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_inventory_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "v_parts_pricing_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_inventory_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "v_parts_stockout_risk"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_inventory_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "v_parts_velocity"
            referencedColumns: ["part_id"]
          },
        ]
      }
      parts_llm_inference_runs: {
        Row: {
          cost_usd_cents: number | null
          created_at: string
          elapsed_ms: number | null
          error_message: string | null
          fleet_id: string | null
          grounding_rejections: Json | null
          id: string
          machine_profile_id: string | null
          max_tokens: number | null
          model: string
          plays_grounded: number
          plays_proposed: number
          plays_written: number
          portal_customer_id: string | null
          raw_response: Json | null
          status: string
          system_prompt_version: string
          temperature: number | null
          tokens_in: number | null
          tokens_out: number | null
          user_context: Json | null
          user_context_hash: string | null
          workspace_id: string
        }
        Insert: {
          cost_usd_cents?: number | null
          created_at?: string
          elapsed_ms?: number | null
          error_message?: string | null
          fleet_id?: string | null
          grounding_rejections?: Json | null
          id?: string
          machine_profile_id?: string | null
          max_tokens?: number | null
          model: string
          plays_grounded?: number
          plays_proposed?: number
          plays_written?: number
          portal_customer_id?: string | null
          raw_response?: Json | null
          status?: string
          system_prompt_version: string
          temperature?: number | null
          tokens_in?: number | null
          tokens_out?: number | null
          user_context?: Json | null
          user_context_hash?: string | null
          workspace_id?: string
        }
        Update: {
          cost_usd_cents?: number | null
          created_at?: string
          elapsed_ms?: number | null
          error_message?: string | null
          fleet_id?: string | null
          grounding_rejections?: Json | null
          id?: string
          machine_profile_id?: string | null
          max_tokens?: number | null
          model?: string
          plays_grounded?: number
          plays_proposed?: number
          plays_written?: number
          portal_customer_id?: string | null
          raw_response?: Json | null
          status?: string
          system_prompt_version?: string
          temperature?: number | null
          tokens_in?: number | null
          tokens_out?: number | null
          user_context?: Json | null
          user_context_hash?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parts_llm_inference_runs_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "customer_fleet"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_llm_inference_runs_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "portal_trade_in_opportunities"
            referencedColumns: ["fleet_id"]
          },
          {
            foreignKeyName: "parts_llm_inference_runs_machine_profile_id_fkey"
            columns: ["machine_profile_id"]
            isOneToOne: false
            referencedRelation: "machine_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_llm_inference_runs_portal_customer_id_fkey"
            columns: ["portal_customer_id"]
            isOneToOne: false
            referencedRelation: "portal_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      parts_order_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          from_status: string | null
          id: string
          metadata: Json
          parts_order_id: string
          source: string
          to_status: string | null
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          from_status?: string | null
          id?: string
          metadata?: Json
          parts_order_id: string
          source?: string
          to_status?: string | null
          workspace_id?: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          from_status?: string | null
          id?: string
          metadata?: Json
          parts_order_id?: string
          source?: string
          to_status?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parts_order_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_order_events_parts_order_id_fkey"
            columns: ["parts_order_id"]
            isOneToOne: false
            referencedRelation: "parts_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      parts_order_lines: {
        Row: {
          catalog_item_id: string | null
          created_at: string
          description: string | null
          id: string
          line_total: number | null
          part_number: string
          parts_order_id: string
          quantity: number
          sort_order: number
          unit_price: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          catalog_item_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          line_total?: number | null
          part_number: string
          parts_order_id: string
          quantity?: number
          sort_order?: number
          unit_price?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          catalog_item_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          line_total?: number | null
          part_number?: string
          parts_order_id?: string
          quantity?: number
          sort_order?: number
          unit_price?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parts_order_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "parts_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_order_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_parts_dead_capital"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_order_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_parts_embedding_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_order_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_parts_import_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_order_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_parts_intelligence"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_order_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_parts_margin_signal"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_order_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_parts_pricing_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_order_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_parts_stockout_risk"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_order_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_parts_velocity"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_order_lines_parts_order_id_fkey"
            columns: ["parts_order_id"]
            isOneToOne: false
            referencedRelation: "parts_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      parts_order_notification_sends: {
        Row: {
          created_at: string
          event_type: string
          id: string
          parts_order_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          parts_order_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          parts_order_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parts_order_notification_sends_parts_order_id_fkey"
            columns: ["parts_order_id"]
            isOneToOne: false
            referencedRelation: "parts_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      parts_orders: {
        Row: {
          ai_suggested_pm_kit: boolean | null
          ai_suggestion_reason: string | null
          created_at: string
          created_by: string | null
          crm_company_id: string | null
          estimated_delivery: string | null
          fleet_id: string | null
          fulfillment_run_id: string | null
          id: string
          is_machine_down: boolean
          line_items: Json
          notes: string | null
          order_source: string
          photo_identification: Json | null
          portal_customer_id: string | null
          shipping: number | null
          shipping_address: Json | null
          status: string
          subtotal: number | null
          tax: number | null
          total: number | null
          tracking_number: string | null
          updated_at: string
          voice_extraction: Json | null
          voice_transcript: string | null
          workspace_id: string
        }
        Insert: {
          ai_suggested_pm_kit?: boolean | null
          ai_suggestion_reason?: string | null
          created_at?: string
          created_by?: string | null
          crm_company_id?: string | null
          estimated_delivery?: string | null
          fleet_id?: string | null
          fulfillment_run_id?: string | null
          id?: string
          is_machine_down?: boolean
          line_items?: Json
          notes?: string | null
          order_source?: string
          photo_identification?: Json | null
          portal_customer_id?: string | null
          shipping?: number | null
          shipping_address?: Json | null
          status?: string
          subtotal?: number | null
          tax?: number | null
          total?: number | null
          tracking_number?: string | null
          updated_at?: string
          voice_extraction?: Json | null
          voice_transcript?: string | null
          workspace_id?: string
        }
        Update: {
          ai_suggested_pm_kit?: boolean | null
          ai_suggestion_reason?: string | null
          created_at?: string
          created_by?: string | null
          crm_company_id?: string | null
          estimated_delivery?: string | null
          fleet_id?: string | null
          fulfillment_run_id?: string | null
          id?: string
          is_machine_down?: boolean
          line_items?: Json
          notes?: string | null
          order_source?: string
          photo_identification?: Json | null
          portal_customer_id?: string | null
          shipping?: number | null
          shipping_address?: Json | null
          status?: string
          subtotal?: number | null
          tax?: number | null
          total?: number | null
          tracking_number?: string | null
          updated_at?: string
          voice_extraction?: Json | null
          voice_transcript?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parts_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_orders_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_orders_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_orders_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "parts_orders_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "customer_fleet"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_orders_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "portal_trade_in_opportunities"
            referencedColumns: ["fleet_id"]
          },
          {
            foreignKeyName: "parts_orders_fulfillment_run_id_fkey"
            columns: ["fulfillment_run_id"]
            isOneToOne: false
            referencedRelation: "parts_fulfillment_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_orders_portal_customer_id_fkey"
            columns: ["portal_customer_id"]
            isOneToOne: false
            referencedRelation: "portal_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      parts_predictive_kits: {
        Row: {
          computation_batch_id: string | null
          confidence: number
          created_at: string
          crm_company_id: string | null
          current_hours: number | null
          dismissed_reason: string | null
          drivers: Json
          equipment_make: string | null
          equipment_model: string | null
          equipment_serial: string | null
          expires_at: string | null
          fleet_id: string | null
          id: string
          kit_part_count: number
          kit_parts: Json
          kit_value: number
          model_version: string
          nearest_branch_id: string | null
          parts_in_stock: number
          parts_total: number
          predicted_failure_type: string | null
          predicted_service_window: string
          service_interval_hours: number | null
          staged_order_id: string | null
          status: string
          stock_status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          computation_batch_id?: string | null
          confidence?: number
          created_at?: string
          crm_company_id?: string | null
          current_hours?: number | null
          dismissed_reason?: string | null
          drivers?: Json
          equipment_make?: string | null
          equipment_model?: string | null
          equipment_serial?: string | null
          expires_at?: string | null
          fleet_id?: string | null
          id?: string
          kit_part_count?: number
          kit_parts?: Json
          kit_value?: number
          model_version?: string
          nearest_branch_id?: string | null
          parts_in_stock?: number
          parts_total?: number
          predicted_failure_type?: string | null
          predicted_service_window: string
          service_interval_hours?: number | null
          staged_order_id?: string | null
          status?: string
          stock_status?: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          computation_batch_id?: string | null
          confidence?: number
          created_at?: string
          crm_company_id?: string | null
          current_hours?: number | null
          dismissed_reason?: string | null
          drivers?: Json
          equipment_make?: string | null
          equipment_model?: string | null
          equipment_serial?: string | null
          expires_at?: string | null
          fleet_id?: string | null
          id?: string
          kit_part_count?: number
          kit_parts?: Json
          kit_value?: number
          model_version?: string
          nearest_branch_id?: string | null
          parts_in_stock?: number
          parts_total?: number
          predicted_failure_type?: string | null
          predicted_service_window?: string
          service_interval_hours?: number | null
          staged_order_id?: string | null
          status?: string
          stock_status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parts_predictive_kits_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_predictive_kits_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_predictive_kits_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "parts_predictive_kits_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "customer_fleet"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_predictive_kits_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "portal_trade_in_opportunities"
            referencedColumns: ["fleet_id"]
          },
          {
            foreignKeyName: "parts_predictive_kits_staged_order_id_fkey"
            columns: ["staged_order_id"]
            isOneToOne: false
            referencedRelation: "parts_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      parts_preferences: {
        Row: {
          created_at: string
          dark_mode: boolean
          default_queue_filter: string
          id: string
          keyboard_shortcuts_enabled: boolean
          queue_panel_collapsed: boolean
          show_fulfilled_requests: boolean
          sound_notifications: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dark_mode?: boolean
          default_queue_filter?: string
          id?: string
          keyboard_shortcuts_enabled?: boolean
          queue_panel_collapsed?: boolean
          show_fulfilled_requests?: boolean
          sound_notifications?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dark_mode?: boolean
          default_queue_filter?: string
          id?: string
          keyboard_shortcuts_enabled?: boolean
          queue_panel_collapsed?: boolean
          show_fulfilled_requests?: boolean
          sound_notifications?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      parts_pricing_audit: {
        Row: {
          applied_at: string
          applied_by: string | null
          created_at: string
          delta_dollars: number | null
          delta_pct: number | null
          id: string
          new_price: number
          note: string | null
          old_price: number | null
          part_id: string | null
          part_number: string
          price_target: Database["public"]["Enums"]["pricing_level_target"]
          rule_id: string | null
          source: string
          suggestion_id: string | null
          workspace_id: string
        }
        Insert: {
          applied_at?: string
          applied_by?: string | null
          created_at?: string
          delta_dollars?: number | null
          delta_pct?: number | null
          id?: string
          new_price: number
          note?: string | null
          old_price?: number | null
          part_id?: string | null
          part_number: string
          price_target: Database["public"]["Enums"]["pricing_level_target"]
          rule_id?: string | null
          source: string
          suggestion_id?: string | null
          workspace_id?: string
        }
        Update: {
          applied_at?: string
          applied_by?: string | null
          created_at?: string
          delta_dollars?: number | null
          delta_pct?: number | null
          id?: string
          new_price?: number
          note?: string | null
          old_price?: number | null
          part_id?: string | null
          part_number?: string
          price_target?: Database["public"]["Enums"]["pricing_level_target"]
          rule_id?: string | null
          source?: string
          suggestion_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parts_pricing_audit_applied_by_fkey"
            columns: ["applied_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_pricing_audit_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_pricing_audit_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_dead_capital"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_pricing_audit_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_embedding_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_pricing_audit_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_import_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_pricing_audit_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_intelligence"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_pricing_audit_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_margin_signal"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_pricing_audit_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_pricing_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_pricing_audit_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_stockout_risk"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_pricing_audit_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_velocity"
            referencedColumns: ["part_id"]
          },
        ]
      }
      parts_pricing_rules: {
        Row: {
          auto_apply: boolean
          created_at: string
          created_by: string | null
          description: string | null
          effective_from: string
          effective_until: string | null
          id: string
          is_active: boolean
          markup_floor_cents: number | null
          markup_multiplier: number | null
          min_margin_pct: number | null
          name: string
          price_target: Database["public"]["Enums"]["pricing_level_target"]
          priority: number
          rule_type: Database["public"]["Enums"]["pricing_rule_type"]
          scope_type: Database["public"]["Enums"]["pricing_rule_scope_type"]
          scope_value: string | null
          target_margin_pct: number | null
          tolerance_pct: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          auto_apply?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          effective_from?: string
          effective_until?: string | null
          id?: string
          is_active?: boolean
          markup_floor_cents?: number | null
          markup_multiplier?: number | null
          min_margin_pct?: number | null
          name: string
          price_target?: Database["public"]["Enums"]["pricing_level_target"]
          priority?: number
          rule_type: Database["public"]["Enums"]["pricing_rule_type"]
          scope_type: Database["public"]["Enums"]["pricing_rule_scope_type"]
          scope_value?: string | null
          target_margin_pct?: number | null
          tolerance_pct?: number
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          auto_apply?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          effective_from?: string
          effective_until?: string | null
          id?: string
          is_active?: boolean
          markup_floor_cents?: number | null
          markup_multiplier?: number | null
          min_margin_pct?: number | null
          name?: string
          price_target?: Database["public"]["Enums"]["pricing_level_target"]
          priority?: number
          rule_type?: Database["public"]["Enums"]["pricing_rule_type"]
          scope_type?: Database["public"]["Enums"]["pricing_rule_scope_type"]
          scope_value?: string | null
          target_margin_pct?: number | null
          tolerance_pct?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parts_pricing_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      parts_pricing_suggestions: {
        Row: {
          applied_at: string | null
          computation_batch_id: string | null
          created_at: string
          current_cost: number | null
          current_margin_pct: number | null
          current_sell: number | null
          delta_dollars: number | null
          delta_pct: number | null
          id: string
          part_id: string
          part_number: string
          reason: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          rule_id: string | null
          signal: string | null
          status: Database["public"]["Enums"]["pricing_suggestion_status"]
          suggested_margin_pct: number | null
          suggested_sell: number
          target_price: Database["public"]["Enums"]["pricing_level_target"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          applied_at?: string | null
          computation_batch_id?: string | null
          created_at?: string
          current_cost?: number | null
          current_margin_pct?: number | null
          current_sell?: number | null
          delta_dollars?: number | null
          delta_pct?: number | null
          id?: string
          part_id: string
          part_number: string
          reason: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rule_id?: string | null
          signal?: string | null
          status?: Database["public"]["Enums"]["pricing_suggestion_status"]
          suggested_margin_pct?: number | null
          suggested_sell: number
          target_price: Database["public"]["Enums"]["pricing_level_target"]
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          applied_at?: string | null
          computation_batch_id?: string | null
          created_at?: string
          current_cost?: number | null
          current_margin_pct?: number | null
          current_sell?: number | null
          delta_dollars?: number | null
          delta_pct?: number | null
          id?: string
          part_id?: string
          part_number?: string
          reason?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rule_id?: string | null
          signal?: string | null
          status?: Database["public"]["Enums"]["pricing_suggestion_status"]
          suggested_margin_pct?: number | null
          suggested_sell?: number
          target_price?: Database["public"]["Enums"]["pricing_level_target"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parts_pricing_suggestions_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_pricing_suggestions_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_dead_capital"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_pricing_suggestions_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_embedding_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_pricing_suggestions_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_import_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_pricing_suggestions_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_intelligence"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_pricing_suggestions_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_margin_signal"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_pricing_suggestions_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_pricing_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_pricing_suggestions_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_stockout_risk"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_pricing_suggestions_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_velocity"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_pricing_suggestions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_pricing_suggestions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "parts_pricing_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_pricing_suggestions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "v_parts_pricing_drift"
            referencedColumns: ["rule_id"]
          },
        ]
      }
      parts_reorder_profiles: {
        Row: {
          avg_lead_time_days: number
          branch_id: string
          computation_source: string
          consumption_velocity: number
          created_at: string
          economic_order_qty: number
          id: string
          last_computed_at: string
          lead_time_std_dev: number
          next_compute_at: string
          part_number: string
          reorder_point: number
          safety_factor: number
          safety_stock: number
          total_consumed: number
          updated_at: string
          velocity_window_days: number
          workspace_id: string
        }
        Insert: {
          avg_lead_time_days?: number
          branch_id: string
          computation_source?: string
          consumption_velocity?: number
          created_at?: string
          economic_order_qty?: number
          id?: string
          last_computed_at?: string
          lead_time_std_dev?: number
          next_compute_at?: string
          part_number: string
          reorder_point?: number
          safety_factor?: number
          safety_stock?: number
          total_consumed?: number
          updated_at?: string
          velocity_window_days?: number
          workspace_id?: string
        }
        Update: {
          avg_lead_time_days?: number
          branch_id?: string
          computation_source?: string
          consumption_velocity?: number
          created_at?: string
          economic_order_qty?: number
          id?: string
          last_computed_at?: string
          lead_time_std_dev?: number
          next_compute_at?: string
          part_number?: string
          reorder_point?: number
          safety_factor?: number
          safety_stock?: number
          total_consumed?: number
          updated_at?: string
          velocity_window_days?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_parts_reorder_profiles_branch"
            columns: ["workspace_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["workspace_id", "slug"]
          },
        ]
      }
      parts_replenishment_rules: {
        Row: {
          approval_user_ids: string[]
          auto_approve_max_dollars: number
          cooldown_days: number
          created_at: string
          daily_budget_cap: number
          excluded_part_numbers: string[]
          id: string
          is_enabled: boolean
          updated_at: string
          vendor_overrides: Json
          workspace_id: string
        }
        Insert: {
          approval_user_ids?: string[]
          auto_approve_max_dollars?: number
          cooldown_days?: number
          created_at?: string
          daily_budget_cap?: number
          excluded_part_numbers?: string[]
          id?: string
          is_enabled?: boolean
          updated_at?: string
          vendor_overrides?: Json
          workspace_id?: string
        }
        Update: {
          approval_user_ids?: string[]
          auto_approve_max_dollars?: number
          cooldown_days?: number
          created_at?: string
          daily_budget_cap?: number
          excluded_part_numbers?: string[]
          id?: string
          is_enabled?: boolean
          updated_at?: string
          vendor_overrides?: Json
          workspace_id?: string
        }
        Relationships: []
      }
      parts_request_activity: {
        Row: {
          action: string
          created_at: string
          from_value: string | null
          id: string
          metadata: Json | null
          notes: string | null
          request_id: string
          to_value: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          action: string
          created_at?: string
          from_value?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          request_id: string
          to_value?: string | null
          user_id: string
          workspace_id?: string
        }
        Update: {
          action?: string
          created_at?: string
          from_value?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          request_id?: string
          to_value?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parts_request_activity_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "parts_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_request_activity_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "v_parts_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      parts_requests: {
        Row: {
          assigned_to: string | null
          auto_escalated: boolean
          bay_number: string | null
          cancelled_at: string | null
          created_at: string
          customer_id: string | null
          customer_name: string | null
          escalated_at: string | null
          estimated_completion: string | null
          fulfilled_at: string | null
          id: string
          items: Json
          machine_description: string | null
          machine_profile_id: string | null
          notes: string | null
          priority: string
          request_source: string
          requested_by: string
          status: string
          updated_at: string
          work_order_number: string | null
          workspace_id: string
        }
        Insert: {
          assigned_to?: string | null
          auto_escalated?: boolean
          bay_number?: string | null
          cancelled_at?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          escalated_at?: string | null
          estimated_completion?: string | null
          fulfilled_at?: string | null
          id?: string
          items?: Json
          machine_description?: string | null
          machine_profile_id?: string | null
          notes?: string | null
          priority?: string
          request_source: string
          requested_by: string
          status?: string
          updated_at?: string
          work_order_number?: string | null
          workspace_id?: string
        }
        Update: {
          assigned_to?: string | null
          auto_escalated?: boolean
          bay_number?: string | null
          cancelled_at?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          escalated_at?: string | null
          estimated_completion?: string | null
          fulfilled_at?: string | null
          id?: string
          items?: Json
          machine_description?: string | null
          machine_profile_id?: string | null
          notes?: string | null
          priority?: string
          request_source?: string
          requested_by?: string
          status?: string
          updated_at?: string
          work_order_number?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parts_requests_machine_profile_id_fkey"
            columns: ["machine_profile_id"]
            isOneToOne: false
            referencedRelation: "machine_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      parts_transfer_recommendations: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          computation_batch_id: string | null
          confidence: number
          created_at: string
          drivers: Json
          estimated_stockout_cost_avoided: number | null
          estimated_transfer_cost: number | null
          executed_at: string | null
          expires_at: string
          from_branch_id: string
          from_qty_on_hand: number
          id: string
          model_version: string
          net_savings: number | null
          part_number: string
          priority: string
          reason: string
          recommended_qty: number
          status: string
          to_branch_id: string
          to_forecast_demand: number | null
          to_qty_on_hand: number
          to_reorder_point: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          computation_batch_id?: string | null
          confidence?: number
          created_at?: string
          drivers?: Json
          estimated_stockout_cost_avoided?: number | null
          estimated_transfer_cost?: number | null
          executed_at?: string | null
          expires_at?: string
          from_branch_id: string
          from_qty_on_hand?: number
          id?: string
          model_version?: string
          net_savings?: number | null
          part_number: string
          priority?: string
          reason: string
          recommended_qty: number
          status?: string
          to_branch_id: string
          to_forecast_demand?: number | null
          to_qty_on_hand?: number
          to_reorder_point?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          computation_batch_id?: string | null
          confidence?: number
          created_at?: string
          drivers?: Json
          estimated_stockout_cost_avoided?: number | null
          estimated_transfer_cost?: number | null
          executed_at?: string | null
          expires_at?: string
          from_branch_id?: string
          from_qty_on_hand?: number
          id?: string
          model_version?: string
          net_savings?: number | null
          part_number?: string
          priority?: string
          reason?: string
          recommended_qty?: number
          status?: string
          to_branch_id?: string
          to_forecast_demand?: number | null
          to_qty_on_hand?: number
          to_reorder_point?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parts_transfer_recommendations_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      parts_vendor_prices: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          description_fr: string | null
          effective_date: string
          id: string
          list_price: number | null
          part_number: string
          product_code: string | null
          source_file: string | null
          source_import_run_id: string | null
          updated_at: string
          vendor_code: string | null
          vendor_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          description?: string | null
          description_fr?: string | null
          effective_date?: string
          id?: string
          list_price?: number | null
          part_number: string
          product_code?: string | null
          source_file?: string | null
          source_import_run_id?: string | null
          updated_at?: string
          vendor_code?: string | null
          vendor_id: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          description_fr?: string | null
          effective_date?: string
          id?: string
          list_price?: number | null
          part_number?: string
          product_code?: string | null
          source_file?: string | null
          source_import_run_id?: string | null
          updated_at?: string
          vendor_code?: string | null
          vendor_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parts_vendor_prices_run_fk"
            columns: ["source_import_run_id"]
            isOneToOne: false
            referencedRelation: "parts_import_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_vendor_prices_run_fk"
            columns: ["source_import_run_id"]
            isOneToOne: false
            referencedRelation: "v_parts_import_drift"
            referencedColumns: ["last_import_run_id"]
          },
          {
            foreignKeyName: "parts_vendor_prices_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_health_scorecard"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "parts_vendor_prices_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_validations: {
        Row: {
          amount: number
          attempt_outcome: string | null
          created_at: string
          customer_id: string | null
          daily_check_total: number | null
          exception_reason: string | null
          id: string
          invoice_reference: string | null
          is_delivery_day: boolean | null
          override_by: string | null
          override_reason: string | null
          passed: boolean
          payment_type: string
          required_approver_role: string | null
          rule_applied: string | null
          transaction_type: string | null
          validation_date: string
          workspace_id: string
        }
        Insert: {
          amount: number
          attempt_outcome?: string | null
          created_at?: string
          customer_id?: string | null
          daily_check_total?: number | null
          exception_reason?: string | null
          id?: string
          invoice_reference?: string | null
          is_delivery_day?: boolean | null
          override_by?: string | null
          override_reason?: string | null
          passed: boolean
          payment_type: string
          required_approver_role?: string | null
          rule_applied?: string | null
          transaction_type?: string | null
          validation_date?: string
          workspace_id?: string
        }
        Update: {
          amount?: number
          attempt_outcome?: string | null
          created_at?: string
          customer_id?: string | null
          daily_check_total?: number | null
          exception_reason?: string | null
          id?: string
          invoice_reference?: string | null
          is_delivery_day?: boolean | null
          override_by?: string | null
          override_reason?: string | null
          passed?: boolean
          payment_type?: string
          required_approver_role?: string | null
          rule_applied?: string | null
          transaction_type?: string | null
          validation_date?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_validations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_validations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_validations_override_by_fkey"
            columns: ["override_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_customer_notifications: {
        Row: {
          body: string
          category: string
          channel: string
          created_at: string
          dedupe_key: string
          event_type: string
          id: string
          metadata: Json
          portal_customer_id: string
          related_entity_id: string | null
          related_entity_type: string | null
          sent_at: string
          title: string
          workspace_id: string
        }
        Insert: {
          body: string
          category: string
          channel: string
          created_at?: string
          dedupe_key: string
          event_type: string
          id?: string
          metadata?: Json
          portal_customer_id: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          sent_at?: string
          title: string
          workspace_id?: string
        }
        Update: {
          body?: string
          category?: string
          channel?: string
          created_at?: string
          dedupe_key?: string
          event_type?: string
          id?: string
          metadata?: Json
          portal_customer_id?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          sent_at?: string
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_customer_notifications_portal_customer_id_fkey"
            columns: ["portal_customer_id"]
            isOneToOne: false
            referencedRelation: "portal_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_customers: {
        Row: {
          auth_user_id: string | null
          created_at: string
          crm_company_id: string | null
          crm_contact_id: string | null
          default_branch: string | null
          email: string
          first_name: string
          id: string
          is_active: boolean
          job_title: string | null
          last_login_at: string | null
          last_name: string
          notification_preferences: Json | null
          phone: string | null
          portal_role: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          crm_company_id?: string | null
          crm_contact_id?: string | null
          default_branch?: string | null
          email: string
          first_name: string
          id?: string
          is_active?: boolean
          job_title?: string | null
          last_login_at?: string | null
          last_name: string
          notification_preferences?: Json | null
          phone?: string | null
          portal_role?: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          crm_company_id?: string | null
          crm_contact_id?: string | null
          default_branch?: string | null
          email?: string
          first_name?: string
          id?: string
          is_active?: boolean
          job_title?: string | null
          last_login_at?: string | null
          last_name?: string
          notification_preferences?: Json | null
          phone?: string | null
          portal_role?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_customers_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_customers_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_customers_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "portal_customers_crm_contact_id_fkey"
            columns: ["crm_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_customers_crm_contact_id_fkey"
            columns: ["crm_contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_payment_intents: {
        Row: {
          amount_cents: number
          company_id: string
          created_at: string
          created_by: string | null
          currency: string
          customer_email: string | null
          failed_at: string | null
          failure_reason: string | null
          id: string
          invoice_id: string | null
          metadata: Json
          status: string
          stripe_payment_intent_id: string
          succeeded_at: string | null
          updated_at: string
          webhook_signature_verified: boolean
          workspace_id: string
        }
        Insert: {
          amount_cents: number
          company_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_email?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          invoice_id?: string | null
          metadata?: Json
          status?: string
          stripe_payment_intent_id: string
          succeeded_at?: string | null
          updated_at?: string
          webhook_signature_verified?: boolean
          workspace_id?: string
        }
        Update: {
          amount_cents?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_email?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          invoice_id?: string | null
          metadata?: Json
          status?: string
          stripe_payment_intent_id?: string
          succeeded_at?: string | null
          updated_at?: string
          webhook_signature_verified?: boolean
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_payment_intents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_payment_intents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_payment_intents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "portal_payment_intents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_quote_review_versions: {
        Row: {
          created_at: string
          customer_request_snapshot: string | null
          dealer_message: string | null
          id: string
          is_current: boolean
          portal_quote_review_id: string
          published_at: string
          published_by: string | null
          quote_data: Json
          quote_pdf_url: string | null
          revision_summary: string | null
          version_number: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          customer_request_snapshot?: string | null
          dealer_message?: string | null
          id?: string
          is_current?: boolean
          portal_quote_review_id: string
          published_at?: string
          published_by?: string | null
          quote_data?: Json
          quote_pdf_url?: string | null
          revision_summary?: string | null
          version_number: number
          workspace_id?: string
        }
        Update: {
          created_at?: string
          customer_request_snapshot?: string | null
          dealer_message?: string | null
          id?: string
          is_current?: boolean
          portal_quote_review_id?: string
          published_at?: string
          published_by?: string | null
          quote_data?: Json
          quote_pdf_url?: string | null
          revision_summary?: string | null
          version_number?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_quote_review_versions_portal_quote_review_id_fkey"
            columns: ["portal_quote_review_id"]
            isOneToOne: false
            referencedRelation: "portal_quote_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_quote_review_versions_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_quote_reviews: {
        Row: {
          counter_notes: string | null
          created_at: string
          deal_id: string | null
          expires_at: string | null
          id: string
          portal_customer_id: string
          quote_data: Json | null
          quote_pdf_url: string | null
          service_quote_id: string | null
          signature_url: string | null
          signed_at: string | null
          signer_ip: string | null
          signer_name: string | null
          status: string
          updated_at: string
          viewed_at: string | null
          workspace_id: string
        }
        Insert: {
          counter_notes?: string | null
          created_at?: string
          deal_id?: string | null
          expires_at?: string | null
          id?: string
          portal_customer_id: string
          quote_data?: Json | null
          quote_pdf_url?: string | null
          service_quote_id?: string | null
          signature_url?: string | null
          signed_at?: string | null
          signer_ip?: string | null
          signer_name?: string | null
          status?: string
          updated_at?: string
          viewed_at?: string | null
          workspace_id?: string
        }
        Update: {
          counter_notes?: string | null
          created_at?: string
          deal_id?: string | null
          expires_at?: string | null
          id?: string
          portal_customer_id?: string
          quote_data?: Json | null
          quote_pdf_url?: string | null
          service_quote_id?: string | null
          signature_url?: string | null
          signed_at?: string | null
          signer_ip?: string | null
          signer_name?: string | null
          status?: string
          updated_at?: string
          viewed_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_quote_reviews_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_quote_reviews_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_quote_reviews_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_quote_reviews_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_quote_reviews_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_quote_reviews_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "portal_quote_reviews_portal_customer_id_fkey"
            columns: ["portal_customer_id"]
            isOneToOne: false
            referencedRelation: "portal_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_quote_reviews_service_quote_id_fkey"
            columns: ["service_quote_id"]
            isOneToOne: false
            referencedRelation: "service_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_quote_revision_drafts: {
        Row: {
          approved_by: string | null
          compare_snapshot: Json | null
          created_at: string
          customer_request_snapshot: string | null
          deal_id: string
          dealer_message: string | null
          id: string
          portal_quote_review_id: string
          prepared_by: string | null
          published_at: string | null
          quote_data: Json
          quote_package_id: string
          quote_pdf_url: string | null
          revision_summary: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          approved_by?: string | null
          compare_snapshot?: Json | null
          created_at?: string
          customer_request_snapshot?: string | null
          deal_id: string
          dealer_message?: string | null
          id?: string
          portal_quote_review_id: string
          prepared_by?: string | null
          published_at?: string | null
          quote_data?: Json
          quote_package_id: string
          quote_pdf_url?: string | null
          revision_summary?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          approved_by?: string | null
          compare_snapshot?: Json | null
          created_at?: string
          customer_request_snapshot?: string | null
          deal_id?: string
          dealer_message?: string | null
          id?: string
          portal_quote_review_id?: string
          prepared_by?: string | null
          published_at?: string | null
          quote_data?: Json
          quote_package_id?: string
          quote_pdf_url?: string | null
          revision_summary?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_quote_revision_drafts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_quote_revision_drafts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_quote_revision_drafts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_quote_revision_drafts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_quote_revision_drafts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_quote_revision_drafts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_quote_revision_drafts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "portal_quote_revision_drafts_portal_quote_review_id_fkey"
            columns: ["portal_quote_review_id"]
            isOneToOne: false
            referencedRelation: "portal_quote_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_quote_revision_drafts_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_quote_revision_drafts_quote_package_id_fkey"
            columns: ["quote_package_id"]
            isOneToOne: false
            referencedRelation: "price_change_impact"
            referencedColumns: ["quote_package_id"]
          },
          {
            foreignKeyName: "portal_quote_revision_drafts_quote_package_id_fkey"
            columns: ["quote_package_id"]
            isOneToOne: false
            referencedRelation: "quote_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_warranty_claims: {
        Row: {
          claim_type: string
          created_at: string
          description: string
          fleet_id: string | null
          id: string
          photos: Json | null
          portal_customer_id: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          submitted_at: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          claim_type: string
          created_at?: string
          description: string
          fleet_id?: string | null
          id?: string
          photos?: Json | null
          portal_customer_id: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          claim_type?: string
          created_at?: string
          description?: string
          fleet_id?: string | null
          id?: string
          photos?: Json | null
          portal_customer_id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_warranty_claims_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "customer_fleet"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_warranty_claims_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "portal_trade_in_opportunities"
            referencedColumns: ["fleet_id"]
          },
          {
            foreignKeyName: "portal_warranty_claims_portal_customer_id_fkey"
            columns: ["portal_customer_id"]
            isOneToOne: false
            referencedRelation: "portal_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_warranty_claims_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      post_sale_parts_playbooks: {
        Row: {
          accepted_at: string | null
          assigned_rep_id: string | null
          company_id: string | null
          created_at: string
          deal_id: string
          deleted_at: string | null
          equipment_id: string | null
          generated_by: string | null
          generation_batch_id: string | null
          id: string
          machine_profile_id: string | null
          payload: Json
          reviewed_at: string | null
          reviewed_by: string | null
          sent_at: string | null
          sent_to_email: string | null
          status: string
          tokens_in: number | null
          tokens_out: number | null
          total_revenue: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          assigned_rep_id?: string | null
          company_id?: string | null
          created_at?: string
          deal_id: string
          deleted_at?: string | null
          equipment_id?: string | null
          generated_by?: string | null
          generation_batch_id?: string | null
          id?: string
          machine_profile_id?: string | null
          payload?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          sent_at?: string | null
          sent_to_email?: string | null
          status?: string
          tokens_in?: number | null
          tokens_out?: number | null
          total_revenue?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          assigned_rep_id?: string | null
          company_id?: string | null
          created_at?: string
          deal_id?: string
          deleted_at?: string | null
          equipment_id?: string | null
          generated_by?: string | null
          generation_batch_id?: string | null
          id?: string
          machine_profile_id?: string | null
          payload?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          sent_at?: string | null
          sent_to_email?: string | null
          status?: string
          tokens_in?: number | null
          tokens_out?: number | null
          total_revenue?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_sale_parts_playbooks_assigned_rep_id_fkey"
            columns: ["assigned_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_sale_parts_playbooks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_sale_parts_playbooks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_sale_parts_playbooks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "post_sale_parts_playbooks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_sale_parts_playbooks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_sale_parts_playbooks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_sale_parts_playbooks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_sale_parts_playbooks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_sale_parts_playbooks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "post_sale_parts_playbooks_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_sale_parts_playbooks_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "post_sale_parts_playbooks_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_sale_parts_playbooks_machine_profile_id_fkey"
            columns: ["machine_profile_id"]
            isOneToOne: false
            referencedRelation: "machine_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_sale_parts_playbooks_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      predicted_parts_plays: {
        Row: {
          action_note: string | null
          actioned_at: string | null
          actioned_by: string | null
          computation_batch_id: string | null
          created_at: string
          current_on_hand: number | null
          fleet_id: string | null
          id: string
          input_signals: Json
          llm_cost_usd_cents: number | null
          llm_model: string | null
          llm_reasoning: string | null
          machine_profile_id: string | null
          part_description: string | null
          part_id: string | null
          part_number: string
          portal_customer_id: string
          probability: number
          projected_due_date: string
          projected_revenue: number | null
          projection_window: string
          reason: string
          recommended_order_qty: number | null
          signal_type: string
          status: string
          suggested_order_by: string | null
          suggested_vendor_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          action_note?: string | null
          actioned_at?: string | null
          actioned_by?: string | null
          computation_batch_id?: string | null
          created_at?: string
          current_on_hand?: number | null
          fleet_id?: string | null
          id?: string
          input_signals?: Json
          llm_cost_usd_cents?: number | null
          llm_model?: string | null
          llm_reasoning?: string | null
          machine_profile_id?: string | null
          part_description?: string | null
          part_id?: string | null
          part_number: string
          portal_customer_id: string
          probability?: number
          projected_due_date: string
          projected_revenue?: number | null
          projection_window: string
          reason: string
          recommended_order_qty?: number | null
          signal_type: string
          status?: string
          suggested_order_by?: string | null
          suggested_vendor_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          action_note?: string | null
          actioned_at?: string | null
          actioned_by?: string | null
          computation_batch_id?: string | null
          created_at?: string
          current_on_hand?: number | null
          fleet_id?: string | null
          id?: string
          input_signals?: Json
          llm_cost_usd_cents?: number | null
          llm_model?: string | null
          llm_reasoning?: string | null
          machine_profile_id?: string | null
          part_description?: string | null
          part_id?: string | null
          part_number?: string
          portal_customer_id?: string
          probability?: number
          projected_due_date?: string
          projected_revenue?: number | null
          projection_window?: string
          reason?: string
          recommended_order_qty?: number | null
          signal_type?: string
          status?: string
          suggested_order_by?: string | null
          suggested_vendor_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "predicted_parts_plays_actioned_by_fkey"
            columns: ["actioned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "customer_fleet"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "portal_trade_in_opportunities"
            referencedColumns: ["fleet_id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_machine_profile_id_fkey"
            columns: ["machine_profile_id"]
            isOneToOne: false
            referencedRelation: "machine_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_dead_capital"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_embedding_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_import_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_intelligence"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_margin_signal"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_pricing_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_stockout_risk"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_velocity"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_portal_customer_id_fkey"
            columns: ["portal_customer_id"]
            isOneToOne: false
            referencedRelation: "portal_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_suggested_vendor_id_fkey"
            columns: ["suggested_vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_health_scorecard"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_suggested_vendor_id_fkey"
            columns: ["suggested_vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      predictive_visit_lists: {
        Row: {
          created_at: string
          generated_at: string
          generation_context: Json | null
          generation_model: string | null
          id: string
          list_date: string
          recommendations: Json
          rep_id: string
          visits_completed: number | null
          visits_total: number | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          generated_at?: string
          generation_context?: Json | null
          generation_model?: string | null
          id?: string
          list_date?: string
          recommendations?: Json
          rep_id: string
          visits_completed?: number | null
          visits_total?: number | null
          workspace_id?: string
        }
        Update: {
          created_at?: string
          generated_at?: string
          generation_context?: Json | null
          generation_model?: string | null
          id?: string
          list_date?: string
          recommendations?: Json
          rep_id?: string
          visits_completed?: number | null
          visits_total?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "predictive_visit_lists_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      price_increase_tracking: {
        Row: {
          announcement_date: string | null
          created_at: string
          effective_date: string
          id: string
          increase_pct: number
          manufacturer: string
          notes: string | null
          source: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          announcement_date?: string | null
          created_at?: string
          effective_date: string
          id?: string
          increase_pct: number
          manufacturer: string
          notes?: string | null
          source?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          announcement_date?: string | null
          created_at?: string
          effective_date?: string
          id?: string
          increase_pct?: number
          manufacturer?: string
          notes?: string | null
          source?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      pricing_persona_models: {
        Row: {
          accuracy_score: number | null
          config: Json | null
          created_at: string
          id: string
          is_active: boolean
          model_name: string
          model_type: string
          model_version: string
          notes: string | null
          precision_score: number | null
          recall_score: number | null
          training_date: string | null
          training_samples: number | null
          updated_at: string
        }
        Insert: {
          accuracy_score?: number | null
          config?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          model_name: string
          model_type: string
          model_version: string
          notes?: string | null
          precision_score?: number | null
          recall_score?: number | null
          training_date?: string | null
          training_samples?: number | null
          updated_at?: string
        }
        Update: {
          accuracy_score?: number | null
          config?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          model_name?: string
          model_type?: string
          model_version?: string
          notes?: string | null
          precision_score?: number | null
          recall_score?: number | null
          training_date?: string | null
          training_samples?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      profile_role_blend: {
        Row: {
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          iron_role: string
          profile_id: string
          reason: string | null
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          iron_role: string
          profile_id: string
          reason?: string | null
          updated_at?: string
          weight: number
        }
        Update: {
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          iron_role?: string
          profile_id?: string
          reason?: string | null
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "profile_role_blend_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_workspaces: {
        Row: {
          created_at: string
          profile_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          profile_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          profile_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_workspaces_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_workspace_id: string
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          iron_role: string | null
          iron_role_display: string | null
          is_active: boolean
          is_support: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          active_workspace_id?: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          iron_role?: string | null
          iron_role_display?: string | null
          is_active?: boolean
          is_support?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          active_workspace_id?: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          iron_role?: string | null
          iron_role_display?: string | null
          is_active?: boolean
          is_support?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      prospecting_kpis: {
        Row: {
          consecutive_days_met: number | null
          created_at: string
          id: string
          kpi_date: string
          opportunities_created: number | null
          positive_visits: number | null
          quotes_generated: number | null
          rep_id: string
          target: number | null
          target_met: boolean | null
          total_visits: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          consecutive_days_met?: number | null
          created_at?: string
          id?: string
          kpi_date?: string
          opportunities_created?: number | null
          positive_visits?: number | null
          quotes_generated?: number | null
          rep_id: string
          target?: number | null
          target_met?: boolean | null
          total_visits?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          consecutive_days_met?: number | null
          created_at?: string
          id?: string
          kpi_date?: string
          opportunities_created?: number | null
          positive_visits?: number | null
          quotes_generated?: number | null
          rep_id?: string
          target?: number | null
          target_met?: boolean | null
          total_visits?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospecting_kpis_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prospecting_visits: {
        Row: {
          company_id: string | null
          competitive_equipment_on_site: string | null
          contact_id: string | null
          contact_name: string | null
          contact_role: string | null
          conversation_summary: string | null
          created_at: string
          deal_id: string | null
          equipment_discussion: boolean | null
          follow_up_date: string | null
          followed_up_on_active_deal: boolean | null
          id: string
          identified_need_or_opportunity: boolean | null
          is_positive: boolean | null
          location_lat: number | null
          location_lng: number | null
          location_name: string | null
          next_action: string | null
          opportunities_identified: string | null
          rep_id: string
          spoke_with_decision_maker: boolean | null
          visit_date: string
          voice_capture_id: string | null
          workspace_id: string
        }
        Insert: {
          company_id?: string | null
          competitive_equipment_on_site?: string | null
          contact_id?: string | null
          contact_name?: string | null
          contact_role?: string | null
          conversation_summary?: string | null
          created_at?: string
          deal_id?: string | null
          equipment_discussion?: boolean | null
          follow_up_date?: string | null
          followed_up_on_active_deal?: boolean | null
          id?: string
          identified_need_or_opportunity?: boolean | null
          is_positive?: boolean | null
          location_lat?: number | null
          location_lng?: number | null
          location_name?: string | null
          next_action?: string | null
          opportunities_identified?: string | null
          rep_id: string
          spoke_with_decision_maker?: boolean | null
          visit_date?: string
          voice_capture_id?: string | null
          workspace_id?: string
        }
        Update: {
          company_id?: string | null
          competitive_equipment_on_site?: string | null
          contact_id?: string | null
          contact_name?: string | null
          contact_role?: string | null
          conversation_summary?: string | null
          created_at?: string
          deal_id?: string | null
          equipment_discussion?: boolean | null
          follow_up_date?: string | null
          followed_up_on_active_deal?: boolean | null
          id?: string
          identified_need_or_opportunity?: boolean | null
          is_positive?: boolean | null
          location_lat?: number | null
          location_lng?: number | null
          location_name?: string | null
          next_action?: string | null
          opportunities_identified?: string | null
          rep_id?: string
          spoke_with_decision_maker?: boolean | null
          visit_date?: string
          voice_capture_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospecting_visits_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_visits_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_visits_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "prospecting_visits_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_visits_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_visits_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_visits_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_visits_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_visits_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_visits_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_visits_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "prospecting_visits_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospecting_visits_voice_capture_id_fkey"
            columns: ["voice_capture_id"]
            isOneToOne: false
            referencedRelation: "voice_captures"
            referencedColumns: ["id"]
          },
        ]
      }
      qb_ai_request_log: {
        Row: {
          confidence: Json | null
          created_at: string
          customer_type: string | null
          delivery_state: string | null
          error: string | null
          id: string
          latency_ms: number | null
          model_candidates: Json | null
          prompt_source: string
          raw_prompt: string
          resolved_brand_id: string | null
          resolved_model_id: string | null
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          confidence?: Json | null
          created_at?: string
          customer_type?: string | null
          delivery_state?: string | null
          error?: string | null
          id?: string
          latency_ms?: number | null
          model_candidates?: Json | null
          prompt_source?: string
          raw_prompt: string
          resolved_brand_id?: string | null
          resolved_model_id?: string | null
          user_id?: string | null
          workspace_id?: string
        }
        Update: {
          confidence?: Json | null
          created_at?: string
          customer_type?: string | null
          delivery_state?: string | null
          error?: string | null
          id?: string
          latency_ms?: number | null
          model_candidates?: Json | null
          prompt_source?: string
          raw_prompt?: string
          resolved_brand_id?: string | null
          resolved_model_id?: string | null
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qb_ai_request_log_resolved_brand_id_fkey"
            columns: ["resolved_brand_id"]
            isOneToOne: false
            referencedRelation: "qb_brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_ai_request_log_resolved_model_id_fkey"
            columns: ["resolved_model_id"]
            isOneToOne: false
            referencedRelation: "qb_equipment_models"
            referencedColumns: ["id"]
          },
        ]
      }
      qb_attachments: {
        Row: {
          acquired_at: string | null
          active: boolean
          attachment_type: string | null
          brand_id: string | null
          category: string | null
          compatible_model_ids: string[] | null
          created_at: string
          deleted_at: string | null
          freight_cents: number | null
          id: string
          list_price_cents: number
          name: string
          part_number: string
          specs: Json | null
          universal: boolean
          updated_at: string
          workspace_id: string
        }
        Insert: {
          acquired_at?: string | null
          active?: boolean
          attachment_type?: string | null
          brand_id?: string | null
          category?: string | null
          compatible_model_ids?: string[] | null
          created_at?: string
          deleted_at?: string | null
          freight_cents?: number | null
          id?: string
          list_price_cents: number
          name: string
          part_number: string
          specs?: Json | null
          universal?: boolean
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          acquired_at?: string | null
          active?: boolean
          attachment_type?: string | null
          brand_id?: string | null
          category?: string | null
          compatible_model_ids?: string[] | null
          created_at?: string
          deleted_at?: string | null
          freight_cents?: number | null
          id?: string
          list_price_cents?: number
          name?: string
          part_number?: string
          specs?: Json | null
          universal?: boolean
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qb_attachments_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "qb_brands"
            referencedColumns: ["id"]
          },
        ]
      }
      qb_attachments_audit: {
        Row: {
          action: string
          actor_id: string | null
          changed_fields: Json | null
          created_at: string
          id: string
          record_id: string
          snapshot: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          changed_fields?: Json | null
          created_at?: string
          id?: string
          record_id: string
          snapshot?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          changed_fields?: Json | null
          created_at?: string
          id?: string
          record_id?: string
          snapshot?: Json | null
        }
        Relationships: []
      }
      qb_brands: {
        Row: {
          attachment_markup_pct: number
          category: string | null
          code: string
          created_at: string
          dealer_discount_pct: number
          default_markup_pct: number
          discount_configured: boolean
          good_faith_pct: number
          has_inbound_freight_key: boolean
          id: string
          markup_floor_pct: number
          name: string
          notes: string | null
          pdi_default_cents: number
          tariff_pct: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          attachment_markup_pct?: number
          category?: string | null
          code: string
          created_at?: string
          dealer_discount_pct?: number
          default_markup_pct: number
          discount_configured?: boolean
          good_faith_pct?: number
          has_inbound_freight_key?: boolean
          id?: string
          markup_floor_pct?: number
          name: string
          notes?: string | null
          pdi_default_cents?: number
          tariff_pct?: number
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          attachment_markup_pct?: number
          category?: string | null
          code?: string
          created_at?: string
          dealer_discount_pct?: number
          default_markup_pct?: number
          discount_configured?: boolean
          good_faith_pct?: number
          has_inbound_freight_key?: boolean
          id?: string
          markup_floor_pct?: number
          name?: string
          notes?: string | null
          pdi_default_cents?: number
          tariff_pct?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      qb_brands_audit: {
        Row: {
          action: string
          actor_id: string | null
          changed_fields: Json | null
          created_at: string
          id: string
          record_id: string
          snapshot: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          changed_fields?: Json | null
          created_at?: string
          id?: string
          record_id: string
          snapshot?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          changed_fields?: Json | null
          created_at?: string
          id?: string
          record_id?: string
          snapshot?: Json | null
        }
        Relationships: []
      }
      qb_deals: {
        Row: {
          applied_program_ids: string[] | null
          close_date: string | null
          commission_cents: number | null
          commission_paid: boolean
          commission_paid_at: string | null
          commission_rate_pct: number
          company_id: string
          created_at: string
          crm_deal_id: string | null
          deal_number: string
          deleted_at: string | null
          delivery_date: string | null
          gross_margin_cents: number
          gross_margin_pct: number
          id: string
          invoice_number: string | null
          lost_reason: string | null
          quote_id: string | null
          rebate_filed_at: string | null
          rebate_filed_by: string | null
          rebate_filing_due_date: string | null
          salesman_id: string
          status: string
          total_cost_cents: number
          total_revenue_cents: number
          updated_at: string
          warranty_registration_date: string | null
          won_reason: string | null
          workspace_id: string
        }
        Insert: {
          applied_program_ids?: string[] | null
          close_date?: string | null
          commission_cents?: number | null
          commission_paid?: boolean
          commission_paid_at?: string | null
          commission_rate_pct?: number
          company_id: string
          created_at?: string
          crm_deal_id?: string | null
          deal_number?: string
          deleted_at?: string | null
          delivery_date?: string | null
          gross_margin_cents: number
          gross_margin_pct: number
          id?: string
          invoice_number?: string | null
          lost_reason?: string | null
          quote_id?: string | null
          rebate_filed_at?: string | null
          rebate_filed_by?: string | null
          rebate_filing_due_date?: string | null
          salesman_id: string
          status?: string
          total_cost_cents: number
          total_revenue_cents: number
          updated_at?: string
          warranty_registration_date?: string | null
          won_reason?: string | null
          workspace_id?: string
        }
        Update: {
          applied_program_ids?: string[] | null
          close_date?: string | null
          commission_cents?: number | null
          commission_paid?: boolean
          commission_paid_at?: string | null
          commission_rate_pct?: number
          company_id?: string
          created_at?: string
          crm_deal_id?: string | null
          deal_number?: string
          deleted_at?: string | null
          delivery_date?: string | null
          gross_margin_cents?: number
          gross_margin_pct?: number
          id?: string
          invoice_number?: string | null
          lost_reason?: string | null
          quote_id?: string | null
          rebate_filed_at?: string | null
          rebate_filed_by?: string | null
          rebate_filing_due_date?: string | null
          salesman_id?: string
          status?: string
          total_cost_cents?: number
          total_revenue_cents?: number
          updated_at?: string
          warranty_registration_date?: string | null
          won_reason?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qb_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "qb_deals_crm_deal_id_fkey"
            columns: ["crm_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_deals_crm_deal_id_fkey"
            columns: ["crm_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_deals_crm_deal_id_fkey"
            columns: ["crm_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_deals_crm_deal_id_fkey"
            columns: ["crm_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_deals_crm_deal_id_fkey"
            columns: ["crm_deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_deals_crm_deal_id_fkey"
            columns: ["crm_deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "qb_deals_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "qb_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      qb_deals_audit: {
        Row: {
          action: string
          actor_id: string | null
          changed_fields: Json | null
          created_at: string
          id: string
          record_id: string
          snapshot: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          changed_fields?: Json | null
          created_at?: string
          id?: string
          record_id: string
          snapshot?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          changed_fields?: Json | null
          created_at?: string
          id?: string
          record_id?: string
          snapshot?: Json | null
        }
        Relationships: []
      }
      qb_equipment_models: {
        Row: {
          active: boolean
          aged_inventory_model_year: number | null
          brand_id: string
          created_at: string
          deleted_at: string | null
          family: string | null
          horsepower: number | null
          id: string
          list_price_cents: number
          model_code: string
          model_year: number | null
          name_display: string
          series: string | null
          specs: Json | null
          standard_config: string | null
          updated_at: string
          weight_lbs: number | null
          workspace_id: string
        }
        Insert: {
          active?: boolean
          aged_inventory_model_year?: number | null
          brand_id: string
          created_at?: string
          deleted_at?: string | null
          family?: string | null
          horsepower?: number | null
          id?: string
          list_price_cents: number
          model_code: string
          model_year?: number | null
          name_display: string
          series?: string | null
          specs?: Json | null
          standard_config?: string | null
          updated_at?: string
          weight_lbs?: number | null
          workspace_id?: string
        }
        Update: {
          active?: boolean
          aged_inventory_model_year?: number | null
          brand_id?: string
          created_at?: string
          deleted_at?: string | null
          family?: string | null
          horsepower?: number | null
          id?: string
          list_price_cents?: number
          model_code?: string
          model_year?: number | null
          name_display?: string
          series?: string | null
          specs?: Json | null
          standard_config?: string | null
          updated_at?: string
          weight_lbs?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qb_equipment_models_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "qb_brands"
            referencedColumns: ["id"]
          },
        ]
      }
      qb_equipment_models_audit: {
        Row: {
          action: string
          actor_id: string | null
          changed_fields: Json | null
          created_at: string
          id: string
          record_id: string
          snapshot: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          changed_fields?: Json | null
          created_at?: string
          id?: string
          record_id: string
          snapshot?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          changed_fields?: Json | null
          created_at?: string
          id?: string
          record_id?: string
          snapshot?: Json | null
        }
        Relationships: []
      }
      qb_freight_zones: {
        Row: {
          brand_id: string
          created_at: string
          effective_from: string | null
          effective_to: string | null
          freight_large_cents: number
          freight_small_cents: number
          id: string
          state_codes: string[]
          workspace_id: string
          zone_name: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          freight_large_cents: number
          freight_small_cents: number
          id?: string
          state_codes: string[]
          workspace_id?: string
          zone_name: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          freight_large_cents?: number
          freight_small_cents?: number
          id?: string
          state_codes?: string[]
          workspace_id?: string
          zone_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "qb_freight_zones_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "qb_brands"
            referencedColumns: ["id"]
          },
        ]
      }
      qb_internal_freight_rules: {
        Row: {
          created_at: string
          distance_from_miles: number | null
          distance_to_miles: number | null
          id: string
          priority: number
          rate_amount_cents: number
          rate_type: string
          updated_at: string
          weight_from_lbs: number | null
          weight_to_lbs: number | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          distance_from_miles?: number | null
          distance_to_miles?: number | null
          id?: string
          priority?: number
          rate_amount_cents: number
          rate_type: string
          updated_at?: string
          weight_from_lbs?: number | null
          weight_to_lbs?: number | null
          workspace_id?: string
        }
        Update: {
          created_at?: string
          distance_from_miles?: number | null
          distance_to_miles?: number | null
          id?: string
          priority?: number
          rate_amount_cents?: number
          rate_type?: string
          updated_at?: string
          weight_from_lbs?: number | null
          weight_to_lbs?: number | null
          workspace_id?: string
        }
        Relationships: []
      }
      qb_notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          metadata: Json | null
          read_at: string | null
          title: string
          type: string
          updated_at: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          metadata?: Json | null
          read_at?: string | null
          title: string
          type: string
          updated_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          read_at?: string | null
          title?: string
          type?: string
          updated_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      qb_price_sheet_items: {
        Row: {
          action: string
          applied_at: string | null
          confidence: number | null
          created_at: string
          diff: Json | null
          extracted: Json
          extraction_metadata: Json | null
          id: string
          item_type: string
          price_sheet_id: string
          proposed_attachment_id: string | null
          proposed_model_id: string | null
          review_status: string
          reviewer_notes: string | null
          workspace_id: string
        }
        Insert: {
          action: string
          applied_at?: string | null
          confidence?: number | null
          created_at?: string
          diff?: Json | null
          extracted: Json
          extraction_metadata?: Json | null
          id?: string
          item_type: string
          price_sheet_id: string
          proposed_attachment_id?: string | null
          proposed_model_id?: string | null
          review_status?: string
          reviewer_notes?: string | null
          workspace_id?: string
        }
        Update: {
          action?: string
          applied_at?: string | null
          confidence?: number | null
          created_at?: string
          diff?: Json | null
          extracted?: Json
          extraction_metadata?: Json | null
          id?: string
          item_type?: string
          price_sheet_id?: string
          proposed_attachment_id?: string | null
          proposed_model_id?: string | null
          review_status?: string
          reviewer_notes?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qb_price_sheet_items_price_sheet_id_fkey"
            columns: ["price_sheet_id"]
            isOneToOne: false
            referencedRelation: "qb_price_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_price_sheet_items_proposed_attachment_id_fkey"
            columns: ["proposed_attachment_id"]
            isOneToOne: false
            referencedRelation: "qb_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_price_sheet_items_proposed_model_id_fkey"
            columns: ["proposed_model_id"]
            isOneToOne: false
            referencedRelation: "qb_equipment_models"
            referencedColumns: ["id"]
          },
        ]
      }
      qb_price_sheet_programs: {
        Row: {
          action: string
          applied_at: string | null
          confidence: number | null
          created_at: string
          diff: Json | null
          extracted: Json
          extraction_metadata: Json | null
          id: string
          price_sheet_id: string
          program_code: string
          program_type: string
          proposed_program_id: string | null
          review_status: string
          reviewer_notes: string | null
          workspace_id: string
        }
        Insert: {
          action: string
          applied_at?: string | null
          confidence?: number | null
          created_at?: string
          diff?: Json | null
          extracted: Json
          extraction_metadata?: Json | null
          id?: string
          price_sheet_id: string
          program_code: string
          program_type: string
          proposed_program_id?: string | null
          review_status?: string
          reviewer_notes?: string | null
          workspace_id?: string
        }
        Update: {
          action?: string
          applied_at?: string | null
          confidence?: number | null
          created_at?: string
          diff?: Json | null
          extracted?: Json
          extraction_metadata?: Json | null
          id?: string
          price_sheet_id?: string
          program_code?: string
          program_type?: string
          proposed_program_id?: string | null
          review_status?: string
          reviewer_notes?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qb_price_sheet_programs_price_sheet_id_fkey"
            columns: ["price_sheet_id"]
            isOneToOne: false
            referencedRelation: "qb_price_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_price_sheet_programs_proposed_program_id_fkey"
            columns: ["proposed_program_id"]
            isOneToOne: false
            referencedRelation: "qb_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      qb_price_sheets: {
        Row: {
          brand_id: string | null
          created_at: string
          effective_from: string | null
          effective_to: string | null
          extraction_metadata: Json | null
          file_type: string | null
          file_url: string
          filename: string
          id: string
          notes: string | null
          published_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sheet_type: string | null
          status: string
          supersedes_price_sheet_id: string | null
          updated_at: string
          uploaded_at: string
          uploaded_by: string | null
          workspace_id: string
        }
        Insert: {
          brand_id?: string | null
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          extraction_metadata?: Json | null
          file_type?: string | null
          file_url: string
          filename: string
          id?: string
          notes?: string | null
          published_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sheet_type?: string | null
          status?: string
          supersedes_price_sheet_id?: string | null
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          workspace_id?: string
        }
        Update: {
          brand_id?: string | null
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          extraction_metadata?: Json | null
          file_type?: string | null
          file_url?: string
          filename?: string
          id?: string
          notes?: string | null
          published_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sheet_type?: string | null
          status?: string
          supersedes_price_sheet_id?: string | null
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qb_price_sheets_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "qb_brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_price_sheets_supersedes_price_sheet_id_fkey"
            columns: ["supersedes_price_sheet_id"]
            isOneToOne: false
            referencedRelation: "qb_price_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      qb_price_sheets_audit: {
        Row: {
          action: string
          actor_id: string | null
          changed_fields: Json | null
          created_at: string
          id: string
          record_id: string
          snapshot: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          changed_fields?: Json | null
          created_at?: string
          id?: string
          record_id: string
          snapshot?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          changed_fields?: Json | null
          created_at?: string
          id?: string
          record_id?: string
          snapshot?: Json | null
        }
        Relationships: []
      }
      qb_program_stacking_rules: {
        Row: {
          can_combine: boolean
          created_at: string
          id: string
          notes: string | null
          program_type_a: string
          program_type_b: string
        }
        Insert: {
          can_combine: boolean
          created_at?: string
          id?: string
          notes?: string | null
          program_type_a: string
          program_type_b: string
        }
        Update: {
          can_combine?: boolean
          created_at?: string
          id?: string
          notes?: string | null
          program_type_a?: string
          program_type_b?: string
        }
        Relationships: []
      }
      qb_programs: {
        Row: {
          active: boolean
          brand_id: string
          created_at: string
          deleted_at: string | null
          details: Json
          effective_from: string
          effective_to: string
          id: string
          name: string
          program_code: string
          program_type: string
          source_document_url: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          brand_id: string
          created_at?: string
          deleted_at?: string | null
          details: Json
          effective_from: string
          effective_to: string
          id?: string
          name: string
          program_code: string
          program_type: string
          source_document_url?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          active?: boolean
          brand_id?: string
          created_at?: string
          deleted_at?: string | null
          details?: Json
          effective_from?: string
          effective_to?: string
          id?: string
          name?: string
          program_code?: string
          program_type?: string
          source_document_url?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qb_programs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "qb_brands"
            referencedColumns: ["id"]
          },
        ]
      }
      qb_programs_audit: {
        Row: {
          action: string
          actor_id: string | null
          changed_fields: Json | null
          created_at: string
          id: string
          record_id: string
          snapshot: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          changed_fields?: Json | null
          created_at?: string
          id?: string
          record_id: string
          snapshot?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          changed_fields?: Json | null
          created_at?: string
          id?: string
          record_id?: string
          snapshot?: Json | null
        }
        Relationships: []
      }
      qb_quote_line_items: {
        Row: {
          attachment_id: string | null
          created_at: string
          description: string
          discount_pct: number
          display_order: number
          extended_price_cents: number
          id: string
          line_type: string
          list_price_cents: number | null
          quantity: number
          quote_id: string
          unit_price_cents: number
          workspace_id: string
        }
        Insert: {
          attachment_id?: string | null
          created_at?: string
          description: string
          discount_pct?: number
          display_order?: number
          extended_price_cents: number
          id?: string
          line_type: string
          list_price_cents?: number | null
          quantity?: number
          quote_id: string
          unit_price_cents: number
          workspace_id?: string
        }
        Update: {
          attachment_id?: string | null
          created_at?: string
          description?: string
          discount_pct?: number
          display_order?: number
          extended_price_cents?: number
          id?: string
          line_type?: string
          list_price_cents?: number | null
          quantity?: number
          quote_id?: string
          unit_price_cents?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qb_quote_line_items_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "qb_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_quote_line_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "qb_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      qb_quotes: {
        Row: {
          applied_program_ids: string[] | null
          approval_reason: string | null
          approved_at: string | null
          approved_by: string | null
          attachments_cost_cents: number
          attachments_list_price_cents: number
          attachments_markup_cents: number
          attachments_sales_price_cents: number
          baseline_sales_price_cents: number
          cil_amount_cents: number
          company_id: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          customer_equipment_id: string | null
          customer_type: string
          customer_type_details: Json | null
          dealer_discount_cents: number
          dealer_discount_pct: number
          delivery_date: string | null
          doc_fee_cents: number
          equipment_cost_cents: number
          equipment_model_id: string | null
          financing_scenario: Json | null
          freight_cents: number
          good_faith_cents: number
          good_faith_pct: number
          gross_margin_cents: number | null
          gross_margin_pct: number | null
          id: string
          internal_notes: string | null
          list_price_cents: number
          markup_achieved_pct: number | null
          markup_cents: number
          markup_pct: number
          notes: string | null
          parent_quote_id: string | null
          pdf_url: string | null
          pdi_cents: number
          quote_number: string
          rebate_total_cents: number
          requires_approval: boolean
          salesman_id: string
          sent_at: string | null
          status: string
          subtotal_cents: number
          tariff_cents: number
          tariff_pct: number
          tax_cents: number
          tax_rate_pct: number | null
          total_cents: number
          trade_in_allowance_cents: number
          trade_in_book_value_cents: number
          updated_at: string
          valid_until: string | null
          version: number
          workspace_id: string
        }
        Insert: {
          applied_program_ids?: string[] | null
          approval_reason?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attachments_cost_cents?: number
          attachments_list_price_cents?: number
          attachments_markup_cents?: number
          attachments_sales_price_cents?: number
          baseline_sales_price_cents: number
          cil_amount_cents?: number
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_equipment_id?: string | null
          customer_type?: string
          customer_type_details?: Json | null
          dealer_discount_cents: number
          dealer_discount_pct: number
          delivery_date?: string | null
          doc_fee_cents?: number
          equipment_cost_cents: number
          equipment_model_id?: string | null
          financing_scenario?: Json | null
          freight_cents: number
          good_faith_cents: number
          good_faith_pct: number
          gross_margin_cents?: number | null
          gross_margin_pct?: number | null
          id?: string
          internal_notes?: string | null
          list_price_cents: number
          markup_achieved_pct?: number | null
          markup_cents: number
          markup_pct: number
          notes?: string | null
          parent_quote_id?: string | null
          pdf_url?: string | null
          pdi_cents: number
          quote_number?: string
          rebate_total_cents?: number
          requires_approval?: boolean
          salesman_id: string
          sent_at?: string | null
          status?: string
          subtotal_cents: number
          tariff_cents: number
          tariff_pct: number
          tax_cents?: number
          tax_rate_pct?: number | null
          total_cents: number
          trade_in_allowance_cents?: number
          trade_in_book_value_cents?: number
          updated_at?: string
          valid_until?: string | null
          version?: number
          workspace_id?: string
        }
        Update: {
          applied_program_ids?: string[] | null
          approval_reason?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attachments_cost_cents?: number
          attachments_list_price_cents?: number
          attachments_markup_cents?: number
          attachments_sales_price_cents?: number
          baseline_sales_price_cents?: number
          cil_amount_cents?: number
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_equipment_id?: string | null
          customer_type?: string
          customer_type_details?: Json | null
          dealer_discount_cents?: number
          dealer_discount_pct?: number
          delivery_date?: string | null
          doc_fee_cents?: number
          equipment_cost_cents?: number
          equipment_model_id?: string | null
          financing_scenario?: Json | null
          freight_cents?: number
          good_faith_cents?: number
          good_faith_pct?: number
          gross_margin_cents?: number | null
          gross_margin_pct?: number | null
          id?: string
          internal_notes?: string | null
          list_price_cents?: number
          markup_achieved_pct?: number | null
          markup_cents?: number
          markup_pct?: number
          notes?: string | null
          parent_quote_id?: string | null
          pdf_url?: string | null
          pdi_cents?: number
          quote_number?: string
          rebate_total_cents?: number
          requires_approval?: boolean
          salesman_id?: string
          sent_at?: string | null
          status?: string
          subtotal_cents?: number
          tariff_cents?: number
          tariff_pct?: number
          tax_cents?: number
          tax_rate_pct?: number | null
          total_cents?: number
          trade_in_allowance_cents?: number
          trade_in_book_value_cents?: number
          updated_at?: string
          valid_until?: string | null
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qb_quotes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_quotes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_quotes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "qb_quotes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_quotes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_quotes_customer_equipment_id_fkey"
            columns: ["customer_equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_quotes_customer_equipment_id_fkey"
            columns: ["customer_equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "qb_quotes_customer_equipment_id_fkey"
            columns: ["customer_equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_quotes_equipment_model_id_fkey"
            columns: ["equipment_model_id"]
            isOneToOne: false
            referencedRelation: "qb_equipment_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_quotes_parent_quote_id_fkey"
            columns: ["parent_quote_id"]
            isOneToOne: false
            referencedRelation: "qb_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      qb_quotes_audit: {
        Row: {
          action: string
          actor_id: string | null
          changed_fields: Json | null
          created_at: string
          id: string
          record_id: string
          snapshot: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          changed_fields?: Json | null
          created_at?: string
          id?: string
          record_id: string
          snapshot?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          changed_fields?: Json | null
          created_at?: string
          id?: string
          record_id?: string
          snapshot?: Json | null
        }
        Relationships: []
      }
      qb_service_credit_config: {
        Row: {
          category: string
          credit_cents: number
          travel_budget_cents: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          category: string
          credit_cents: number
          travel_budget_cents: number
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          category?: string
          credit_cents?: number
          travel_budget_cents?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      qb_trade_ins: {
        Row: {
          allowance_cents: number
          approved_at: string | null
          approved_by: string | null
          book_value_cents: number | null
          created_at: string
          crm_equipment_id: string | null
          deal_id: string | null
          disposition: string | null
          hours: number | null
          id: string
          make: string
          model: string
          notes: string | null
          over_under_cents: number | null
          quote_id: string | null
          serial: string | null
          updated_at: string
          valuation_source: string | null
          workspace_id: string
          year: number | null
        }
        Insert: {
          allowance_cents: number
          approved_at?: string | null
          approved_by?: string | null
          book_value_cents?: number | null
          created_at?: string
          crm_equipment_id?: string | null
          deal_id?: string | null
          disposition?: string | null
          hours?: number | null
          id?: string
          make: string
          model: string
          notes?: string | null
          over_under_cents?: number | null
          quote_id?: string | null
          serial?: string | null
          updated_at?: string
          valuation_source?: string | null
          workspace_id?: string
          year?: number | null
        }
        Update: {
          allowance_cents?: number
          approved_at?: string | null
          approved_by?: string | null
          book_value_cents?: number | null
          created_at?: string
          crm_equipment_id?: string | null
          deal_id?: string | null
          disposition?: string | null
          hours?: number | null
          id?: string
          make?: string
          model?: string
          notes?: string | null
          over_under_cents?: number | null
          quote_id?: string | null
          serial?: string | null
          updated_at?: string
          valuation_source?: string | null
          workspace_id?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "qb_trade_ins_crm_equipment_id_fkey"
            columns: ["crm_equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_trade_ins_crm_equipment_id_fkey"
            columns: ["crm_equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "qb_trade_ins_crm_equipment_id_fkey"
            columns: ["crm_equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_trade_ins_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qb_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_trade_ins_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "qb_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_absence_engine_rep_snapshots: {
        Row: {
          absence_score: number
          created_at: string
          deal_count: number
          id: string
          iron_role: string | null
          missing_amount: number
          missing_close_date: number
          missing_company: number
          missing_contact: number
          rep_id: string | null
          rep_name: string
          run_id: string
          snapshot_date: string
          workspace_id: string
        }
        Insert: {
          absence_score?: number
          created_at?: string
          deal_count?: number
          id?: string
          iron_role?: string | null
          missing_amount?: number
          missing_close_date?: number
          missing_company?: number
          missing_contact?: number
          rep_id?: string | null
          rep_name: string
          run_id: string
          snapshot_date: string
          workspace_id?: string
        }
        Update: {
          absence_score?: number
          created_at?: string
          deal_count?: number
          id?: string
          iron_role?: string | null
          missing_amount?: number
          missing_close_date?: number
          missing_company?: number
          missing_contact?: number
          rep_id?: string | null
          rep_name?: string
          run_id?: string
          snapshot_date?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qrm_absence_engine_rep_snapshots_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qrm_absence_engine_rep_snapshots_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "qrm_absence_engine_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_absence_engine_runs: {
        Row: {
          generated_at: string
          id: string
          snapshot_date: string
          top_gap_count: number
          workspace_id: string
          worst_fields: Json
        }
        Insert: {
          generated_at?: string
          id?: string
          snapshot_date?: string
          top_gap_count?: number
          workspace_id?: string
          worst_fields?: Json
        }
        Update: {
          generated_at?: string
          id?: string
          snapshot_date?: string
          top_gap_count?: number
          workspace_id?: string
          worst_fields?: Json
        }
        Relationships: []
      }
      qrm_activities: {
        Row: {
          activity_type: Database["public"]["Enums"]["crm_activity_type"]
          body: string | null
          company_id: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          deal_id: string | null
          deleted_at: string | null
          id: string
          metadata: Json
          occurred_at: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          activity_type?: Database["public"]["Enums"]["crm_activity_type"]
          body?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          deleted_at?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          activity_type?: Database["public"]["Enums"]["crm_activity_type"]
          body?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          deleted_at?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "crm_activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      qrm_activity_templates: {
        Row: {
          activity_type: Database["public"]["Enums"]["crm_activity_type"]
          body: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          is_active: boolean
          label: string
          sort_order: number
          task_due_minutes: number | null
          task_status: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          activity_type: Database["public"]["Enums"]["crm_activity_type"]
          body: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
          task_due_minutes?: number | null
          task_status?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          activity_type?: Database["public"]["Enums"]["crm_activity_type"]
          body?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          task_due_minutes?: number | null
          task_status?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_activity_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_auth_audit_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          event_type: Database["public"]["Enums"]["crm_auth_event_type"]
          id: string
          ip_inet: unknown
          metadata: Json
          occurred_at: string
          outcome: Database["public"]["Enums"]["crm_auth_event_outcome"]
          request_id: string | null
          resource: string | null
          subject_user_id: string | null
          user_agent: string | null
          workspace_id: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          event_type: Database["public"]["Enums"]["crm_auth_event_type"]
          id?: string
          ip_inet?: unknown
          metadata?: Json
          occurred_at?: string
          outcome: Database["public"]["Enums"]["crm_auth_event_outcome"]
          request_id?: string | null
          resource?: string | null
          subject_user_id?: string | null
          user_agent?: string | null
          workspace_id?: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          event_type?: Database["public"]["Enums"]["crm_auth_event_type"]
          id?: string
          ip_inet?: unknown
          metadata?: Json
          occurred_at?: string
          outcome?: Database["public"]["Enums"]["crm_auth_event_outcome"]
          request_id?: string | null
          resource?: string | null
          subject_user_id?: string | null
          user_agent?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      qrm_companies: {
        Row: {
          address_line_1: string | null
          address_line_2: string | null
          assigned_rep_id: string | null
          city: string | null
          classification: string | null
          country: string | null
          county: string | null
          created_at: string
          dba: string | null
          deleted_at: string | null
          hubspot_company_id: string | null
          id: string
          legal_name: string | null
          metadata: Json
          name: string
          notes: string | null
          parent_company_id: string | null
          phone: string | null
          postal_code: string | null
          state: string | null
          status: string | null
          territory_code: string | null
          updated_at: string
          website: string | null
          workspace_id: string
        }
        Insert: {
          address_line_1?: string | null
          address_line_2?: string | null
          assigned_rep_id?: string | null
          city?: string | null
          classification?: string | null
          country?: string | null
          county?: string | null
          created_at?: string
          dba?: string | null
          deleted_at?: string | null
          hubspot_company_id?: string | null
          id?: string
          legal_name?: string | null
          metadata?: Json
          name: string
          notes?: string | null
          parent_company_id?: string | null
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          status?: string | null
          territory_code?: string | null
          updated_at?: string
          website?: string | null
          workspace_id?: string
        }
        Update: {
          address_line_1?: string | null
          address_line_2?: string | null
          assigned_rep_id?: string | null
          city?: string | null
          classification?: string | null
          country?: string | null
          county?: string | null
          created_at?: string
          dba?: string | null
          deleted_at?: string | null
          hubspot_company_id?: string | null
          id?: string
          legal_name?: string | null
          metadata?: Json
          name?: string
          notes?: string | null
          parent_company_id?: string | null
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          status?: string | null
          territory_code?: string | null
          updated_at?: string
          website?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_companies_assigned_rep_id_fkey"
            columns: ["assigned_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_companies_parent_company_id_fkey"
            columns: ["parent_company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_companies_parent_company_id_fkey"
            columns: ["parent_company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_companies_parent_company_id_fkey"
            columns: ["parent_company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      qrm_company_merge_audit: {
        Row: {
          affected_row_ids: Json
          caller_notes: string | null
          discarded_company_id: string
          discarded_company_snapshot: Json | null
          dry_run: boolean
          id: string
          kept_company_id: string
          kept_company_snapshot: Json | null
          performed_at: string
          performed_by: string | null
          table_row_counts: Json
          total_rows_updated: number
          undone_at: string | null
          undone_by: string | null
          workspace_id: string
        }
        Insert: {
          affected_row_ids?: Json
          caller_notes?: string | null
          discarded_company_id: string
          discarded_company_snapshot?: Json | null
          dry_run?: boolean
          id?: string
          kept_company_id: string
          kept_company_snapshot?: Json | null
          performed_at?: string
          performed_by?: string | null
          table_row_counts?: Json
          total_rows_updated?: number
          undone_at?: string | null
          undone_by?: string | null
          workspace_id?: string
        }
        Update: {
          affected_row_ids?: Json
          caller_notes?: string | null
          discarded_company_id?: string
          discarded_company_snapshot?: Json | null
          dry_run?: boolean
          id?: string
          kept_company_id?: string
          kept_company_snapshot?: Json | null
          performed_at?: string
          performed_by?: string | null
          table_row_counts?: Json
          total_rows_updated?: number
          undone_at?: string | null
          undone_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qrm_company_merge_audit_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qrm_company_merge_audit_undone_by_fkey"
            columns: ["undone_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_contact_companies: {
        Row: {
          company_id: string
          contact_id: string
          created_at: string
          id: string
          is_primary: boolean
          workspace_id: string
        }
        Insert: {
          company_id: string
          contact_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          workspace_id?: string
        }
        Update: {
          company_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_contact_companies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_companies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_companies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "crm_contact_companies_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_companies_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_contact_tags: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          tag_id: string
          workspace_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          tag_id: string
          workspace_id?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          tag_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "crm_tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "qrm_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_contact_territories: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          territory_id: string
          workspace_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          territory_id: string
          workspace_id?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          territory_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_contact_territories_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_territories_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_territories_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "crm_territories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_territories_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "qrm_territories"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_contacts: {
        Row: {
          assigned_rep_id: string | null
          created_at: string
          deleted_at: string | null
          dge_customer_profile_id: string | null
          email: string | null
          first_name: string
          hubspot_contact_id: string | null
          id: string
          last_name: string
          merged_into_contact_id: string | null
          metadata: Json
          phone: string | null
          primary_company_id: string | null
          sms_opt_in: boolean
          sms_opt_in_at: string | null
          sms_opt_in_source: string | null
          title: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assigned_rep_id?: string | null
          created_at?: string
          deleted_at?: string | null
          dge_customer_profile_id?: string | null
          email?: string | null
          first_name: string
          hubspot_contact_id?: string | null
          id?: string
          last_name: string
          merged_into_contact_id?: string | null
          metadata?: Json
          phone?: string | null
          primary_company_id?: string | null
          sms_opt_in?: boolean
          sms_opt_in_at?: string | null
          sms_opt_in_source?: string | null
          title?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          assigned_rep_id?: string | null
          created_at?: string
          deleted_at?: string | null
          dge_customer_profile_id?: string | null
          email?: string | null
          first_name?: string
          hubspot_contact_id?: string | null
          id?: string
          last_name?: string
          merged_into_contact_id?: string | null
          metadata?: Json
          phone?: string | null
          primary_company_id?: string | null
          sms_opt_in?: boolean
          sms_opt_in_at?: string | null
          sms_opt_in_source?: string | null
          title?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_contacts_assigned_rep_id_fkey"
            columns: ["assigned_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_dge_customer_profile_id_fkey"
            columns: ["dge_customer_profile_id"]
            isOneToOne: false
            referencedRelation: "customer_profiles_extended"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_dge_customer_profile_id_fkey"
            columns: ["dge_customer_profile_id"]
            isOneToOne: false
            referencedRelation: "exec_health_movers"
            referencedColumns: ["customer_profile_id"]
          },
          {
            foreignKeyName: "crm_contacts_merged_into_contact_id_fkey"
            columns: ["merged_into_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_merged_into_contact_id_fkey"
            columns: ["merged_into_contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_primary_company_id_fkey"
            columns: ["primary_company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_primary_company_id_fkey"
            columns: ["primary_company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_primary_company_id_fkey"
            columns: ["primary_company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      qrm_custom_field_definitions: {
        Row: {
          constraints: Json
          created_at: string
          data_type: string
          deleted_at: string | null
          id: string
          key: string
          label: string
          object_type: Database["public"]["Enums"]["crm_custom_field_object_type"]
          required: boolean
          sort_order: number
          updated_at: string
          visibility_roles: Json
          workspace_id: string
        }
        Insert: {
          constraints?: Json
          created_at?: string
          data_type: string
          deleted_at?: string | null
          id?: string
          key: string
          label: string
          object_type: Database["public"]["Enums"]["crm_custom_field_object_type"]
          required?: boolean
          sort_order?: number
          updated_at?: string
          visibility_roles?: Json
          workspace_id?: string
        }
        Update: {
          constraints?: Json
          created_at?: string
          data_type?: string
          deleted_at?: string | null
          id?: string
          key?: string
          label?: string
          object_type?: Database["public"]["Enums"]["crm_custom_field_object_type"]
          required?: boolean
          sort_order?: number
          updated_at?: string
          visibility_roles?: Json
          workspace_id?: string
        }
        Relationships: []
      }
      qrm_custom_field_values: {
        Row: {
          created_at: string
          definition_id: string
          id: string
          record_id: string
          record_type: Database["public"]["Enums"]["crm_custom_field_object_type"]
          updated_at: string
          value: Json | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          definition_id: string
          id?: string
          record_id: string
          record_type: Database["public"]["Enums"]["crm_custom_field_object_type"]
          updated_at?: string
          value?: Json | null
          workspace_id?: string
        }
        Update: {
          created_at?: string
          definition_id?: string
          id?: string
          record_id?: string
          record_type?: Database["public"]["Enums"]["crm_custom_field_object_type"]
          updated_at?: string
          value?: Json | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_custom_field_values_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "crm_custom_field_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_custom_field_values_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "qrm_custom_field_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_deal_equipment: {
        Row: {
          created_at: string
          deal_id: string
          equipment_id: string
          id: string
          notes: string | null
          role: Database["public"]["Enums"]["crm_deal_equipment_role"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          deal_id: string
          equipment_id: string
          id?: string
          notes?: string | null
          role?: Database["public"]["Enums"]["crm_deal_equipment_role"]
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          deal_id?: string
          equipment_id?: string
          id?: string
          notes?: string | null
          role?: Database["public"]["Enums"]["crm_deal_equipment_role"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_deal_equipment_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deal_equipment_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deal_equipment_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deal_equipment_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deal_equipment_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deal_equipment_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "crm_deal_equipment_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deal_equipment_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "crm_deal_equipment_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_deal_stages: {
        Row: {
          created_at: string
          description: string | null
          hubspot_stage_id: string | null
          id: string
          is_closed_lost: boolean
          is_closed_won: boolean
          name: string
          probability: number | null
          sla_minutes: number | null
          sort_order: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          hubspot_stage_id?: string | null
          id?: string
          is_closed_lost?: boolean
          is_closed_won?: boolean
          name: string
          probability?: number | null
          sla_minutes?: number | null
          sort_order?: number
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          hubspot_stage_id?: string | null
          id?: string
          is_closed_lost?: boolean
          is_closed_won?: boolean
          name?: string
          probability?: number | null
          sla_minutes?: number | null
          sort_order?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      qrm_deals: {
        Row: {
          amount: number | null
          assigned_rep_id: string | null
          closed_at: string | null
          company_id: string | null
          competitor: string | null
          created_at: string
          deal_score: number | null
          deal_score_factors: Json | null
          deal_score_updated_at: string | null
          deleted_at: string | null
          deposit_amount: number | null
          deposit_status: string
          dge_last_scored_at: string | null
          dge_scenario_count: number | null
          dge_score: number | null
          expected_close_on: string | null
          forecast_confidence_score: number | null
          hubspot_deal_id: string | null
          id: string
          last_activity_at: string | null
          loaded_margin_pct: number | null
          loss_reason: string | null
          margin_amount: number | null
          margin_check_status: string
          margin_pct: number | null
          metadata: Json
          name: string
          needs_assessment_id: string | null
          net_contribution_after_load: number | null
          next_follow_up_at: string | null
          primary_contact_id: string | null
          selected_scenario: Database["public"]["Enums"]["scenario_type"] | null
          sla_deadline_at: string | null
          sla_started_at: string | null
          sort_position: number | null
          stage_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount?: number | null
          assigned_rep_id?: string | null
          closed_at?: string | null
          company_id?: string | null
          competitor?: string | null
          created_at?: string
          deal_score?: number | null
          deal_score_factors?: Json | null
          deal_score_updated_at?: string | null
          deleted_at?: string | null
          deposit_amount?: number | null
          deposit_status?: string
          dge_last_scored_at?: string | null
          dge_scenario_count?: number | null
          dge_score?: number | null
          expected_close_on?: string | null
          forecast_confidence_score?: number | null
          hubspot_deal_id?: string | null
          id?: string
          last_activity_at?: string | null
          loaded_margin_pct?: number | null
          loss_reason?: string | null
          margin_amount?: number | null
          margin_check_status?: string
          margin_pct?: number | null
          metadata?: Json
          name: string
          needs_assessment_id?: string | null
          net_contribution_after_load?: number | null
          next_follow_up_at?: string | null
          primary_contact_id?: string | null
          selected_scenario?:
            | Database["public"]["Enums"]["scenario_type"]
            | null
          sla_deadline_at?: string | null
          sla_started_at?: string | null
          sort_position?: number | null
          stage_id: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          amount?: number | null
          assigned_rep_id?: string | null
          closed_at?: string | null
          company_id?: string | null
          competitor?: string | null
          created_at?: string
          deal_score?: number | null
          deal_score_factors?: Json | null
          deal_score_updated_at?: string | null
          deleted_at?: string | null
          deposit_amount?: number | null
          deposit_status?: string
          dge_last_scored_at?: string | null
          dge_scenario_count?: number | null
          dge_score?: number | null
          expected_close_on?: string | null
          forecast_confidence_score?: number | null
          hubspot_deal_id?: string | null
          id?: string
          last_activity_at?: string | null
          loaded_margin_pct?: number | null
          loss_reason?: string | null
          margin_amount?: number | null
          margin_check_status?: string
          margin_pct?: number | null
          metadata?: Json
          name?: string
          needs_assessment_id?: string | null
          net_contribution_after_load?: number | null
          next_follow_up_at?: string | null
          primary_contact_id?: string | null
          selected_scenario?:
            | Database["public"]["Enums"]["scenario_type"]
            | null
          sla_deadline_at?: string | null
          sla_started_at?: string | null
          sort_position?: number | null
          stage_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_deals_assigned_rep_id_fkey"
            columns: ["assigned_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "crm_deals_needs_assessment_id_fkey"
            columns: ["needs_assessment_id"]
            isOneToOne: false
            referencedRelation: "needs_assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_deal_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "exec_pipeline_stage_summary_v"
            referencedColumns: ["stage_id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "mv_exec_pipeline_stage_summary"
            referencedColumns: ["stage_id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "qrm_deal_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_duplicate_candidates: {
        Row: {
          created_at: string
          id: string
          left_contact_id: string
          right_contact_id: string
          rule_id: string
          score: number
          status: Database["public"]["Enums"]["crm_duplicate_candidate_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          left_contact_id: string
          right_contact_id: string
          rule_id: string
          score?: number
          status?: Database["public"]["Enums"]["crm_duplicate_candidate_status"]
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          left_contact_id?: string
          right_contact_id?: string
          rule_id?: string
          score?: number
          status?: Database["public"]["Enums"]["crm_duplicate_candidate_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_duplicate_candidates_left_contact_id_fkey"
            columns: ["left_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_duplicate_candidates_left_contact_id_fkey"
            columns: ["left_contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_duplicate_candidates_right_contact_id_fkey"
            columns: ["right_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_duplicate_candidates_right_contact_id_fkey"
            columns: ["right_contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_embeddings: {
        Row: {
          content: string
          created_at: string
          embedding: string | null
          entity_id: string
          entity_type: string
          id: string
          metadata: Json | null
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          embedding?: string | null
          entity_id: string
          entity_type: string
          id?: string
          metadata?: Json | null
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      qrm_equipment: {
        Row: {
          aging_bucket: string | null
          asset_tag: string | null
          availability: Database["public"]["Enums"]["crm_equipment_availability"]
          category: Database["public"]["Enums"]["crm_equipment_category"] | null
          company_id: string
          condition:
            | Database["public"]["Enums"]["crm_equipment_condition"]
            | null
          created_at: string
          current_market_value: number | null
          daily_rental_rate: number | null
          deleted_at: string | null
          engine_hours: number | null
          fuel_type: string | null
          id: string
          intake_stage: number | null
          last_inspection_at: string | null
          latitude: number | null
          location_description: string | null
          longitude: number | null
          make: string | null
          metadata: Json
          mileage: number | null
          model: string | null
          monthly_rental_rate: number | null
          name: string
          next_service_due_at: string | null
          notes: string | null
          operating_capacity: string | null
          ownership: Database["public"]["Enums"]["crm_equipment_ownership"]
          photo_urls: Json
          primary_contact_id: string | null
          purchase_date: string | null
          purchase_price: number | null
          purchased_from_qep: boolean | null
          readiness_blocker_reason: string | null
          readiness_status: string | null
          replacement_cost: number | null
          sale_ready_at: string | null
          serial_number: string | null
          updated_at: string
          vin_pin: string | null
          warranty_expires_on: string | null
          weekly_rental_rate: number | null
          weight_class: string | null
          workspace_id: string
          year: number | null
        }
        Insert: {
          aging_bucket?: string | null
          asset_tag?: string | null
          availability?: Database["public"]["Enums"]["crm_equipment_availability"]
          category?:
            | Database["public"]["Enums"]["crm_equipment_category"]
            | null
          company_id: string
          condition?:
            | Database["public"]["Enums"]["crm_equipment_condition"]
            | null
          created_at?: string
          current_market_value?: number | null
          daily_rental_rate?: number | null
          deleted_at?: string | null
          engine_hours?: number | null
          fuel_type?: string | null
          id?: string
          intake_stage?: number | null
          last_inspection_at?: string | null
          latitude?: number | null
          location_description?: string | null
          longitude?: number | null
          make?: string | null
          metadata?: Json
          mileage?: number | null
          model?: string | null
          monthly_rental_rate?: number | null
          name: string
          next_service_due_at?: string | null
          notes?: string | null
          operating_capacity?: string | null
          ownership?: Database["public"]["Enums"]["crm_equipment_ownership"]
          photo_urls?: Json
          primary_contact_id?: string | null
          purchase_date?: string | null
          purchase_price?: number | null
          purchased_from_qep?: boolean | null
          readiness_blocker_reason?: string | null
          readiness_status?: string | null
          replacement_cost?: number | null
          sale_ready_at?: string | null
          serial_number?: string | null
          updated_at?: string
          vin_pin?: string | null
          warranty_expires_on?: string | null
          weekly_rental_rate?: number | null
          weight_class?: string | null
          workspace_id?: string
          year?: number | null
        }
        Update: {
          aging_bucket?: string | null
          asset_tag?: string | null
          availability?: Database["public"]["Enums"]["crm_equipment_availability"]
          category?:
            | Database["public"]["Enums"]["crm_equipment_category"]
            | null
          company_id?: string
          condition?:
            | Database["public"]["Enums"]["crm_equipment_condition"]
            | null
          created_at?: string
          current_market_value?: number | null
          daily_rental_rate?: number | null
          deleted_at?: string | null
          engine_hours?: number | null
          fuel_type?: string | null
          id?: string
          intake_stage?: number | null
          last_inspection_at?: string | null
          latitude?: number | null
          location_description?: string | null
          longitude?: number | null
          make?: string | null
          metadata?: Json
          mileage?: number | null
          model?: string | null
          monthly_rental_rate?: number | null
          name?: string
          next_service_due_at?: string | null
          notes?: string | null
          operating_capacity?: string | null
          ownership?: Database["public"]["Enums"]["crm_equipment_ownership"]
          photo_urls?: Json
          primary_contact_id?: string | null
          purchase_date?: string | null
          purchase_price?: number | null
          purchased_from_qep?: boolean | null
          readiness_blocker_reason?: string | null
          readiness_status?: string | null
          replacement_cost?: number | null
          sale_ready_at?: string | null
          serial_number?: string | null
          updated_at?: string
          vin_pin?: string | null
          warranty_expires_on?: string | null
          weekly_rental_rate?: number | null
          weight_class?: string | null
          workspace_id?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_equipment_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_equipment_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_equipment_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "crm_equipment_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_equipment_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_external_id_map: {
        Row: {
          created_at: string
          external_id: string
          id: string
          internal_id: string
          object_type: string
          source_system: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          external_id: string
          id?: string
          internal_id: string
          object_type: string
          source_system: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          external_id?: string
          id?: string
          internal_id?: string
          object_type?: string
          source_system?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      qrm_geofences: {
        Row: {
          created_at: string
          created_by: string | null
          geofence_type: string
          id: string
          is_active: boolean
          linked_company_id: string | null
          linked_deal_id: string | null
          metadata: Json
          name: string
          polygon: unknown
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          geofence_type: string
          id?: string
          is_active?: boolean
          linked_company_id?: string | null
          linked_deal_id?: string | null
          metadata?: Json
          name: string
          polygon: unknown
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          geofence_type?: string
          id?: string
          is_active?: boolean
          linked_company_id?: string | null
          linked_deal_id?: string | null
          metadata?: Json
          name?: string
          polygon?: unknown
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_geofences_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_geofences_linked_company_id_fkey"
            columns: ["linked_company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_geofences_linked_company_id_fkey"
            columns: ["linked_company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_geofences_linked_company_id_fkey"
            columns: ["linked_company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "crm_geofences_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_geofences_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_geofences_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_geofences_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_geofences_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_geofences_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      qrm_honesty_daily: {
        Row: {
          created_at: string
          honesty_index: number
          id: string
          probe_breakdown: Json
          rollup_date: string
          total_discrepancy: number
          total_observations: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          honesty_index: number
          id?: string
          probe_breakdown?: Json
          rollup_date: string
          total_discrepancy?: number
          total_observations?: number
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          honesty_index?: number
          id?: string
          probe_breakdown?: Json
          rollup_date?: string
          total_discrepancy?: number
          total_observations?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      qrm_honesty_observations: {
        Row: {
          actual_state: string
          assigned_owner_id: string
          attributed_user_id: string | null
          created_at: string
          discrepancy_score: number
          entity_id: string | null
          entity_type: string | null
          expected_state: string
          id: string
          metadata: Json
          observation_type: string
          observed_at: string
          probe_id: string
          workspace_id: string
        }
        Insert: {
          actual_state: string
          assigned_owner_id?: string
          attributed_user_id?: string | null
          created_at?: string
          discrepancy_score: number
          entity_id?: string | null
          entity_type?: string | null
          expected_state: string
          id?: string
          metadata?: Json
          observation_type: string
          observed_at?: string
          probe_id: string
          workspace_id?: string
        }
        Update: {
          actual_state?: string
          assigned_owner_id?: string
          attributed_user_id?: string | null
          created_at?: string
          discrepancy_score?: number
          entity_id?: string | null
          entity_type?: string | null
          expected_state?: string
          id?: string
          metadata?: Json
          observation_type?: string
          observed_at?: string
          probe_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qrm_honesty_observations_attributed_user_id_fkey"
            columns: ["attributed_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qrm_honesty_observations_probe_id_fkey"
            columns: ["probe_id"]
            isOneToOne: false
            referencedRelation: "qrm_honesty_probes"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_honesty_probes: {
        Row: {
          created_at: string
          depends_on: string | null
          description: string | null
          id: string
          is_enabled: boolean
          probe_name: string
          probe_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          depends_on?: string | null
          description?: string | null
          id?: string
          is_enabled?: boolean
          probe_name: string
          probe_type: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          depends_on?: string | null
          description?: string | null
          id?: string
          is_enabled?: boolean
          probe_name?: string
          probe_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      qrm_hubspot_import_errors: {
        Row: {
          created_at: string
          entity_type: string
          external_id: string | null
          id: string
          message: string | null
          payload_snippet: Json | null
          reason_code: string
          run_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          entity_type: string
          external_id?: string | null
          id?: string
          message?: string | null
          payload_snippet?: Json | null
          reason_code: string
          run_id: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          entity_type?: string
          external_id?: string | null
          id?: string
          message?: string | null
          payload_snippet?: Json | null
          reason_code?: string
          run_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_hubspot_import_errors_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "crm_hubspot_import_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_hubspot_import_errors_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "qrm_hubspot_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_hubspot_import_runs: {
        Row: {
          activities_processed: number
          companies_processed: number
          completed_at: string | null
          contacts_processed: number
          created_at: string
          deals_processed: number
          error_count: number
          error_summary: string | null
          id: string
          initiated_by: string | null
          metadata: Json
          started_at: string
          status: Database["public"]["Enums"]["crm_import_run_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          activities_processed?: number
          companies_processed?: number
          completed_at?: string | null
          contacts_processed?: number
          created_at?: string
          deals_processed?: number
          error_count?: number
          error_summary?: string | null
          id?: string
          initiated_by?: string | null
          metadata?: Json
          started_at?: string
          status?: Database["public"]["Enums"]["crm_import_run_status"]
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          activities_processed?: number
          companies_processed?: number
          completed_at?: string | null
          contacts_processed?: number
          created_at?: string
          deals_processed?: number
          error_count?: number
          error_summary?: string | null
          id?: string
          initiated_by?: string | null
          metadata?: Json
          started_at?: string
          status?: Database["public"]["Enums"]["crm_import_run_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_hubspot_import_runs_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_idea_backlog: {
        Row: {
          ai_confidence: number | null
          body: string | null
          captured_at: string
          captured_by: string | null
          created_at: string
          id: string
          priority: string | null
          shipped_at: string | null
          source: string
          source_voice_capture_id: string | null
          status: string
          tags: Json
          title: string
          triaged_at: string | null
          triaged_by: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          ai_confidence?: number | null
          body?: string | null
          captured_at?: string
          captured_by?: string | null
          created_at?: string
          id?: string
          priority?: string | null
          shipped_at?: string | null
          source?: string
          source_voice_capture_id?: string | null
          status?: string
          tags?: Json
          title: string
          triaged_at?: string | null
          triaged_by?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          ai_confidence?: number | null
          body?: string | null
          captured_at?: string
          captured_by?: string | null
          created_at?: string
          id?: string
          priority?: string | null
          shipped_at?: string | null
          source?: string
          source_voice_capture_id?: string | null
          status?: string
          tags?: Json
          title?: string
          triaged_at?: string | null
          triaged_by?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qrm_idea_backlog_captured_by_fkey"
            columns: ["captured_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qrm_idea_backlog_triaged_by_fkey"
            columns: ["triaged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_in_app_notifications: {
        Row: {
          body: string | null
          created_at: string
          deal_id: string | null
          id: string
          kind: string
          metadata: Json
          read_at: string | null
          reminder_instance_id: string | null
          title: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          kind?: string
          metadata?: Json
          read_at?: string | null
          reminder_instance_id?: string | null
          title: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          kind?: string
          metadata?: Json
          read_at?: string | null
          reminder_instance_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_in_app_notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_in_app_notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_in_app_notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_in_app_notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_in_app_notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_in_app_notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "crm_in_app_notifications_reminder_instance_id_fkey"
            columns: ["reminder_instance_id"]
            isOneToOne: false
            referencedRelation: "crm_reminder_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_in_app_notifications_reminder_instance_id_fkey"
            columns: ["reminder_instance_id"]
            isOneToOne: false
            referencedRelation: "qrm_reminder_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_in_app_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_merge_audit_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          id: string
          loser_contact_id: string
          metadata: Json
          occurred_at: string
          snapshot: Json
          survivor_contact_id: string
          workspace_id: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          id?: string
          loser_contact_id: string
          metadata?: Json
          occurred_at?: string
          snapshot: Json
          survivor_contact_id: string
          workspace_id?: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          id?: string
          loser_contact_id?: string
          metadata?: Json
          occurred_at?: string
          snapshot?: Json
          survivor_contact_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_merge_audit_events_loser_contact_id_fkey"
            columns: ["loser_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_merge_audit_events_loser_contact_id_fkey"
            columns: ["loser_contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_merge_audit_events_survivor_contact_id_fkey"
            columns: ["survivor_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_merge_audit_events_survivor_contact_id_fkey"
            columns: ["survivor_contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_prediction_outcomes: {
        Row: {
          created_at: string
          evidence: Json
          id: string
          logged_by: string | null
          observed_at: string
          outcome: string
          prediction_id: string
          source: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          evidence?: Json
          id?: string
          logged_by?: string | null
          observed_at?: string
          outcome: string
          prediction_id: string
          source?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          evidence?: Json
          id?: string
          logged_by?: string | null
          observed_at?: string
          outcome?: string
          prediction_id?: string
          source?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qrm_prediction_outcomes_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qrm_prediction_outcomes_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: false
            referencedRelation: "qrm_predictions"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_predictions: {
        Row: {
          created_at: string
          id: string
          inputs_hash: string
          model_source: string
          outcome: string | null
          outcome_at: string | null
          outcome_logged_by: string | null
          predicted_at: string
          prediction_kind: string
          rationale: Json
          rationale_hash: string
          role_blend: Json
          score: number
          signals_hash: string
          subject_id: string
          subject_type: string
          trace_id: string
          trace_steps: Json
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          inputs_hash: string
          model_source: string
          outcome?: string | null
          outcome_at?: string | null
          outcome_logged_by?: string | null
          predicted_at?: string
          prediction_kind: string
          rationale?: Json
          rationale_hash: string
          role_blend?: Json
          score: number
          signals_hash: string
          subject_id: string
          subject_type: string
          trace_id?: string
          trace_steps?: Json
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          inputs_hash?: string
          model_source?: string
          outcome?: string | null
          outcome_at?: string | null
          outcome_logged_by?: string | null
          predicted_at?: string
          prediction_kind?: string
          rationale?: Json
          rationale_hash?: string
          role_blend?: Json
          score?: number
          signals_hash?: string
          subject_id?: string
          subject_type?: string
          trace_id?: string
          trace_steps?: Json
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qrm_predictions_outcome_logged_by_fkey"
            columns: ["outcome_logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_quote_audit_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          quote_id: string
          request_id: string | null
          workspace_id: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          quote_id: string
          request_id?: string | null
          workspace_id: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          quote_id?: string
          request_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_quote_audit_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_quote_audit_events_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_reminder_instances: {
        Row: {
          assigned_user_id: string
          created_at: string
          deal_id: string
          deleted_at: string | null
          due_at: string
          fired_at: string | null
          id: string
          idempotency_key: string
          source: Database["public"]["Enums"]["crm_reminder_source"]
          status: Database["public"]["Enums"]["crm_reminder_status"]
          task_activity_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assigned_user_id: string
          created_at?: string
          deal_id: string
          deleted_at?: string | null
          due_at: string
          fired_at?: string | null
          id?: string
          idempotency_key?: string
          source?: Database["public"]["Enums"]["crm_reminder_source"]
          status?: Database["public"]["Enums"]["crm_reminder_status"]
          task_activity_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          assigned_user_id?: string
          created_at?: string
          deal_id?: string
          deleted_at?: string | null
          due_at?: string
          fired_at?: string | null
          id?: string
          idempotency_key?: string
          source?: Database["public"]["Enums"]["crm_reminder_source"]
          status?: Database["public"]["Enums"]["crm_reminder_status"]
          task_activity_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_reminder_instances_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_reminder_instances_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_reminder_instances_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_reminder_instances_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_reminder_instances_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_reminder_instances_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_reminder_instances_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "crm_reminder_instances_task_activity_id_fkey"
            columns: ["task_activity_id"]
            isOneToOne: false
            referencedRelation: "crm_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_reminder_instances_task_activity_id_fkey"
            columns: ["task_activity_id"]
            isOneToOne: false
            referencedRelation: "qrm_activities"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_rename_marker: {
        Row: {
          id: number
          renamed_at: string
          source_migration: string
        }
        Insert: {
          id?: number
          renamed_at?: string
          source_migration?: string
        }
        Update: {
          id?: number
          renamed_at?: string
          source_migration?: string
        }
        Relationships: []
      }
      qrm_stage_transitions: {
        Row: {
          at: string
          created_at: string
          deal_id: string
          from_stage_id: string | null
          id: string
          source: string
          to_stage_id: string
          workspace_id: string
        }
        Insert: {
          at?: string
          created_at?: string
          deal_id: string
          from_stage_id?: string | null
          id?: string
          source?: string
          to_stage_id: string
          workspace_id?: string
        }
        Update: {
          at?: string
          created_at?: string
          deal_id?: string
          from_stage_id?: string | null
          id?: string
          source?: string
          to_stage_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qrm_stage_transitions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qrm_stage_transitions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qrm_stage_transitions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qrm_stage_transitions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qrm_stage_transitions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qrm_stage_transitions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "qrm_stage_transitions_to_stage_id_fkey"
            columns: ["to_stage_id"]
            isOneToOne: false
            referencedRelation: "crm_deal_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qrm_stage_transitions_to_stage_id_fkey"
            columns: ["to_stage_id"]
            isOneToOne: false
            referencedRelation: "exec_pipeline_stage_summary_v"
            referencedColumns: ["stage_id"]
          },
          {
            foreignKeyName: "qrm_stage_transitions_to_stage_id_fkey"
            columns: ["to_stage_id"]
            isOneToOne: false
            referencedRelation: "mv_exec_pipeline_stage_summary"
            referencedColumns: ["stage_id"]
          },
          {
            foreignKeyName: "qrm_stage_transitions_to_stage_id_fkey"
            columns: ["to_stage_id"]
            isOneToOne: false
            referencedRelation: "qrm_deal_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      qrm_tags: {
        Row: {
          color: string | null
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      qrm_territories: {
        Row: {
          assigned_rep_id: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assigned_rep_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          assigned_rep_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_territories_assigned_rep_id_fkey"
            columns: ["assigned_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_incentive_applications: {
        Row: {
          applied_amount: number
          applied_at: string
          applied_by: string | null
          auto_applied: boolean
          created_at: string
          id: string
          incentive_id: string
          quote_package_id: string
          removal_reason: string | null
          removed_at: string | null
          removed_by: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          applied_amount: number
          applied_at?: string
          applied_by?: string | null
          auto_applied?: boolean
          created_at?: string
          id?: string
          incentive_id: string
          quote_package_id: string
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          applied_amount?: number
          applied_at?: string
          applied_by?: string | null
          auto_applied?: boolean
          created_at?: string
          id?: string
          incentive_id?: string
          quote_package_id?: string
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_incentive_applications_applied_by_fkey"
            columns: ["applied_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_incentive_applications_incentive_id_fkey"
            columns: ["incentive_id"]
            isOneToOne: false
            referencedRelation: "manufacturer_incentives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_incentive_applications_quote_package_id_fkey"
            columns: ["quote_package_id"]
            isOneToOne: false
            referencedRelation: "price_change_impact"
            referencedColumns: ["quote_package_id"]
          },
          {
            foreignKeyName: "quote_incentive_applications_quote_package_id_fkey"
            columns: ["quote_package_id"]
            isOneToOne: false
            referencedRelation: "quote_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_incentive_applications_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_package_line_items: {
        Row: {
          catalog_entry_id: string | null
          created_at: string
          id: string
          make: string | null
          model: string | null
          quantity: number | null
          quote_package_id: string
          quoted_dealer_cost: number | null
          quoted_list_price: number | null
          source_location: string | null
          workspace_id: string
          year: number | null
        }
        Insert: {
          catalog_entry_id?: string | null
          created_at?: string
          id?: string
          make?: string | null
          model?: string | null
          quantity?: number | null
          quote_package_id: string
          quoted_dealer_cost?: number | null
          quoted_list_price?: number | null
          source_location?: string | null
          workspace_id?: string
          year?: number | null
        }
        Update: {
          catalog_entry_id?: string | null
          created_at?: string
          id?: string
          make?: string | null
          model?: string | null
          quantity?: number | null
          quote_package_id?: string
          quoted_dealer_cost?: number | null
          quoted_list_price?: number | null
          source_location?: string | null
          workspace_id?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_package_line_items_catalog_entry_id_fkey"
            columns: ["catalog_entry_id"]
            isOneToOne: false
            referencedRelation: "catalog_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_package_line_items_quote_package_id_fkey"
            columns: ["quote_package_id"]
            isOneToOne: false
            referencedRelation: "price_change_impact"
            referencedColumns: ["quote_package_id"]
          },
          {
            foreignKeyName: "quote_package_line_items_quote_package_id_fkey"
            columns: ["quote_package_id"]
            isOneToOne: false
            referencedRelation: "quote_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_packages: {
        Row: {
          ai_recommendation: Json | null
          attachment_total: number | null
          attachments_included: Json | null
          brochure_url: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          credit_app_url: string | null
          customer_company: string | null
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          deal_id: string
          discount_total: number | null
          entry_mode: string | null
          equipment: Json
          equipment_total: number | null
          expires_at: string | null
          financing_scenarios: Json | null
          freight_estimate: number | null
          id: string
          margin_amount: number | null
          margin_pct: number | null
          net_total: number | null
          pdf_generated_at: string | null
          pdf_url: string | null
          photos_included: Json | null
          quote_number: string | null
          requires_requote: boolean | null
          requote_draft_email_id: string | null
          requote_reason: string | null
          sent_at: string | null
          sent_via: string | null
          status: string
          subtotal: number | null
          trade_allowance: number | null
          trade_credit: number | null
          trade_in_valuation_id: string | null
          updated_at: string
          video_url: string | null
          viewed_at: string | null
          workspace_id: string
        }
        Insert: {
          ai_recommendation?: Json | null
          attachment_total?: number | null
          attachments_included?: Json | null
          brochure_url?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_app_url?: string | null
          customer_company?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          deal_id: string
          discount_total?: number | null
          entry_mode?: string | null
          equipment?: Json
          equipment_total?: number | null
          expires_at?: string | null
          financing_scenarios?: Json | null
          freight_estimate?: number | null
          id?: string
          margin_amount?: number | null
          margin_pct?: number | null
          net_total?: number | null
          pdf_generated_at?: string | null
          pdf_url?: string | null
          photos_included?: Json | null
          quote_number?: string | null
          requires_requote?: boolean | null
          requote_draft_email_id?: string | null
          requote_reason?: string | null
          sent_at?: string | null
          sent_via?: string | null
          status?: string
          subtotal?: number | null
          trade_allowance?: number | null
          trade_credit?: number | null
          trade_in_valuation_id?: string | null
          updated_at?: string
          video_url?: string | null
          viewed_at?: string | null
          workspace_id?: string
        }
        Update: {
          ai_recommendation?: Json | null
          attachment_total?: number | null
          attachments_included?: Json | null
          brochure_url?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_app_url?: string | null
          customer_company?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          deal_id?: string
          discount_total?: number | null
          entry_mode?: string | null
          equipment?: Json
          equipment_total?: number | null
          expires_at?: string | null
          financing_scenarios?: Json | null
          freight_estimate?: number | null
          id?: string
          margin_amount?: number | null
          margin_pct?: number | null
          net_total?: number | null
          pdf_generated_at?: string | null
          pdf_url?: string | null
          photos_included?: Json | null
          quote_number?: string | null
          requires_requote?: boolean | null
          requote_draft_email_id?: string | null
          requote_reason?: string | null
          sent_at?: string | null
          sent_via?: string | null
          status?: string
          subtotal?: number | null
          trade_allowance?: number | null
          trade_credit?: number | null
          trade_in_valuation_id?: string | null
          updated_at?: string
          video_url?: string | null
          viewed_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_packages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_packages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_packages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_packages_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_packages_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_packages_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_packages_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_packages_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_packages_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "quote_packages_requote_draft_email_id_fkey"
            columns: ["requote_draft_email_id"]
            isOneToOne: false
            referencedRelation: "email_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_packages_trade_in_valuation_id_fkey"
            columns: ["trade_in_valuation_id"]
            isOneToOne: false
            referencedRelation: "trade_valuations"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_signatures: {
        Row: {
          created_at: string
          deal_id: string | null
          document_hash: string | null
          id: string
          is_valid: boolean
          quote_package_id: string
          signature_image_url: string | null
          signed_at: string
          signer_email: string | null
          signer_ip: string | null
          signer_name: string
          signer_user_agent: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          deal_id?: string | null
          document_hash?: string | null
          id?: string
          is_valid?: boolean
          quote_package_id: string
          signature_image_url?: string | null
          signed_at?: string
          signer_email?: string | null
          signer_ip?: string | null
          signer_name: string
          signer_user_agent?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          deal_id?: string | null
          document_hash?: string | null
          id?: string
          is_valid?: boolean
          quote_package_id?: string
          signature_image_url?: string | null
          signed_at?: string
          signer_email?: string | null
          signer_ip?: string | null
          signer_name?: string
          signer_user_agent?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_signatures_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_signatures_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_signatures_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_signatures_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_signatures_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_signatures_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "quote_signatures_quote_package_id_fkey"
            columns: ["quote_package_id"]
            isOneToOne: false
            referencedRelation: "price_change_impact"
            referencedColumns: ["quote_package_id"]
          },
          {
            foreignKeyName: "quote_signatures_quote_package_id_fkey"
            columns: ["quote_package_id"]
            isOneToOne: false
            referencedRelation: "quote_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_tax_breakdowns: {
        Row: {
          city_rate: number
          computed_at: string
          computed_by_function: string | null
          county_rate: number
          created_at: string
          disclaimer_version: string
          exemption_certificate_id: string | null
          id: string
          jurisdiction: string
          manual_override: boolean
          override_approver_id: string | null
          override_delta_pct: number | null
          override_reason: string | null
          quote_package_id: string
          source_precedence_used: string
          special_district_rate: number
          stale_after: string
          state_rate: number
          tax_amount: number
          taxable_subtotal: number
          total_rate: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          city_rate?: number
          computed_at?: string
          computed_by_function?: string | null
          county_rate?: number
          created_at?: string
          disclaimer_version?: string
          exemption_certificate_id?: string | null
          id?: string
          jurisdiction: string
          manual_override?: boolean
          override_approver_id?: string | null
          override_delta_pct?: number | null
          override_reason?: string | null
          quote_package_id: string
          source_precedence_used?: string
          special_district_rate?: number
          stale_after?: string
          state_rate?: number
          tax_amount?: number
          taxable_subtotal?: number
          total_rate?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          city_rate?: number
          computed_at?: string
          computed_by_function?: string | null
          county_rate?: number
          created_at?: string
          disclaimer_version?: string
          exemption_certificate_id?: string | null
          id?: string
          jurisdiction?: string
          manual_override?: boolean
          override_approver_id?: string | null
          override_delta_pct?: number | null
          override_reason?: string | null
          quote_package_id?: string
          source_precedence_used?: string
          special_district_rate?: number
          stale_after?: string
          state_rate?: number
          tax_amount?: number
          taxable_subtotal?: number
          total_rate?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_tax_breakdowns_exemption_certificate_id_fkey"
            columns: ["exemption_certificate_id"]
            isOneToOne: false
            referencedRelation: "tax_exemption_certificates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_tax_breakdowns_override_approver_id_fkey"
            columns: ["override_approver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_tax_breakdowns_quote_package_id_fkey"
            columns: ["quote_package_id"]
            isOneToOne: false
            referencedRelation: "price_change_impact"
            referencedColumns: ["quote_package_id"]
          },
          {
            foreignKeyName: "quote_tax_breakdowns_quote_package_id_fkey"
            columns: ["quote_package_id"]
            isOneToOne: false
            referencedRelation: "quote_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          created_at: string
          created_by: string | null
          crm_contact_id: string | null
          crm_deal_id: string | null
          customer_snapshot: Json
          deleted_at: string | null
          id: string
          line_items: Json
          linked_at: string | null
          metadata: Json
          status: string
          title: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          crm_contact_id?: string | null
          crm_deal_id?: string | null
          customer_snapshot?: Json
          deleted_at?: string | null
          id?: string
          line_items?: Json
          linked_at?: string | null
          metadata?: Json
          status?: string
          title?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          crm_contact_id?: string | null
          crm_deal_id?: string | null
          customer_snapshot?: Json
          deleted_at?: string | null
          id?: string
          line_items?: Json
          linked_at?: string | null
          metadata?: Json
          status?: string
          title?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_crm_contact_id_fkey"
            columns: ["crm_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_crm_contact_id_fkey"
            columns: ["crm_contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_crm_deal_id_fkey"
            columns: ["crm_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_crm_deal_id_fkey"
            columns: ["crm_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_crm_deal_id_fkey"
            columns: ["crm_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_crm_deal_id_fkey"
            columns: ["crm_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_crm_deal_id_fkey"
            columns: ["crm_deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_crm_deal_id_fkey"
            columns: ["crm_deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      rate_limit_log: {
        Row: {
          created_at: string
          endpoint: string
          id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: number
          user_id: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: number
          user_id?: string
        }
        Relationships: []
      }
      rental_contract_extensions: {
        Row: {
          additional_charge: number | null
          approved_by: string | null
          approved_end_date: string | null
          created_at: string
          customer_reason: string | null
          dealer_response: string | null
          id: string
          payment_invoice_id: string | null
          payment_status: string | null
          rental_contract_id: string
          requested_by: string | null
          requested_end_date: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          additional_charge?: number | null
          approved_by?: string | null
          approved_end_date?: string | null
          created_at?: string
          customer_reason?: string | null
          dealer_response?: string | null
          id?: string
          payment_invoice_id?: string | null
          payment_status?: string | null
          rental_contract_id: string
          requested_by?: string | null
          requested_end_date: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          additional_charge?: number | null
          approved_by?: string | null
          approved_end_date?: string | null
          created_at?: string
          customer_reason?: string | null
          dealer_response?: string | null
          id?: string
          payment_invoice_id?: string | null
          payment_status?: string | null
          rental_contract_id?: string
          requested_by?: string | null
          requested_end_date?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_contract_extensions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_contract_extensions_payment_invoice_id_fkey"
            columns: ["payment_invoice_id"]
            isOneToOne: false
            referencedRelation: "customer_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_contract_extensions_rental_contract_id_fkey"
            columns: ["rental_contract_id"]
            isOneToOne: false
            referencedRelation: "rental_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_contract_extensions_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "portal_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_contracts: {
        Row: {
          agreed_daily_rate: number | null
          agreed_monthly_rate: number | null
          agreed_weekly_rate: number | null
          approved_end_date: string | null
          approved_start_date: string | null
          assignment_status: string
          branch_id: string | null
          created_at: string
          customer_notes: string | null
          dealer_notes: string | null
          dealer_response: string | null
          delivery_location: string | null
          delivery_mode: string
          deposit_amount: number | null
          deposit_invoice_id: string | null
          deposit_required: boolean
          deposit_status: string | null
          equipment_id: string | null
          estimate_daily_rate: number | null
          estimate_monthly_rate: number | null
          estimate_weekly_rate: number | null
          id: string
          portal_customer_id: string
          request_type: string
          requested_category: string | null
          requested_end_date: string
          requested_make: string | null
          requested_model: string | null
          requested_start_date: string
          signed_terms_url: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          agreed_daily_rate?: number | null
          agreed_monthly_rate?: number | null
          agreed_weekly_rate?: number | null
          approved_end_date?: string | null
          approved_start_date?: string | null
          assignment_status?: string
          branch_id?: string | null
          created_at?: string
          customer_notes?: string | null
          dealer_notes?: string | null
          dealer_response?: string | null
          delivery_location?: string | null
          delivery_mode?: string
          deposit_amount?: number | null
          deposit_invoice_id?: string | null
          deposit_required?: boolean
          deposit_status?: string | null
          equipment_id?: string | null
          estimate_daily_rate?: number | null
          estimate_monthly_rate?: number | null
          estimate_weekly_rate?: number | null
          id?: string
          portal_customer_id: string
          request_type?: string
          requested_category?: string | null
          requested_end_date: string
          requested_make?: string | null
          requested_model?: string | null
          requested_start_date: string
          signed_terms_url?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          agreed_daily_rate?: number | null
          agreed_monthly_rate?: number | null
          agreed_weekly_rate?: number | null
          approved_end_date?: string | null
          approved_start_date?: string | null
          assignment_status?: string
          branch_id?: string | null
          created_at?: string
          customer_notes?: string | null
          dealer_notes?: string | null
          dealer_response?: string | null
          delivery_location?: string | null
          delivery_mode?: string
          deposit_amount?: number | null
          deposit_invoice_id?: string | null
          deposit_required?: boolean
          deposit_status?: string | null
          equipment_id?: string | null
          estimate_daily_rate?: number | null
          estimate_monthly_rate?: number | null
          estimate_weekly_rate?: number | null
          id?: string
          portal_customer_id?: string
          request_type?: string
          requested_category?: string | null
          requested_end_date?: string
          requested_make?: string | null
          requested_model?: string | null
          requested_start_date?: string
          signed_terms_url?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_contracts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_contracts_deposit_invoice_id_fkey"
            columns: ["deposit_invoice_id"]
            isOneToOne: false
            referencedRelation: "customer_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_contracts_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_contracts_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "rental_contracts_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_contracts_portal_customer_id_fkey"
            columns: ["portal_customer_id"]
            isOneToOne: false
            referencedRelation: "portal_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_rate_rules: {
        Row: {
          branch_id: string | null
          category: string | null
          created_at: string
          customer_id: string | null
          daily_rate: number | null
          equipment_id: string | null
          id: string
          is_active: boolean
          make: string | null
          minimum_days: number | null
          model: string | null
          monthly_rate: number | null
          notes: string | null
          priority_rank: number
          season_end: string | null
          season_start: string | null
          updated_at: string
          weekly_rate: number | null
          workspace_id: string
        }
        Insert: {
          branch_id?: string | null
          category?: string | null
          created_at?: string
          customer_id?: string | null
          daily_rate?: number | null
          equipment_id?: string | null
          id?: string
          is_active?: boolean
          make?: string | null
          minimum_days?: number | null
          model?: string | null
          monthly_rate?: number | null
          notes?: string | null
          priority_rank?: number
          season_end?: string | null
          season_start?: string | null
          updated_at?: string
          weekly_rate?: number | null
          workspace_id?: string
        }
        Update: {
          branch_id?: string | null
          category?: string | null
          created_at?: string
          customer_id?: string | null
          daily_rate?: number | null
          equipment_id?: string | null
          id?: string
          is_active?: boolean
          make?: string | null
          minimum_days?: number | null
          model?: string | null
          monthly_rate?: number | null
          notes?: string | null
          priority_rank?: number
          season_end?: string | null
          season_start?: string | null
          updated_at?: string
          weekly_rate?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_rate_rules_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_rate_rules_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "portal_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_rate_rules_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_rate_rules_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "rental_rate_rules_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_returns: {
        Row: {
          aging_bucket: string | null
          balance_due: number | null
          charge_amount: number | null
          condition_photos: Json | null
          created_at: string
          credit_invoice_number: string | null
          damage_description: string | null
          decided_by: string | null
          decision_at: string | null
          deposit_amount: number | null
          deposit_covers_charges: boolean | null
          equipment_id: string | null
          has_charges: boolean | null
          id: string
          inspection_checklist: Json | null
          inspection_date: string | null
          inspection_started_at: string | null
          inspector_id: string | null
          original_payment_method: string | null
          refund_check_turnaround: string | null
          refund_method: string | null
          refund_status: string | null
          rental_contract_id: string | null
          rental_contract_reference: string | null
          status: string
          updated_at: string
          work_order_number: string | null
          workspace_id: string
        }
        Insert: {
          aging_bucket?: string | null
          balance_due?: number | null
          charge_amount?: number | null
          condition_photos?: Json | null
          created_at?: string
          credit_invoice_number?: string | null
          damage_description?: string | null
          decided_by?: string | null
          decision_at?: string | null
          deposit_amount?: number | null
          deposit_covers_charges?: boolean | null
          equipment_id?: string | null
          has_charges?: boolean | null
          id?: string
          inspection_checklist?: Json | null
          inspection_date?: string | null
          inspection_started_at?: string | null
          inspector_id?: string | null
          original_payment_method?: string | null
          refund_check_turnaround?: string | null
          refund_method?: string | null
          refund_status?: string | null
          rental_contract_id?: string | null
          rental_contract_reference?: string | null
          status?: string
          updated_at?: string
          work_order_number?: string | null
          workspace_id?: string
        }
        Update: {
          aging_bucket?: string | null
          balance_due?: number | null
          charge_amount?: number | null
          condition_photos?: Json | null
          created_at?: string
          credit_invoice_number?: string | null
          damage_description?: string | null
          decided_by?: string | null
          decision_at?: string | null
          deposit_amount?: number | null
          deposit_covers_charges?: boolean | null
          equipment_id?: string | null
          has_charges?: boolean | null
          id?: string
          inspection_checklist?: Json | null
          inspection_date?: string | null
          inspection_started_at?: string | null
          inspector_id?: string | null
          original_payment_method?: string | null
          refund_check_turnaround?: string | null
          refund_method?: string | null
          refund_status?: string | null
          rental_contract_id?: string | null
          rental_contract_reference?: string | null
          status?: string
          updated_at?: string
          work_order_number?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_returns_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_returns_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_returns_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "rental_returns_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_returns_inspector_id_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_returns_rental_contract_id_fkey"
            columns: ["rental_contract_id"]
            isOneToOne: false
            referencedRelation: "rental_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      rep_preferences: {
        Row: {
          created_at: string
          dark_mode: boolean
          default_pipeline_filter: string
          id: string
          notifications_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dark_mode?: boolean
          default_pipeline_filter?: string
          id?: string
          notifications_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dark_mode?: boolean
          default_pipeline_filter?: string
          id?: string
          notifications_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      replacement_cost_curves: {
        Row: {
          category: string | null
          created_at: string
          hours_bracket: number
          id: string
          make: string
          model: string
          parts_spend_pct_of_new: number
          recommended_action: string | null
          service_spend_pct_of_new: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          hours_bracket: number
          id?: string
          make: string
          model: string
          parts_spend_pct_of_new: number
          recommended_action?: string | null
          service_spend_pct_of_new: number
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          hours_bracket?: number
          id?: string
          make?: string
          model?: string
          parts_spend_pct_of_new?: number
          recommended_action?: string | null
          service_spend_pct_of_new?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      retrieval_events: {
        Row: {
          created_at: string
          embedding_ok: boolean
          evidence_count: number
          feedback: string | null
          id: string
          latency_ms: number | null
          query_text: string
          tool_rounds_used: number
          top_confidence: number | null
          top_source_type: string | null
          trace_id: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          embedding_ok?: boolean
          evidence_count?: number
          feedback?: string | null
          id?: string
          latency_ms?: number | null
          query_text: string
          tool_rounds_used?: number
          top_confidence?: number | null
          top_source_type?: string | null
          trace_id: string
          user_id?: string | null
          workspace_id?: string
        }
        Update: {
          created_at?: string
          embedding_ok?: boolean
          evidence_count?: number
          feedback?: string | null
          id?: string
          latency_ms?: number | null
          query_text?: string
          tool_rounds_used?: number
          top_confidence?: number | null
          top_source_type?: string | null
          trace_id?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retrieval_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_attribution: {
        Row: {
          ai_confidence: number | null
          attributed_amount: number
          attribution_model: string
          computed_at: string
          deal_id: string
          id: string
          touch_chain: Json
          workspace_id: string
        }
        Insert: {
          ai_confidence?: number | null
          attributed_amount?: number
          attribution_model: string
          computed_at?: string
          deal_id: string
          id?: string
          touch_chain?: Json
          workspace_id?: string
        }
        Update: {
          ai_confidence?: number | null
          attributed_amount?: number
          attribution_model?: string
          computed_at?: string
          deal_id?: string
          id?: string
          touch_chain?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_attribution_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_attribution_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_attribution_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_attribution_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_attribution_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_attribution_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      scheduled_follow_ups: {
        Row: {
          assigned_to: string | null
          company_id: string | null
          completed_at: string | null
          completion_notes: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          deal_id: string | null
          description: string | null
          extraction_confidence: number | null
          id: string
          scheduled_for: string
          scheduled_time: string | null
          source: string
          status: string
          title: string
          updated_at: string
          voice_capture_id: string | null
          workspace_id: string
        }
        Insert: {
          assigned_to?: string | null
          company_id?: string | null
          completed_at?: string | null
          completion_notes?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          description?: string | null
          extraction_confidence?: number | null
          id?: string
          scheduled_for: string
          scheduled_time?: string | null
          source?: string
          status?: string
          title: string
          updated_at?: string
          voice_capture_id?: string | null
          workspace_id?: string
        }
        Update: {
          assigned_to?: string | null
          company_id?: string | null
          completed_at?: string | null
          completion_notes?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          description?: string | null
          extraction_confidence?: number | null
          id?: string
          scheduled_for?: string
          scheduled_time?: string | null
          source?: string
          status?: string
          title?: string
          updated_at?: string
          voice_capture_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_follow_ups_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_follow_ups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_follow_ups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_follow_ups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "scheduled_follow_ups_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_follow_ups_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_follow_ups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_follow_ups_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_follow_ups_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_follow_ups_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_follow_ups_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_follow_ups_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_follow_ups_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "scheduled_follow_ups_voice_capture_id_fkey"
            columns: ["voice_capture_id"]
            isOneToOne: false
            referencedRelation: "voice_captures"
            referencedColumns: ["id"]
          },
        ]
      }
      section_179_scenarios: {
        Row: {
          assumptions: Json | null
          bonus_depreciation_amount: number | null
          bonus_depreciation_pct: number | null
          computed_at: string
          created_at: string
          deal_id: string | null
          effective_tax_rate: number | null
          equipment_cost: number
          id: string
          net_cost_after_tax: number | null
          section_179_deduction: number | null
          tax_savings: number | null
          tax_year: number
          total_deduction: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assumptions?: Json | null
          bonus_depreciation_amount?: number | null
          bonus_depreciation_pct?: number | null
          computed_at?: string
          created_at?: string
          deal_id?: string | null
          effective_tax_rate?: number | null
          equipment_cost: number
          id?: string
          net_cost_after_tax?: number | null
          section_179_deduction?: number | null
          tax_savings?: number | null
          tax_year: number
          total_deduction?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          assumptions?: Json | null
          bonus_depreciation_amount?: number | null
          bonus_depreciation_pct?: number | null
          computed_at?: string
          created_at?: string
          deal_id?: string | null
          effective_tax_rate?: number | null
          equipment_cost?: number
          id?: string
          net_cost_after_tax?: number | null
          section_179_deduction?: number | null
          tax_savings?: number | null
          tax_year?: number
          total_deduction?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "section_179_scenarios_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_179_scenarios_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_179_scenarios_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_179_scenarios_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_179_scenarios_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_179_scenarios_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      sequence_enrollments: {
        Row: {
          cancelled_at: string | null
          completed_at: string | null
          contact_id: string | null
          contact_name: string | null
          created_at: string
          current_step: number
          deal_id: string
          deal_name: string | null
          enrolled_at: string
          hub_id: string
          id: string
          metadata: Json | null
          next_step_due_at: string | null
          owner_id: string | null
          sequence_id: string
          status: Database["public"]["Enums"]["enrollment_status"]
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          completed_at?: string | null
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string
          current_step?: number
          deal_id: string
          deal_name?: string | null
          enrolled_at?: string
          hub_id: string
          id?: string
          metadata?: Json | null
          next_step_due_at?: string | null
          owner_id?: string | null
          sequence_id: string
          status?: Database["public"]["Enums"]["enrollment_status"]
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          completed_at?: string | null
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string
          current_step?: number
          deal_id?: string
          deal_name?: string | null
          enrolled_at?: string
          hub_id?: string
          id?: string
          metadata?: Json | null
          next_step_due_at?: string | null
          owner_id?: string | null
          sequence_id?: string
          status?: Database["public"]["Enums"]["enrollment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sequence_enrollments_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "follow_up_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      service_branch_config: {
        Row: {
          appointment_slot_minutes: number
          branch_id: string
          business_hours: Json
          created_at: string
          default_advisor_pool: Json
          default_technician_pool: Json
          id: string
          notes: string | null
          parts_team_notify_user_ids: Json
          planner_rules: Json
          updated_at: string
          workspace_id: string
        }
        Insert: {
          appointment_slot_minutes?: number
          branch_id: string
          business_hours?: Json
          created_at?: string
          default_advisor_pool?: Json
          default_technician_pool?: Json
          id?: string
          notes?: string | null
          parts_team_notify_user_ids?: Json
          planner_rules?: Json
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          appointment_slot_minutes?: number
          branch_id?: string
          business_hours?: Json
          created_at?: string
          default_advisor_pool?: Json
          default_technician_pool?: Json
          id?: string
          notes?: string | null
          parts_team_notify_user_ids?: Json
          planner_rules?: Json
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      service_completion_feedback: {
        Row: {
          actual_problem_fixed: boolean | null
          additional_issues: Json
          created_at: string
          id: string
          job_id: string
          missing_parts: Json
          return_visit_risk: string | null
          serial_specific_note: string | null
          submitted_by: string | null
          time_saver_notes: string | null
          upsell_suggestions: Json
          workspace_id: string
        }
        Insert: {
          actual_problem_fixed?: boolean | null
          additional_issues?: Json
          created_at?: string
          id?: string
          job_id: string
          missing_parts?: Json
          return_visit_risk?: string | null
          serial_specific_note?: string | null
          submitted_by?: string | null
          time_saver_notes?: string | null
          upsell_suggestions?: Json
          workspace_id?: string
        }
        Update: {
          actual_problem_fixed?: boolean | null
          additional_issues?: Json
          created_at?: string
          id?: string
          job_id?: string
          missing_parts?: Json
          return_visit_risk?: string | null
          serial_specific_note?: string | null
          submitted_by?: string | null
          time_saver_notes?: string | null
          upsell_suggestions?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_completion_feedback_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_completion_feedback_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      service_cron_runs: {
        Row: {
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          job_name: string
          metadata: Json
          ok: boolean
          started_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          job_name: string
          metadata?: Json
          ok?: boolean
          started_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          job_name?: string
          metadata?: Json
          ok?: boolean
          started_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      service_customer_notifications: {
        Row: {
          channel: string
          created_at: string
          id: string
          job_id: string
          metadata: Json
          notification_type: string
          recipient: string | null
          sent_at: string
          workspace_id: string
        }
        Insert: {
          channel?: string
          created_at?: string
          id?: string
          job_id: string
          metadata?: Json
          notification_type: string
          recipient?: string | null
          sent_at?: string
          workspace_id?: string
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          job_id?: string
          metadata?: Json
          notification_type?: string
          recipient?: string | null
          sent_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_customer_notifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      service_internal_billing_line_staging: {
        Row: {
          consumed_at: string | null
          created_at: string
          customer_invoice_id: string | null
          description: string | null
          id: string
          line_total: number | null
          line_type: string
          part_number: string | null
          quantity: number
          requirement_id: string | null
          service_job_id: string
          status: string
          unit_cost: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          customer_invoice_id?: string | null
          description?: string | null
          id?: string
          line_total?: number | null
          line_type?: string
          part_number?: string | null
          quantity?: number
          requirement_id?: string | null
          service_job_id: string
          status?: string
          unit_cost?: number
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          customer_invoice_id?: string | null
          description?: string | null
          id?: string
          line_total?: number | null
          line_type?: string
          part_number?: string | null
          quantity?: number
          requirement_id?: string | null
          service_job_id?: string
          status?: string
          unit_cost?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_internal_billing_line_staging_customer_invoice_id_fkey"
            columns: ["customer_invoice_id"]
            isOneToOne: false
            referencedRelation: "customer_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_internal_billing_line_staging_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "service_parts_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_internal_billing_line_staging_service_job_id_fkey"
            columns: ["service_job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      service_job_blockers: {
        Row: {
          blocker_type: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          job_id: string
          resolved_at: string | null
          resolved_by: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          blocker_type: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          job_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          blocker_type?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          job_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_job_blockers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_job_blockers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_job_blockers_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      service_job_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          job_id: string
          metadata: Json
          new_stage: Database["public"]["Enums"]["service_stage"] | null
          old_stage: Database["public"]["Enums"]["service_stage"] | null
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          job_id: string
          metadata?: Json
          new_stage?: Database["public"]["Enums"]["service_stage"] | null
          old_stage?: Database["public"]["Enums"]["service_stage"] | null
          workspace_id?: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          job_id?: string
          metadata?: Json
          new_stage?: Database["public"]["Enums"]["service_stage"] | null
          old_stage?: Database["public"]["Enums"]["service_stage"] | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_job_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      service_jobs: {
        Row: {
          advisor_id: string | null
          ai_diagnosis_summary: string | null
          branch_id: string | null
          closed_at: string | null
          contact_id: string | null
          created_at: string
          current_stage: Database["public"]["Enums"]["service_stage"]
          current_stage_entered_at: string
          customer_id: string | null
          customer_problem_summary: string | null
          deleted_at: string | null
          fulfillment_run_id: string | null
          haul_required: boolean
          id: string
          invoice_total: number | null
          machine_id: string | null
          portal_request_id: string | null
          priority: Database["public"]["Enums"]["service_priority"]
          quote_total: number | null
          request_type: Database["public"]["Enums"]["service_request_type"]
          requested_by_name: string | null
          scheduled_end_at: string | null
          scheduled_start_at: string | null
          selected_job_code_id: string | null
          service_manager_id: string | null
          shop_or_field: string
          source_type: Database["public"]["Enums"]["service_source_type"]
          status_flags: Database["public"]["Enums"]["service_status_flag"][]
          technician_id: string | null
          tracking_token: string
          traffic_ticket_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          advisor_id?: string | null
          ai_diagnosis_summary?: string | null
          branch_id?: string | null
          closed_at?: string | null
          contact_id?: string | null
          created_at?: string
          current_stage?: Database["public"]["Enums"]["service_stage"]
          current_stage_entered_at?: string
          customer_id?: string | null
          customer_problem_summary?: string | null
          deleted_at?: string | null
          fulfillment_run_id?: string | null
          haul_required?: boolean
          id?: string
          invoice_total?: number | null
          machine_id?: string | null
          portal_request_id?: string | null
          priority?: Database["public"]["Enums"]["service_priority"]
          quote_total?: number | null
          request_type?: Database["public"]["Enums"]["service_request_type"]
          requested_by_name?: string | null
          scheduled_end_at?: string | null
          scheduled_start_at?: string | null
          selected_job_code_id?: string | null
          service_manager_id?: string | null
          shop_or_field?: string
          source_type?: Database["public"]["Enums"]["service_source_type"]
          status_flags?: Database["public"]["Enums"]["service_status_flag"][]
          technician_id?: string | null
          tracking_token?: string
          traffic_ticket_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          advisor_id?: string | null
          ai_diagnosis_summary?: string | null
          branch_id?: string | null
          closed_at?: string | null
          contact_id?: string | null
          created_at?: string
          current_stage?: Database["public"]["Enums"]["service_stage"]
          current_stage_entered_at?: string
          customer_id?: string | null
          customer_problem_summary?: string | null
          deleted_at?: string | null
          fulfillment_run_id?: string | null
          haul_required?: boolean
          id?: string
          invoice_total?: number | null
          machine_id?: string | null
          portal_request_id?: string | null
          priority?: Database["public"]["Enums"]["service_priority"]
          quote_total?: number | null
          request_type?: Database["public"]["Enums"]["service_request_type"]
          requested_by_name?: string | null
          scheduled_end_at?: string | null
          scheduled_start_at?: string | null
          selected_job_code_id?: string | null
          service_manager_id?: string | null
          shop_or_field?: string
          source_type?: Database["public"]["Enums"]["service_source_type"]
          status_flags?: Database["public"]["Enums"]["service_status_flag"][]
          technician_id?: string | null
          tracking_token?: string
          traffic_ticket_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_jobs_advisor_id_fkey"
            columns: ["advisor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_jobs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_jobs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_jobs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_jobs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_jobs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "service_jobs_fulfillment_run_id_fkey"
            columns: ["fulfillment_run_id"]
            isOneToOne: false
            referencedRelation: "parts_fulfillment_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_jobs_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_jobs_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "service_jobs_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_jobs_portal_request_id_fkey"
            columns: ["portal_request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_jobs_selected_job_code_fk"
            columns: ["selected_job_code_id"]
            isOneToOne: false
            referencedRelation: "job_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_jobs_service_manager_id_fkey"
            columns: ["service_manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_jobs_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_jobs_traffic_ticket_id_fkey"
            columns: ["traffic_ticket_id"]
            isOneToOne: false
            referencedRelation: "traffic_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      service_knowledge_base: {
        Row: {
          contributed_by: string | null
          created_at: string
          fault_code: string | null
          id: string
          make: string | null
          model: string | null
          parts_used: Json
          solution: string
          symptom: string
          updated_at: string
          use_count: number
          verified: boolean
          verified_at: string | null
          verified_by: string | null
          workspace_id: string
        }
        Insert: {
          contributed_by?: string | null
          created_at?: string
          fault_code?: string | null
          id?: string
          make?: string | null
          model?: string | null
          parts_used?: Json
          solution: string
          symptom: string
          updated_at?: string
          use_count?: number
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
          workspace_id?: string
        }
        Update: {
          contributed_by?: string | null
          created_at?: string
          fault_code?: string | null
          id?: string
          make?: string | null
          model?: string | null
          parts_used?: Json
          solution?: string
          symptom?: string
          updated_at?: string
          use_count?: number
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_knowledge_base_contributed_by_fkey"
            columns: ["contributed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_knowledge_base_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      service_parts_actions: {
        Row: {
          action_type: Database["public"]["Enums"]["service_parts_action_type"]
          actor_id: string | null
          completed_at: string | null
          created_at: string
          expected_date: string | null
          from_branch: string | null
          id: string
          job_id: string
          metadata: Json
          plan_batch_id: string | null
          po_reference: string | null
          requirement_id: string
          superseded_at: string | null
          to_branch: string | null
          updated_at: string
          vendor_id: string | null
          workspace_id: string
        }
        Insert: {
          action_type: Database["public"]["Enums"]["service_parts_action_type"]
          actor_id?: string | null
          completed_at?: string | null
          created_at?: string
          expected_date?: string | null
          from_branch?: string | null
          id?: string
          job_id: string
          metadata?: Json
          plan_batch_id?: string | null
          po_reference?: string | null
          requirement_id: string
          superseded_at?: string | null
          to_branch?: string | null
          updated_at?: string
          vendor_id?: string | null
          workspace_id?: string
        }
        Update: {
          action_type?: Database["public"]["Enums"]["service_parts_action_type"]
          actor_id?: string | null
          completed_at?: string | null
          created_at?: string
          expected_date?: string | null
          from_branch?: string | null
          id?: string
          job_id?: string
          metadata?: Json
          plan_batch_id?: string | null
          po_reference?: string | null
          requirement_id?: string
          superseded_at?: string | null
          to_branch?: string | null
          updated_at?: string
          vendor_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_parts_actions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_parts_actions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_parts_actions_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "service_parts_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spa_vendor_fk"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_health_scorecard"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "spa_vendor_fk"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      service_parts_inventory_overrides: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          insufficient: boolean
          job_id: string
          part_number: string
          qty_on_hand_after: number | null
          quantity_requested: number
          reason: string
          requirement_id: string
          workspace_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          id?: string
          insufficient?: boolean
          job_id: string
          part_number: string
          qty_on_hand_after?: number | null
          quantity_requested: number
          reason: string
          requirement_id: string
          workspace_id?: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          insufficient?: boolean
          job_id?: string
          part_number?: string
          qty_on_hand_after?: number | null
          quantity_requested?: number
          reason?: string
          requirement_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_parts_inventory_overrides_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_parts_inventory_overrides_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_parts_inventory_overrides_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "service_parts_requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      service_parts_requirements: {
        Row: {
          confidence: string
          created_at: string
          description: string | null
          id: string
          intake_line_status: string
          job_id: string
          need_by_date: string | null
          notes: string | null
          part_number: string
          quantity: number
          source: string
          status: string
          unit_cost: number | null
          updated_at: string
          vendor_id: string | null
          workspace_id: string
        }
        Insert: {
          confidence?: string
          created_at?: string
          description?: string | null
          id?: string
          intake_line_status?: string
          job_id: string
          need_by_date?: string | null
          notes?: string | null
          part_number: string
          quantity?: number
          source?: string
          status?: string
          unit_cost?: number | null
          updated_at?: string
          vendor_id?: string | null
          workspace_id?: string
        }
        Update: {
          confidence?: string
          created_at?: string
          description?: string | null
          id?: string
          intake_line_status?: string
          job_id?: string
          need_by_date?: string | null
          notes?: string | null
          part_number?: string
          quantity?: number
          source?: string
          status?: string
          unit_cost?: number | null
          updated_at?: string
          vendor_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_parts_requirements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spr_vendor_fk"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_health_scorecard"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "spr_vendor_fk"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      service_parts_staging: {
        Row: {
          bin_location: string | null
          created_at: string
          id: string
          job_id: string
          requirement_id: string
          staged_at: string
          staged_by: string | null
          workspace_id: string
        }
        Insert: {
          bin_location?: string | null
          created_at?: string
          id?: string
          job_id: string
          requirement_id: string
          staged_at?: string
          staged_by?: string | null
          workspace_id?: string
        }
        Update: {
          bin_location?: string | null
          created_at?: string
          id?: string
          job_id?: string
          requirement_id?: string
          staged_at?: string
          staged_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_parts_staging_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_parts_staging_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "service_parts_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_parts_staging_staged_by_fkey"
            columns: ["staged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      service_quote_approvals: {
        Row: {
          approval_type: string
          approved_at: string
          approved_by: string | null
          created_at: string
          id: string
          method: string
          notes: string | null
          quote_id: string
          signature_url: string | null
          workspace_id: string
        }
        Insert: {
          approval_type: string
          approved_at?: string
          approved_by?: string | null
          created_at?: string
          id?: string
          method: string
          notes?: string | null
          quote_id: string
          signature_url?: string | null
          workspace_id?: string
        }
        Update: {
          approval_type?: string
          approved_at?: string
          approved_by?: string | null
          created_at?: string
          id?: string
          method?: string
          notes?: string | null
          quote_id?: string
          signature_url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_quote_approvals_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "service_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      service_quote_lines: {
        Row: {
          created_at: string
          description: string
          extended_price: number
          id: string
          line_type: string
          part_requirement_id: string | null
          quantity: number
          quote_id: string
          sort_order: number
          unit_price: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description: string
          extended_price?: number
          id?: string
          line_type: string
          part_requirement_id?: string | null
          quantity?: number
          quote_id: string
          sort_order?: number
          unit_price?: number
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          description?: string
          extended_price?: number
          id?: string
          line_type?: string
          part_requirement_id?: string | null
          quantity?: number
          quote_id?: string
          sort_order?: number
          unit_price?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_quote_lines_part_requirement_id_fkey"
            columns: ["part_requirement_id"]
            isOneToOne: false
            referencedRelation: "service_parts_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_quote_lines_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "service_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      service_quotes: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          haul_total: number
          id: string
          job_id: string
          labor_total: number
          notes: string | null
          parts_total: number
          sent_at: string | null
          shop_supplies: number
          status: string
          total: number
          updated_at: string
          version: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          haul_total?: number
          id?: string
          job_id: string
          labor_total?: number
          notes?: string | null
          parts_total?: number
          sent_at?: string | null
          shop_supplies?: number
          status?: string
          total?: number
          updated_at?: string
          version?: number
          workspace_id?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          haul_total?: number
          id?: string
          job_id?: string
          labor_total?: number
          notes?: string | null
          parts_total?: number
          sent_at?: string | null
          shop_supplies?: number
          status?: string
          total?: number
          updated_at?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_quotes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_quotes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      service_requests: {
        Row: {
          actual_completion: string | null
          assigned_to: string | null
          created_at: string
          department: string | null
          description: string
          estimate_amount: number | null
          estimated_completion: string | null
          final_amount: number | null
          fleet_id: string | null
          id: string
          invoice_reference: string | null
          photos: Json | null
          portal_customer_id: string
          preferred_branch: string | null
          preferred_date: string | null
          request_type: string
          service_job_id: string | null
          status: string
          updated_at: string
          urgency: string
          workspace_id: string
        }
        Insert: {
          actual_completion?: string | null
          assigned_to?: string | null
          created_at?: string
          department?: string | null
          description: string
          estimate_amount?: number | null
          estimated_completion?: string | null
          final_amount?: number | null
          fleet_id?: string | null
          id?: string
          invoice_reference?: string | null
          photos?: Json | null
          portal_customer_id: string
          preferred_branch?: string | null
          preferred_date?: string | null
          request_type: string
          service_job_id?: string | null
          status?: string
          updated_at?: string
          urgency?: string
          workspace_id?: string
        }
        Update: {
          actual_completion?: string | null
          assigned_to?: string | null
          created_at?: string
          department?: string | null
          description?: string
          estimate_amount?: number | null
          estimated_completion?: string | null
          final_amount?: number | null
          fleet_id?: string | null
          id?: string
          invoice_reference?: string | null
          photos?: Json | null
          portal_customer_id?: string
          preferred_branch?: string | null
          preferred_date?: string | null
          request_type?: string
          service_job_id?: string | null
          status?: string
          updated_at?: string
          urgency?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_requests_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "customer_fleet"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "portal_trade_in_opportunities"
            referencedColumns: ["fleet_id"]
          },
          {
            foreignKeyName: "service_requests_portal_customer_id_fkey"
            columns: ["portal_customer_id"]
            isOneToOne: false
            referencedRelation: "portal_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_service_job_id_fkey"
            columns: ["service_job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      service_tat_metrics: {
        Row: {
          actual_duration_hours: number | null
          completed_at: string | null
          created_at: string
          id: string
          is_machine_down: boolean
          job_id: string
          segment_name: string
          started_at: string
          target_duration_hours: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          actual_duration_hours?: number | null
          completed_at?: string | null
          created_at?: string
          id?: string
          is_machine_down?: boolean
          job_id: string
          segment_name: string
          started_at: string
          target_duration_hours?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          actual_duration_hours?: number | null
          completed_at?: string | null
          created_at?: string
          id?: string
          is_machine_down?: boolean
          job_id?: string
          segment_name?: string
          started_at?: string
          target_duration_hours?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_tat_metrics_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      service_tat_targets: {
        Row: {
          created_at: string
          current_stage: string
          id: string
          machine_down_target_hours: number
          target_hours: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          current_stage: string
          id?: string
          machine_down_target_hours: number
          target_hours: number
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          current_stage?: string
          id?: string
          machine_down_target_hours?: number
          target_hours?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      service_timecards: {
        Row: {
          clocked_in_at: string
          clocked_out_at: string | null
          created_at: string
          hours: number | null
          id: string
          notes: string | null
          service_job_id: string
          technician_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          clocked_in_at?: string
          clocked_out_at?: string | null
          created_at?: string
          hours?: number | null
          id?: string
          notes?: string | null
          service_job_id: string
          technician_id: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          clocked_in_at?: string
          clocked_out_at?: string | null
          created_at?: string
          hours?: number | null
          id?: string
          notes?: string | null
          service_job_id?: string
          technician_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_timecards_service_job_id_fkey"
            columns: ["service_job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_timecards_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_accounts: {
        Row: {
          access_token_encrypted: string | null
          account_name: string
          created_at: string
          id: string
          is_active: boolean
          last_posted_at: string | null
          page_id: string | null
          platform: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          access_token_encrypted?: string | null
          account_name: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_posted_at?: string | null
          page_id?: string | null
          platform: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          access_token_encrypted?: string | null
          account_name?: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_posted_at?: string | null
          page_id?: string | null
          platform?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      social_media_posts: {
        Row: {
          campaign_id: string | null
          comments: number | null
          content_text: string
          created_at: string
          equipment_id: string | null
          external_post_id: string | null
          id: string
          images: Json | null
          leads_generated: number | null
          likes: number | null
          link_url: string | null
          platform: string
          posted_at: string | null
          reach: number | null
          scheduled_at: string | null
          shares: number | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          campaign_id?: string | null
          comments?: number | null
          content_text: string
          created_at?: string
          equipment_id?: string | null
          external_post_id?: string | null
          id?: string
          images?: Json | null
          leads_generated?: number | null
          likes?: number | null
          link_url?: string | null
          platform: string
          posted_at?: string | null
          reach?: number | null
          scheduled_at?: string | null
          shares?: number | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          campaign_id?: string | null
          comments?: number | null
          content_text?: string
          created_at?: string
          equipment_id?: string | null
          external_post_id?: string | null
          id?: string
          images?: Json | null
          leads_generated?: number | null
          likes?: number | null
          link_url?: string | null
          platform?: string
          posted_at?: string | null
          reach?: number | null
          scheduled_at?: string | null
          shares?: number | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_media_posts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_media_posts_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_media_posts_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "social_media_posts_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_executions: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          context_entity_id: string | null
          context_entity_type: string | null
          created_at: string
          id: string
          notes: string | null
          sop_template_id: string
          started_at: string
          started_by: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          context_entity_id?: string | null
          context_entity_type?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          sop_template_id: string
          started_at?: string
          started_by?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          context_entity_id?: string | null
          context_entity_type?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          sop_template_id?: string
          started_at?: string
          started_by?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_executions_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_executions_sop_template_id_fkey"
            columns: ["sop_template_id"]
            isOneToOne: false
            referencedRelation: "sop_compliance_summary"
            referencedColumns: ["template_id"]
          },
          {
            foreignKeyName: "sop_executions_sop_template_id_fkey"
            columns: ["sop_template_id"]
            isOneToOne: false
            referencedRelation: "sop_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_executions_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_ingestion_runs: {
        Row: {
          ai_model: string | null
          created_at: string
          document_id: string | null
          id: string
          parse_confidence: number | null
          parse_errors: Json | null
          sop_template_id: string | null
          source_filename: string | null
          status: string
          steps_extracted: number | null
          uploaded_by: string | null
          workspace_id: string
        }
        Insert: {
          ai_model?: string | null
          created_at?: string
          document_id?: string | null
          id?: string
          parse_confidence?: number | null
          parse_errors?: Json | null
          sop_template_id?: string | null
          source_filename?: string | null
          status?: string
          steps_extracted?: number | null
          uploaded_by?: string | null
          workspace_id?: string
        }
        Update: {
          ai_model?: string | null
          created_at?: string
          document_id?: string | null
          id?: string
          parse_confidence?: number | null
          parse_errors?: Json | null
          sop_template_id?: string | null
          source_filename?: string | null
          status?: string
          steps_extracted?: number | null
          uploaded_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_ingestion_runs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_ingestion_runs_sop_template_id_fkey"
            columns: ["sop_template_id"]
            isOneToOne: false
            referencedRelation: "sop_compliance_summary"
            referencedColumns: ["template_id"]
          },
          {
            foreignKeyName: "sop_ingestion_runs_sop_template_id_fkey"
            columns: ["sop_template_id"]
            isOneToOne: false
            referencedRelation: "sop_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_ingestion_runs_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_step_completions: {
        Row: {
          completed_at: string
          completed_by: string | null
          completion_state: string
          confidence_score: number | null
          created_at: string
          decision_taken: string | null
          duration_minutes: number | null
          evidence_urls: Json | null
          id: string
          notes: string | null
          sop_execution_id: string
          sop_step_id: string
          workspace_id: string
        }
        Insert: {
          completed_at?: string
          completed_by?: string | null
          completion_state?: string
          confidence_score?: number | null
          created_at?: string
          decision_taken?: string | null
          duration_minutes?: number | null
          evidence_urls?: Json | null
          id?: string
          notes?: string | null
          sop_execution_id: string
          sop_step_id: string
          workspace_id?: string
        }
        Update: {
          completed_at?: string
          completed_by?: string | null
          completion_state?: string
          confidence_score?: number | null
          created_at?: string
          decision_taken?: string | null
          duration_minutes?: number | null
          evidence_urls?: Json | null
          id?: string
          notes?: string | null
          sop_execution_id?: string
          sop_step_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_step_completions_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_step_completions_sop_execution_id_fkey"
            columns: ["sop_execution_id"]
            isOneToOne: false
            referencedRelation: "sop_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_step_completions_sop_step_id_fkey"
            columns: ["sop_step_id"]
            isOneToOne: false
            referencedRelation: "sop_compliance_summary"
            referencedColumns: ["step_id"]
          },
          {
            foreignKeyName: "sop_step_completions_sop_step_id_fkey"
            columns: ["sop_step_id"]
            isOneToOne: false
            referencedRelation: "sop_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_step_skips: {
        Row: {
          created_at: string
          id: string
          skip_reason: string | null
          skipped_at: string
          skipped_by: string | null
          sop_execution_id: string
          sop_step_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          skip_reason?: string | null
          skipped_at?: string
          skipped_by?: string | null
          sop_execution_id: string
          sop_step_id: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          skip_reason?: string | null
          skipped_at?: string
          skipped_by?: string | null
          sop_execution_id?: string
          sop_step_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_step_skips_skipped_by_fkey"
            columns: ["skipped_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_step_skips_sop_execution_id_fkey"
            columns: ["sop_execution_id"]
            isOneToOne: false
            referencedRelation: "sop_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_step_skips_sop_step_id_fkey"
            columns: ["sop_step_id"]
            isOneToOne: false
            referencedRelation: "sop_compliance_summary"
            referencedColumns: ["step_id"]
          },
          {
            foreignKeyName: "sop_step_skips_sop_step_id_fkey"
            columns: ["sop_step_id"]
            isOneToOne: false
            referencedRelation: "sop_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_steps: {
        Row: {
          attachment_urls: Json | null
          created_at: string
          decision_options: Json | null
          estimated_duration_minutes: number | null
          id: string
          instructions: string | null
          is_decision_point: boolean | null
          required_role: string | null
          sop_template_id: string
          sort_order: number
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          attachment_urls?: Json | null
          created_at?: string
          decision_options?: Json | null
          estimated_duration_minutes?: number | null
          id?: string
          instructions?: string | null
          is_decision_point?: boolean | null
          required_role?: string | null
          sop_template_id: string
          sort_order: number
          title: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          attachment_urls?: Json | null
          created_at?: string
          decision_options?: Json | null
          estimated_duration_minutes?: number | null
          id?: string
          instructions?: string | null
          is_decision_point?: boolean | null
          required_role?: string | null
          sop_template_id?: string
          sort_order?: number
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_steps_sop_template_id_fkey"
            columns: ["sop_template_id"]
            isOneToOne: false
            referencedRelation: "sop_compliance_summary"
            referencedColumns: ["template_id"]
          },
          {
            foreignKeyName: "sop_steps_sop_template_id_fkey"
            columns: ["sop_template_id"]
            isOneToOne: false
            referencedRelation: "sop_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_suppression_queue: {
        Row: {
          confidence_score: number
          created_at: string
          id: string
          proposed_evidence: Json | null
          proposed_state: string
          reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          sop_execution_id: string
          sop_step_id: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          confidence_score: number
          created_at?: string
          id?: string
          proposed_evidence?: Json | null
          proposed_state: string
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          sop_execution_id: string
          sop_step_id: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          confidence_score?: number
          created_at?: string
          id?: string
          proposed_evidence?: Json | null
          proposed_state?: string
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          sop_execution_id?: string
          sop_step_id?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_suppression_queue_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_suppression_queue_sop_execution_id_fkey"
            columns: ["sop_execution_id"]
            isOneToOne: false
            referencedRelation: "sop_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_suppression_queue_sop_step_id_fkey"
            columns: ["sop_step_id"]
            isOneToOne: false
            referencedRelation: "sop_compliance_summary"
            referencedColumns: ["step_id"]
          },
          {
            foreignKeyName: "sop_suppression_queue_sop_step_id_fkey"
            columns: ["sop_step_id"]
            isOneToOne: false
            referencedRelation: "sop_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_template_versions: {
        Row: {
          change_summary: string | null
          created_at: string
          created_by: string | null
          id: string
          snapshot: Json
          sop_template_id: string
          version: number
          workspace_id: string
        }
        Insert: {
          change_summary?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          snapshot: Json
          sop_template_id: string
          version: number
          workspace_id?: string
        }
        Update: {
          change_summary?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          snapshot?: Json
          sop_template_id?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_template_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_template_versions_sop_template_id_fkey"
            columns: ["sop_template_id"]
            isOneToOne: false
            referencedRelation: "sop_compliance_summary"
            referencedColumns: ["template_id"]
          },
          {
            foreignKeyName: "sop_template_versions_sop_template_id_fkey"
            columns: ["sop_template_id"]
            isOneToOne: false
            referencedRelation: "sop_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_templates: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          department: string
          description: string | null
          document_id: string | null
          id: string
          status: string
          tags: Json | null
          title: string
          updated_at: string
          version: number
          workspace_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          department: string
          description?: string | null
          document_id?: string | null
          id?: string
          status?: string
          tags?: Json | null
          title: string
          updated_at?: string
          version?: number
          workspace_id?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          department?: string
          description?: string | null
          document_id?: string | null
          id?: string
          status?: string
          tags?: Json | null
          title?: string
          updated_at?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_templates_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_templates_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      tariff_tracking: {
        Row: {
          created_at: string
          description: string
          effective_date: string
          expiration_date: string | null
          hts_code: string | null
          id: string
          impact_on_cost: number | null
          manufacturer: string | null
          notes: string | null
          origin_country: string | null
          source_url: string | null
          tariff_rate: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description: string
          effective_date: string
          expiration_date?: string | null
          hts_code?: string | null
          id?: string
          impact_on_cost?: number | null
          manufacturer?: string | null
          notes?: string | null
          origin_country?: string | null
          source_url?: string | null
          tariff_rate: number
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          description?: string
          effective_date?: string
          expiration_date?: string | null
          hts_code?: string | null
          id?: string
          impact_on_cost?: number | null
          manufacturer?: string | null
          notes?: string | null
          origin_country?: string | null
          source_url?: string | null
          tariff_rate?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      tax_exemption_certificates: {
        Row: {
          certificate_number: string
          covers_equipment: boolean | null
          covers_parts: boolean | null
          covers_service: boolean | null
          created_at: string
          crm_company_id: string | null
          customer_profile_id: string | null
          document_url: string | null
          effective_date: string
          equipment_application: string | null
          exemption_type: string
          expiration_date: string | null
          id: string
          issuing_state: string
          status: string
          updated_at: string
          verified_at: string | null
          verified_by: string | null
          workspace_id: string
        }
        Insert: {
          certificate_number: string
          covers_equipment?: boolean | null
          covers_parts?: boolean | null
          covers_service?: boolean | null
          created_at?: string
          crm_company_id?: string | null
          customer_profile_id?: string | null
          document_url?: string | null
          effective_date: string
          equipment_application?: string | null
          exemption_type: string
          expiration_date?: string | null
          id?: string
          issuing_state: string
          status?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          workspace_id?: string
        }
        Update: {
          certificate_number?: string
          covers_equipment?: boolean | null
          covers_parts?: boolean | null
          covers_service?: boolean | null
          created_at?: string
          crm_company_id?: string | null
          customer_profile_id?: string | null
          document_url?: string | null
          effective_date?: string
          equipment_application?: string | null
          exemption_type?: string
          expiration_date?: string | null
          id?: string
          issuing_state?: string
          status?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_exemption_certificates_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_exemption_certificates_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_exemption_certificates_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "tax_exemption_certificates_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "customer_profiles_extended"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_exemption_certificates_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "exec_health_movers"
            referencedColumns: ["customer_profile_id"]
          },
          {
            foreignKeyName: "tax_exemption_certificates_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_treatments: {
        Row: {
          applies_to: string
          created_at: string
          effective_date: string | null
          expiration_date: string | null
          id: string
          is_active: boolean
          jurisdiction: string
          name: string
          notes: string | null
          rate: number
          tax_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          applies_to: string
          created_at?: string
          effective_date?: string | null
          expiration_date?: string | null
          id?: string
          is_active?: boolean
          jurisdiction: string
          name: string
          notes?: string | null
          rate?: number
          tax_type: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          applies_to?: string
          created_at?: string
          effective_date?: string | null
          expiration_date?: string | null
          id?: string
          is_active?: boolean
          jurisdiction?: string
          name?: string
          notes?: string | null
          rate?: number
          tax_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      technician_job_performance: {
        Row: {
          actual_hours: number | null
          comeback: boolean
          created_at: string
          estimated_hours: number | null
          id: string
          job_code_id: string | null
          job_id: string
          notes: string | null
          technician_id: string
          variance: number | null
          workspace_id: string
        }
        Insert: {
          actual_hours?: number | null
          comeback?: boolean
          created_at?: string
          estimated_hours?: number | null
          id?: string
          job_code_id?: string | null
          job_id: string
          notes?: string | null
          technician_id: string
          variance?: number | null
          workspace_id?: string
        }
        Update: {
          actual_hours?: number | null
          comeback?: boolean
          created_at?: string
          estimated_hours?: number | null
          id?: string
          job_code_id?: string | null
          job_id?: string
          notes?: string | null
          technician_id?: string
          variance?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "technician_job_performance_job_code_id_fkey"
            columns: ["job_code_id"]
            isOneToOne: false
            referencedRelation: "job_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technician_job_performance_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technician_job_performance_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "technician_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      technician_profiles: {
        Row: {
          active_workload: number
          average_efficiency: number | null
          branch_id: string | null
          brands_supported: Json
          certifications: Json
          created_at: string
          field_eligible: boolean
          id: string
          job_type_history: Json
          shop_eligible: boolean
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          active_workload?: number
          average_efficiency?: number | null
          branch_id?: string | null
          brands_supported?: Json
          certifications?: Json
          created_at?: string
          field_eligible?: boolean
          id?: string
          job_type_history?: Json
          shop_eligible?: boolean
          updated_at?: string
          user_id: string
          workspace_id?: string
        }
        Update: {
          active_workload?: number
          average_efficiency?: number | null
          branch_id?: string | null
          brands_supported?: Json
          certifications?: Json
          created_at?: string
          field_eligible?: boolean
          id?: string
          job_type_history?: Json
          shop_eligible?: boolean
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_technician_profiles_branch"
            columns: ["workspace_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["workspace_id", "slug"]
          },
          {
            foreignKeyName: "technician_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      telematics_feeds: {
        Row: {
          alert_on_excessive_idle: boolean | null
          alert_on_geofence_exit: boolean | null
          created_at: string
          device_id: string
          device_serial: string | null
          equipment_id: string | null
          id: string
          is_active: boolean
          last_hours: number | null
          last_lat: number | null
          last_lng: number | null
          last_reading_at: string | null
          provider: string
          subscription_id: string | null
          sync_interval_minutes: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          alert_on_excessive_idle?: boolean | null
          alert_on_geofence_exit?: boolean | null
          created_at?: string
          device_id: string
          device_serial?: string | null
          equipment_id?: string | null
          id?: string
          is_active?: boolean
          last_hours?: number | null
          last_lat?: number | null
          last_lng?: number | null
          last_reading_at?: string | null
          provider: string
          subscription_id?: string | null
          sync_interval_minutes?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          alert_on_excessive_idle?: boolean | null
          alert_on_geofence_exit?: boolean | null
          created_at?: string
          device_id?: string
          device_serial?: string | null
          equipment_id?: string | null
          id?: string
          is_active?: boolean
          last_hours?: number | null
          last_lat?: number | null
          last_lng?: number | null
          last_reading_at?: string | null
          provider?: string
          subscription_id?: string | null
          sync_interval_minutes?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telematics_feeds_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telematics_feeds_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "telematics_feeds_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telematics_feeds_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "eaas_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_valuations: {
        Row: {
          ai_condition_notes: string | null
          ai_condition_score: number | null
          ai_detected_damage: string[] | null
          approval_notes: string | null
          approved_by: string | null
          attachments_included: string[] | null
          auction_value: number | null
          conditional_language: string | null
          created_at: string
          created_by: string | null
          deal_id: string | null
          discount_percentage: number | null
          discounted_value: number | null
          final_value: number | null
          hours: number | null
          id: string
          last_full_service: string | null
          make: string
          market_comps: Json | null
          model: string
          needed_repairs: string | null
          operational_status: string | null
          over_allowance: boolean | null
          photos: Json
          preliminary_value: number | null
          reconditioning_estimate: number | null
          serial_number: string | null
          status: string
          suggested_resale_price: number | null
          target_resale_margin_max: number | null
          target_resale_margin_min: number | null
          updated_at: string
          video_url: string | null
          workspace_id: string
          year: number | null
        }
        Insert: {
          ai_condition_notes?: string | null
          ai_condition_score?: number | null
          ai_detected_damage?: string[] | null
          approval_notes?: string | null
          approved_by?: string | null
          attachments_included?: string[] | null
          auction_value?: number | null
          conditional_language?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          discount_percentage?: number | null
          discounted_value?: number | null
          final_value?: number | null
          hours?: number | null
          id?: string
          last_full_service?: string | null
          make: string
          market_comps?: Json | null
          model: string
          needed_repairs?: string | null
          operational_status?: string | null
          over_allowance?: boolean | null
          photos?: Json
          preliminary_value?: number | null
          reconditioning_estimate?: number | null
          serial_number?: string | null
          status?: string
          suggested_resale_price?: number | null
          target_resale_margin_max?: number | null
          target_resale_margin_min?: number | null
          updated_at?: string
          video_url?: string | null
          workspace_id?: string
          year?: number | null
        }
        Update: {
          ai_condition_notes?: string | null
          ai_condition_score?: number | null
          ai_detected_damage?: string[] | null
          approval_notes?: string | null
          approved_by?: string | null
          attachments_included?: string[] | null
          auction_value?: number | null
          conditional_language?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          discount_percentage?: number | null
          discounted_value?: number | null
          final_value?: number | null
          hours?: number | null
          id?: string
          last_full_service?: string | null
          make?: string
          market_comps?: Json | null
          model?: string
          needed_repairs?: string | null
          operational_status?: string | null
          over_allowance?: boolean | null
          photos?: Json
          preliminary_value?: number | null
          reconditioning_estimate?: number | null
          serial_number?: string | null
          status?: string
          suggested_resale_price?: number | null
          target_resale_margin_max?: number | null
          target_resale_margin_min?: number | null
          updated_at?: string
          video_url?: string | null
          workspace_id?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "trade_valuations_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_valuations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_valuations_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_valuations_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_valuations_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_valuations_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_valuations_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_valuations_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      traffic_tickets: {
        Row: {
          billing_comments: string
          blocker_reason: string | null
          completed_at: string | null
          coordinator_id: string | null
          created_at: string
          deal_id: string | null
          delivery_address: string | null
          delivery_lat: number | null
          delivery_lng: number | null
          delivery_photos: Json | null
          delivery_signature_url: string | null
          demo_id: string | null
          departed_at: string | null
          department: string
          driver_checklist: Json | null
          driver_id: string | null
          equipment_id: string | null
          from_location: string
          hour_meter_reading: number | null
          id: string
          late_reason: string | null
          locked: boolean | null
          problems_reported: string | null
          promised_delivery_at: string | null
          proof_of_delivery_complete: boolean | null
          requested_at: string | null
          requested_by: string | null
          scheduled_confirmed_at: string | null
          service_job_id: string | null
          shipping_date: string
          status: string
          stock_number: string
          ticket_type: string
          to_contact_name: string
          to_contact_phone: string
          to_location: string
          updated_at: string
          urgency: string | null
          workspace_id: string
        }
        Insert: {
          billing_comments: string
          blocker_reason?: string | null
          completed_at?: string | null
          coordinator_id?: string | null
          created_at?: string
          deal_id?: string | null
          delivery_address?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_photos?: Json | null
          delivery_signature_url?: string | null
          demo_id?: string | null
          departed_at?: string | null
          department: string
          driver_checklist?: Json | null
          driver_id?: string | null
          equipment_id?: string | null
          from_location: string
          hour_meter_reading?: number | null
          id?: string
          late_reason?: string | null
          locked?: boolean | null
          problems_reported?: string | null
          promised_delivery_at?: string | null
          proof_of_delivery_complete?: boolean | null
          requested_at?: string | null
          requested_by?: string | null
          scheduled_confirmed_at?: string | null
          service_job_id?: string | null
          shipping_date: string
          status?: string
          stock_number: string
          ticket_type: string
          to_contact_name: string
          to_contact_phone: string
          to_location: string
          updated_at?: string
          urgency?: string | null
          workspace_id?: string
        }
        Update: {
          billing_comments?: string
          blocker_reason?: string | null
          completed_at?: string | null
          coordinator_id?: string | null
          created_at?: string
          deal_id?: string | null
          delivery_address?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_photos?: Json | null
          delivery_signature_url?: string | null
          demo_id?: string | null
          departed_at?: string | null
          department?: string
          driver_checklist?: Json | null
          driver_id?: string | null
          equipment_id?: string | null
          from_location?: string
          hour_meter_reading?: number | null
          id?: string
          late_reason?: string | null
          locked?: boolean | null
          problems_reported?: string | null
          promised_delivery_at?: string | null
          proof_of_delivery_complete?: boolean | null
          requested_at?: string | null
          requested_by?: string | null
          scheduled_confirmed_at?: string | null
          service_job_id?: string | null
          shipping_date?: string
          status?: string
          stock_number?: string
          ticket_type?: string
          to_contact_name?: string
          to_contact_phone?: string
          to_location?: string
          updated_at?: string
          urgency?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "traffic_tickets_coordinator_id_fkey"
            columns: ["coordinator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traffic_tickets_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traffic_tickets_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traffic_tickets_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traffic_tickets_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traffic_tickets_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traffic_tickets_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "traffic_tickets_demo_id_fkey"
            columns: ["demo_id"]
            isOneToOne: false
            referencedRelation: "demos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traffic_tickets_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traffic_tickets_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traffic_tickets_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "traffic_tickets_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traffic_tickets_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traffic_tickets_service_job_id_fkey"
            columns: ["service_job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_contacts: {
        Row: {
          contact_name: string
          created_at: string
          email: string | null
          escalation_tier: number
          id: string
          is_primary: boolean
          notes: string | null
          phone: string | null
          role: string | null
          updated_at: string
          vendor_id: string
          workspace_id: string
        }
        Insert: {
          contact_name: string
          created_at?: string
          email?: string | null
          escalation_tier?: number
          id?: string
          is_primary?: boolean
          notes?: string | null
          phone?: string | null
          role?: string | null
          updated_at?: string
          vendor_id: string
          workspace_id?: string
        }
        Update: {
          contact_name?: string
          created_at?: string
          email?: string | null
          escalation_tier?: number
          id?: string
          is_primary?: boolean
          notes?: string | null
          phone?: string | null
          role?: string | null
          updated_at?: string
          vendor_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_contacts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_health_scorecard"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "vendor_contacts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_escalation_policies: {
        Row: {
          created_at: string
          id: string
          is_machine_down: boolean
          name: string
          steps: Json
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_machine_down?: boolean
          name: string
          steps?: Json
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_machine_down?: boolean
          name?: string
          steps?: Json
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      vendor_escalations: {
        Row: {
          created_at: string
          current_step: number
          id: string
          job_id: string | null
          next_action_at: string | null
          po_reference: string | null
          policy_id: string | null
          resolution_notes: string | null
          resolved_at: string | null
          updated_at: string
          vendor_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          current_step?: number
          id?: string
          job_id?: string | null
          next_action_at?: string | null
          po_reference?: string | null
          policy_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          updated_at?: string
          vendor_id: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          current_step?: number
          id?: string
          job_id?: string | null
          next_action_at?: string | null
          po_reference?: string | null
          policy_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          updated_at?: string
          vendor_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_escalations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_escalations_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "vendor_escalation_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_escalations_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_health_scorecard"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "vendor_escalations_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_order_schedules: {
        Row: {
          branch_code: string
          created_at: string
          cutoff_time: string | null
          day_of_week: string | null
          frequency: string
          id: string
          is_active: boolean
          notes: string | null
          updated_at: string
          vendor_code: string | null
          vendor_id: string
          workspace_id: string
        }
        Insert: {
          branch_code?: string
          created_at?: string
          cutoff_time?: string | null
          day_of_week?: string | null
          frequency: string
          id?: string
          is_active?: boolean
          notes?: string | null
          updated_at?: string
          vendor_code?: string | null
          vendor_id: string
          workspace_id?: string
        }
        Update: {
          branch_code?: string
          created_at?: string
          cutoff_time?: string | null
          day_of_week?: string | null
          frequency?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          updated_at?: string
          vendor_code?: string | null
          vendor_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_order_schedules_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_health_scorecard"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "vendor_order_schedules_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_part_catalog: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_preferred: boolean
          lead_time_days: number | null
          part_number: string
          unit_cost: number | null
          updated_at: string
          vendor_id: string
          vendor_sku: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_preferred?: boolean
          lead_time_days?: number | null
          part_number: string
          unit_cost?: number | null
          updated_at?: string
          vendor_id: string
          vendor_sku?: string | null
          workspace_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_preferred?: boolean
          lead_time_days?: number | null
          part_number?: string
          unit_cost?: number | null
          updated_at?: string
          vendor_id?: string
          vendor_sku?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_part_catalog_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_health_scorecard"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "vendor_part_catalog_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_profiles: {
        Row: {
          after_hours_contact: string | null
          avg_lead_time_hours: number | null
          category_support: Json
          composite_score: number | null
          created_at: string
          fill_rate: number | null
          id: string
          machine_down_escalation_path: string | null
          machine_down_priority: boolean
          name: string
          notes: string | null
          price_competitiveness: number | null
          responsiveness_score: number | null
          score_computed_at: string | null
          supplier_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          after_hours_contact?: string | null
          avg_lead_time_hours?: number | null
          category_support?: Json
          composite_score?: number | null
          created_at?: string
          fill_rate?: number | null
          id?: string
          machine_down_escalation_path?: string | null
          machine_down_priority?: boolean
          name: string
          notes?: string | null
          price_competitiveness?: number | null
          responsiveness_score?: number | null
          score_computed_at?: string | null
          supplier_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          after_hours_contact?: string | null
          avg_lead_time_hours?: number | null
          category_support?: Json
          composite_score?: number | null
          created_at?: string
          fill_rate?: number | null
          id?: string
          machine_down_escalation_path?: string | null
          machine_down_priority?: boolean
          name?: string
          notes?: string | null
          price_competitiveness?: number | null
          responsiveness_score?: number | null
          score_computed_at?: string | null
          supplier_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      voice_captures: {
        Row: {
          audio_storage_path: string | null
          competitor_mentions: string[] | null
          created_at: string
          duration_seconds: number | null
          extracted_data: Json
          hubspot_contact_id: string | null
          hubspot_deal_id: string | null
          hubspot_note_id: string | null
          hubspot_synced_at: string | null
          hubspot_task_id: string | null
          id: string
          intelligence_processed_at: string | null
          linked_company_id: string | null
          linked_contact_id: string | null
          linked_deal_id: string | null
          manager_attention: boolean
          sentiment: string | null
          sync_error: string | null
          sync_status: Database["public"]["Enums"]["voice_capture_status"]
          transcript: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          audio_storage_path?: string | null
          competitor_mentions?: string[] | null
          created_at?: string
          duration_seconds?: number | null
          extracted_data?: Json
          hubspot_contact_id?: string | null
          hubspot_deal_id?: string | null
          hubspot_note_id?: string | null
          hubspot_synced_at?: string | null
          hubspot_task_id?: string | null
          id?: string
          intelligence_processed_at?: string | null
          linked_company_id?: string | null
          linked_contact_id?: string | null
          linked_deal_id?: string | null
          manager_attention?: boolean
          sentiment?: string | null
          sync_error?: string | null
          sync_status?: Database["public"]["Enums"]["voice_capture_status"]
          transcript?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          audio_storage_path?: string | null
          competitor_mentions?: string[] | null
          created_at?: string
          duration_seconds?: number | null
          extracted_data?: Json
          hubspot_contact_id?: string | null
          hubspot_deal_id?: string | null
          hubspot_note_id?: string | null
          hubspot_synced_at?: string | null
          hubspot_task_id?: string | null
          id?: string
          intelligence_processed_at?: string | null
          linked_company_id?: string | null
          linked_contact_id?: string | null
          linked_deal_id?: string | null
          manager_attention?: boolean
          sentiment?: string | null
          sync_error?: string | null
          sync_status?: Database["public"]["Enums"]["voice_capture_status"]
          transcript?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_captures_linked_company_id_fkey"
            columns: ["linked_company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_captures_linked_company_id_fkey"
            columns: ["linked_company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_captures_linked_company_id_fkey"
            columns: ["linked_company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "voice_captures_linked_contact_id_fkey"
            columns: ["linked_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_captures_linked_contact_id_fkey"
            columns: ["linked_contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_captures_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_captures_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_captures_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_captures_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_captures_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_captures_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "voice_captures_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_extracted_equipment: {
        Row: {
          company_id: string | null
          created_at: string
          crm_equipment_id: string | null
          current_value_estimate: number | null
          hours: number | null
          id: string
          linked_deal_id: string | null
          make: string | null
          mentioned_as: string | null
          model: string | null
          raw_mention: string | null
          serial_number: string | null
          voice_capture_id: string
          workspace_id: string
          year: number | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          crm_equipment_id?: string | null
          current_value_estimate?: number | null
          hours?: number | null
          id?: string
          linked_deal_id?: string | null
          make?: string | null
          mentioned_as?: string | null
          model?: string | null
          raw_mention?: string | null
          serial_number?: string | null
          voice_capture_id: string
          workspace_id?: string
          year?: number | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          crm_equipment_id?: string | null
          current_value_estimate?: number | null
          hours?: number | null
          id?: string
          linked_deal_id?: string | null
          make?: string | null
          mentioned_as?: string | null
          model?: string | null
          raw_mention?: string | null
          serial_number?: string | null
          voice_capture_id?: string
          workspace_id?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "voice_extracted_equipment_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_extracted_equipment_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_extracted_equipment_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "voice_extracted_equipment_crm_equipment_id_fkey"
            columns: ["crm_equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_extracted_equipment_crm_equipment_id_fkey"
            columns: ["crm_equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "voice_extracted_equipment_crm_equipment_id_fkey"
            columns: ["crm_equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_extracted_equipment_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_extracted_equipment_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_extracted_equipment_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_extracted_equipment_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_extracted_equipment_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_extracted_equipment_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "voice_extracted_equipment_voice_capture_id_fkey"
            columns: ["voice_capture_id"]
            isOneToOne: false
            referencedRelation: "voice_captures"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_interactions: {
        Row: {
          client_context: Json | null
          cost_usd_cents: number | null
          created_at: string
          elapsed_ms: number | null
          error_message: string | null
          id: string
          intent: Database["public"]["Enums"]["voice_intent"] | null
          intent_confidence: number | null
          model: string | null
          response_spoken: boolean
          response_text: string | null
          success: boolean
          tokens_in: number | null
          tokens_out: number | null
          tool_calls: Json
          transcript: string
          transcript_confidence: number | null
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          client_context?: Json | null
          cost_usd_cents?: number | null
          created_at?: string
          elapsed_ms?: number | null
          error_message?: string | null
          id?: string
          intent?: Database["public"]["Enums"]["voice_intent"] | null
          intent_confidence?: number | null
          model?: string | null
          response_spoken?: boolean
          response_text?: string | null
          success?: boolean
          tokens_in?: number | null
          tokens_out?: number | null
          tool_calls?: Json
          transcript: string
          transcript_confidence?: number | null
          user_id?: string | null
          workspace_id?: string
        }
        Update: {
          client_context?: Json | null
          cost_usd_cents?: number | null
          created_at?: string
          elapsed_ms?: number | null
          error_message?: string | null
          id?: string
          intent?: Database["public"]["Enums"]["voice_intent"] | null
          intent_confidence?: number | null
          model?: string | null
          response_spoken?: boolean
          response_text?: string | null
          success?: boolean
          tokens_in?: number | null
          tokens_out?: number | null
          tool_calls?: Json
          transcript?: string
          transcript_confidence?: number | null
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_interactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_qrm_results: {
        Row: {
          additional_deal_ids: string[] | null
          budget_cycle_captured: boolean | null
          cadence_id: string | null
          company_id: string | null
          company_match_confidence: number | null
          company_match_method: string | null
          contact_id: string | null
          contact_match_confidence: number | null
          contact_match_method: string | null
          content_type: string | null
          created_at: string
          deal_action: string | null
          deal_id: string | null
          entity_creation_duration_ms: number | null
          errors: Json | null
          extracted_equipment_ids: string[] | null
          extraction_duration_ms: number | null
          follow_up_suggestions: Json | null
          id: string
          needs_assessment_id: string | null
          qrm_narrative: string | null
          scheduled_follow_up_ids: string[] | null
          sentiment_score: number | null
          total_duration_ms: number | null
          voice_capture_id: string
          workspace_id: string
        }
        Insert: {
          additional_deal_ids?: string[] | null
          budget_cycle_captured?: boolean | null
          cadence_id?: string | null
          company_id?: string | null
          company_match_confidence?: number | null
          company_match_method?: string | null
          contact_id?: string | null
          contact_match_confidence?: number | null
          contact_match_method?: string | null
          content_type?: string | null
          created_at?: string
          deal_action?: string | null
          deal_id?: string | null
          entity_creation_duration_ms?: number | null
          errors?: Json | null
          extracted_equipment_ids?: string[] | null
          extraction_duration_ms?: number | null
          follow_up_suggestions?: Json | null
          id?: string
          needs_assessment_id?: string | null
          qrm_narrative?: string | null
          scheduled_follow_up_ids?: string[] | null
          sentiment_score?: number | null
          total_duration_ms?: number | null
          voice_capture_id: string
          workspace_id?: string
        }
        Update: {
          additional_deal_ids?: string[] | null
          budget_cycle_captured?: boolean | null
          cadence_id?: string | null
          company_id?: string | null
          company_match_confidence?: number | null
          company_match_method?: string | null
          contact_id?: string | null
          contact_match_confidence?: number | null
          contact_match_method?: string | null
          content_type?: string | null
          created_at?: string
          deal_action?: string | null
          deal_id?: string | null
          entity_creation_duration_ms?: number | null
          errors?: Json | null
          extracted_equipment_ids?: string[] | null
          extraction_duration_ms?: number | null
          follow_up_suggestions?: Json | null
          id?: string
          needs_assessment_id?: string | null
          qrm_narrative?: string | null
          scheduled_follow_up_ids?: string[] | null
          sentiment_score?: number | null
          total_duration_ms?: number | null
          voice_capture_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_qrm_results_cadence_id_fkey"
            columns: ["cadence_id"]
            isOneToOne: false
            referencedRelation: "follow_up_cadences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_qrm_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_qrm_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_qrm_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "voice_qrm_results_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_qrm_results_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_qrm_results_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_qrm_results_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_qrm_results_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_qrm_results_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_qrm_results_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_qrm_results_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "voice_qrm_results_needs_assessment_id_fkey"
            columns: ["needs_assessment_id"]
            isOneToOne: false
            referencedRelation: "needs_assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_qrm_results_voice_capture_id_fkey"
            columns: ["voice_capture_id"]
            isOneToOne: false
            referencedRelation: "voice_captures"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_routing_rules: {
        Row: {
          content_type: string
          created_at: string
          id: string
          is_active: boolean
          notify_channel: string | null
          route_to_role: string | null
          route_to_user_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          content_type: string
          created_at?: string
          id?: string
          is_active?: boolean
          notify_channel?: string | null
          route_to_role?: string | null
          route_to_user_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          content_type?: string
          created_at?: string
          id?: string
          is_active?: boolean
          notify_channel?: string | null
          route_to_role?: string | null
          route_to_user_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_routing_rules_route_to_user_id_fkey"
            columns: ["route_to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_hubspot_portal: {
        Row: {
          connection_id: string
          created_at: string
          hub_id: string
          id: string
          is_active: boolean
          updated_at: string
          workspace_id: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          hub_id: string
          id?: string
          is_active?: boolean
          updated_at?: string
          workspace_id: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          hub_id?: string
          id?: string
          is_active?: boolean
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_hubspot_portal_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "hubspot_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_settings: {
        Row: {
          created_at: string
          iron_escalation_slack_channel: string
          iron_high_value_threshold_cents: number
          iron_user_daily_hard_cap_tokens: number
          iron_user_daily_soft_cap_tokens: number
          iron_workspace_monthly_hard_cap_tokens: number
          iron_workspace_monthly_soft_cap_tokens: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          iron_escalation_slack_channel?: string
          iron_high_value_threshold_cents?: number
          iron_user_daily_hard_cap_tokens?: number
          iron_user_daily_soft_cap_tokens?: number
          iron_workspace_monthly_hard_cap_tokens?: number
          iron_workspace_monthly_soft_cap_tokens?: number
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          iron_escalation_slack_channel?: string
          iron_high_value_threshold_cents?: number
          iron_user_daily_hard_cap_tokens?: number
          iron_user_daily_soft_cap_tokens?: number
          iron_workspace_monthly_hard_cap_tokens?: number
          iron_workspace_monthly_soft_cap_tokens?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      crm_activities: {
        Row: {
          activity_type: Database["public"]["Enums"]["crm_activity_type"] | null
          body: string | null
          company_id: string | null
          contact_id: string | null
          created_at: string | null
          created_by: string | null
          deal_id: string | null
          deleted_at: string | null
          id: string | null
          metadata: Json | null
          occurred_at: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          activity_type?:
            | Database["public"]["Enums"]["crm_activity_type"]
            | null
          body?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deal_id?: string | null
          deleted_at?: string | null
          id?: string | null
          metadata?: Json | null
          occurred_at?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          activity_type?:
            | Database["public"]["Enums"]["crm_activity_type"]
            | null
          body?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deal_id?: string | null
          deleted_at?: string | null
          id?: string | null
          metadata?: Json | null
          occurred_at?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "crm_activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      crm_activity_templates: {
        Row: {
          activity_type: Database["public"]["Enums"]["crm_activity_type"] | null
          body: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string | null
          is_active: boolean | null
          label: string | null
          sort_order: number | null
          task_due_minutes: number | null
          task_status: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          activity_type?:
            | Database["public"]["Enums"]["crm_activity_type"]
            | null
          body?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string | null
          is_active?: boolean | null
          label?: string | null
          sort_order?: number | null
          task_due_minutes?: number | null
          task_status?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          activity_type?:
            | Database["public"]["Enums"]["crm_activity_type"]
            | null
          body?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string | null
          is_active?: boolean | null
          label?: string | null
          sort_order?: number | null
          task_due_minutes?: number | null
          task_status?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_activity_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_auth_audit_events: {
        Row: {
          actor_user_id: string | null
          created_at: string | null
          event_type: Database["public"]["Enums"]["crm_auth_event_type"] | null
          id: string | null
          ip_inet: unknown
          metadata: Json | null
          occurred_at: string | null
          outcome: Database["public"]["Enums"]["crm_auth_event_outcome"] | null
          request_id: string | null
          resource: string | null
          subject_user_id: string | null
          user_agent: string | null
          workspace_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string | null
          event_type?: Database["public"]["Enums"]["crm_auth_event_type"] | null
          id?: string | null
          ip_inet?: unknown
          metadata?: Json | null
          occurred_at?: string | null
          outcome?: Database["public"]["Enums"]["crm_auth_event_outcome"] | null
          request_id?: string | null
          resource?: string | null
          subject_user_id?: string | null
          user_agent?: string | null
          workspace_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string | null
          event_type?: Database["public"]["Enums"]["crm_auth_event_type"] | null
          id?: string | null
          ip_inet?: unknown
          metadata?: Json | null
          occurred_at?: string | null
          outcome?: Database["public"]["Enums"]["crm_auth_event_outcome"] | null
          request_id?: string | null
          resource?: string | null
          subject_user_id?: string | null
          user_agent?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      crm_companies: {
        Row: {
          address_line_1: string | null
          address_line_2: string | null
          assigned_rep_id: string | null
          city: string | null
          classification: string | null
          country: string | null
          county: string | null
          created_at: string | null
          dba: string | null
          deleted_at: string | null
          hubspot_company_id: string | null
          id: string | null
          legal_name: string | null
          metadata: Json | null
          name: string | null
          notes: string | null
          parent_company_id: string | null
          phone: string | null
          postal_code: string | null
          state: string | null
          status: string | null
          territory_code: string | null
          updated_at: string | null
          website: string | null
          workspace_id: string | null
        }
        Insert: {
          address_line_1?: string | null
          address_line_2?: string | null
          assigned_rep_id?: string | null
          city?: string | null
          classification?: string | null
          country?: string | null
          county?: string | null
          created_at?: string | null
          dba?: string | null
          deleted_at?: string | null
          hubspot_company_id?: string | null
          id?: string | null
          legal_name?: string | null
          metadata?: Json | null
          name?: string | null
          notes?: string | null
          parent_company_id?: string | null
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          status?: string | null
          territory_code?: string | null
          updated_at?: string | null
          website?: string | null
          workspace_id?: string | null
        }
        Update: {
          address_line_1?: string | null
          address_line_2?: string | null
          assigned_rep_id?: string | null
          city?: string | null
          classification?: string | null
          country?: string | null
          county?: string | null
          created_at?: string | null
          dba?: string | null
          deleted_at?: string | null
          hubspot_company_id?: string | null
          id?: string | null
          legal_name?: string | null
          metadata?: Json | null
          name?: string | null
          notes?: string | null
          parent_company_id?: string | null
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          status?: string | null
          territory_code?: string | null
          updated_at?: string | null
          website?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_companies_assigned_rep_id_fkey"
            columns: ["assigned_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_companies_parent_company_id_fkey"
            columns: ["parent_company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_companies_parent_company_id_fkey"
            columns: ["parent_company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_companies_parent_company_id_fkey"
            columns: ["parent_company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      crm_contact_companies: {
        Row: {
          company_id: string | null
          contact_id: string | null
          created_at: string | null
          id: string | null
          is_primary: boolean | null
          workspace_id: string | null
        }
        Insert: {
          company_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          id?: string | null
          is_primary?: boolean | null
          workspace_id?: string | null
        }
        Update: {
          company_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          id?: string | null
          is_primary?: boolean | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_contact_companies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_companies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_companies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "crm_contact_companies_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_companies_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contact_tags: {
        Row: {
          contact_id: string | null
          created_at: string | null
          id: string | null
          tag_id: string | null
          workspace_id: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string | null
          id?: string | null
          tag_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string | null
          id?: string | null
          tag_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "crm_tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "qrm_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contact_territories: {
        Row: {
          contact_id: string | null
          created_at: string | null
          id: string | null
          territory_id: string | null
          workspace_id: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string | null
          id?: string | null
          territory_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string | null
          id?: string | null
          territory_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_contact_territories_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_territories_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_territories_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "crm_territories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_territories_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "qrm_territories"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contacts: {
        Row: {
          assigned_rep_id: string | null
          created_at: string | null
          deleted_at: string | null
          dge_customer_profile_id: string | null
          email: string | null
          first_name: string | null
          hubspot_contact_id: string | null
          id: string | null
          last_name: string | null
          merged_into_contact_id: string | null
          metadata: Json | null
          phone: string | null
          primary_company_id: string | null
          title: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          assigned_rep_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          dge_customer_profile_id?: string | null
          email?: string | null
          first_name?: string | null
          hubspot_contact_id?: string | null
          id?: string | null
          last_name?: string | null
          merged_into_contact_id?: string | null
          metadata?: Json | null
          phone?: string | null
          primary_company_id?: string | null
          title?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          assigned_rep_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          dge_customer_profile_id?: string | null
          email?: string | null
          first_name?: string | null
          hubspot_contact_id?: string | null
          id?: string | null
          last_name?: string | null
          merged_into_contact_id?: string | null
          metadata?: Json | null
          phone?: string | null
          primary_company_id?: string | null
          title?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_contacts_assigned_rep_id_fkey"
            columns: ["assigned_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_dge_customer_profile_id_fkey"
            columns: ["dge_customer_profile_id"]
            isOneToOne: false
            referencedRelation: "customer_profiles_extended"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_dge_customer_profile_id_fkey"
            columns: ["dge_customer_profile_id"]
            isOneToOne: false
            referencedRelation: "exec_health_movers"
            referencedColumns: ["customer_profile_id"]
          },
          {
            foreignKeyName: "crm_contacts_merged_into_contact_id_fkey"
            columns: ["merged_into_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_merged_into_contact_id_fkey"
            columns: ["merged_into_contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_primary_company_id_fkey"
            columns: ["primary_company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_primary_company_id_fkey"
            columns: ["primary_company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_primary_company_id_fkey"
            columns: ["primary_company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      crm_custom_field_definitions: {
        Row: {
          constraints: Json | null
          created_at: string | null
          data_type: string | null
          deleted_at: string | null
          id: string | null
          key: string | null
          label: string | null
          object_type:
            | Database["public"]["Enums"]["crm_custom_field_object_type"]
            | null
          required: boolean | null
          sort_order: number | null
          updated_at: string | null
          visibility_roles: Json | null
          workspace_id: string | null
        }
        Insert: {
          constraints?: Json | null
          created_at?: string | null
          data_type?: string | null
          deleted_at?: string | null
          id?: string | null
          key?: string | null
          label?: string | null
          object_type?:
            | Database["public"]["Enums"]["crm_custom_field_object_type"]
            | null
          required?: boolean | null
          sort_order?: number | null
          updated_at?: string | null
          visibility_roles?: Json | null
          workspace_id?: string | null
        }
        Update: {
          constraints?: Json | null
          created_at?: string | null
          data_type?: string | null
          deleted_at?: string | null
          id?: string | null
          key?: string | null
          label?: string | null
          object_type?:
            | Database["public"]["Enums"]["crm_custom_field_object_type"]
            | null
          required?: boolean | null
          sort_order?: number | null
          updated_at?: string | null
          visibility_roles?: Json | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      crm_custom_field_values: {
        Row: {
          created_at: string | null
          definition_id: string | null
          id: string | null
          record_id: string | null
          record_type:
            | Database["public"]["Enums"]["crm_custom_field_object_type"]
            | null
          updated_at: string | null
          value: Json | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          definition_id?: string | null
          id?: string | null
          record_id?: string | null
          record_type?:
            | Database["public"]["Enums"]["crm_custom_field_object_type"]
            | null
          updated_at?: string | null
          value?: Json | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          definition_id?: string | null
          id?: string | null
          record_id?: string | null
          record_type?:
            | Database["public"]["Enums"]["crm_custom_field_object_type"]
            | null
          updated_at?: string | null
          value?: Json | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_custom_field_values_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "crm_custom_field_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_custom_field_values_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "qrm_custom_field_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_deal_equipment: {
        Row: {
          created_at: string | null
          deal_id: string | null
          equipment_id: string | null
          id: string | null
          notes: string | null
          role: Database["public"]["Enums"]["crm_deal_equipment_role"] | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          deal_id?: string | null
          equipment_id?: string | null
          id?: string | null
          notes?: string | null
          role?: Database["public"]["Enums"]["crm_deal_equipment_role"] | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          deal_id?: string | null
          equipment_id?: string | null
          id?: string | null
          notes?: string | null
          role?: Database["public"]["Enums"]["crm_deal_equipment_role"] | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_deal_equipment_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deal_equipment_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deal_equipment_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deal_equipment_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deal_equipment_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deal_equipment_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "crm_deal_equipment_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deal_equipment_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_status_canonical"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "crm_deal_equipment_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "qrm_equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_deal_stages: {
        Row: {
          created_at: string | null
          description: string | null
          hubspot_stage_id: string | null
          id: string | null
          is_closed_lost: boolean | null
          is_closed_won: boolean | null
          name: string | null
          probability: number | null
          sla_minutes: number | null
          sort_order: number | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          hubspot_stage_id?: string | null
          id?: string | null
          is_closed_lost?: boolean | null
          is_closed_won?: boolean | null
          name?: string | null
          probability?: number | null
          sla_minutes?: number | null
          sort_order?: number | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          hubspot_stage_id?: string | null
          id?: string | null
          is_closed_lost?: boolean | null
          is_closed_won?: boolean | null
          name?: string | null
          probability?: number | null
          sla_minutes?: number | null
          sort_order?: number | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      crm_deals: {
        Row: {
          amount: number | null
          assigned_rep_id: string | null
          closed_at: string | null
          company_id: string | null
          competitor: string | null
          created_at: string | null
          deal_score: number | null
          deal_score_factors: Json | null
          deal_score_updated_at: string | null
          deleted_at: string | null
          deposit_amount: number | null
          deposit_status: string | null
          dge_last_scored_at: string | null
          dge_scenario_count: number | null
          dge_score: number | null
          expected_close_on: string | null
          hubspot_deal_id: string | null
          id: string | null
          last_activity_at: string | null
          loss_reason: string | null
          margin_amount: number | null
          margin_check_status: string | null
          margin_pct: number | null
          metadata: Json | null
          name: string | null
          needs_assessment_id: string | null
          next_follow_up_at: string | null
          primary_contact_id: string | null
          sla_deadline_at: string | null
          sla_started_at: string | null
          sort_position: number | null
          stage_id: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          amount?: number | null
          assigned_rep_id?: string | null
          closed_at?: string | null
          company_id?: string | null
          competitor?: string | null
          created_at?: string | null
          deal_score?: number | null
          deal_score_factors?: Json | null
          deal_score_updated_at?: string | null
          deleted_at?: string | null
          deposit_amount?: number | null
          deposit_status?: string | null
          dge_last_scored_at?: string | null
          dge_scenario_count?: number | null
          dge_score?: number | null
          expected_close_on?: string | null
          hubspot_deal_id?: string | null
          id?: string | null
          last_activity_at?: string | null
          loss_reason?: string | null
          margin_amount?: number | null
          margin_check_status?: string | null
          margin_pct?: number | null
          metadata?: Json | null
          name?: string | null
          needs_assessment_id?: string | null
          next_follow_up_at?: string | null
          primary_contact_id?: string | null
          sla_deadline_at?: string | null
          sla_started_at?: string | null
          sort_position?: number | null
          stage_id?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          amount?: number | null
          assigned_rep_id?: string | null
          closed_at?: string | null
          company_id?: string | null
          competitor?: string | null
          created_at?: string | null
          deal_score?: number | null
          deal_score_factors?: Json | null
          deal_score_updated_at?: string | null
          deleted_at?: string | null
          deposit_amount?: number | null
          deposit_status?: string | null
          dge_last_scored_at?: string | null
          dge_scenario_count?: number | null
          dge_score?: number | null
          expected_close_on?: string | null
          hubspot_deal_id?: string | null
          id?: string | null
          last_activity_at?: string | null
          loss_reason?: string | null
          margin_amount?: number | null
          margin_check_status?: string | null
          margin_pct?: number | null
          metadata?: Json | null
          name?: string | null
          needs_assessment_id?: string | null
          next_follow_up_at?: string | null
          primary_contact_id?: string | null
          sla_deadline_at?: string | null
          sla_started_at?: string | null
          sort_position?: number | null
          stage_id?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_deals_assigned_rep_id_fkey"
            columns: ["assigned_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "crm_deals_needs_assessment_id_fkey"
            columns: ["needs_assessment_id"]
            isOneToOne: false
            referencedRelation: "needs_assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_deal_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "exec_pipeline_stage_summary_v"
            referencedColumns: ["stage_id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "mv_exec_pipeline_stage_summary"
            referencedColumns: ["stage_id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "qrm_deal_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_deals_elevated_full: {
        Row: {
          amount: number | null
          assigned_rep_id: string | null
          closed_at: string | null
          company_id: string | null
          competitor: string | null
          created_at: string | null
          deleted_at: string | null
          expected_close_on: string | null
          hubspot_deal_id: string | null
          id: string | null
          last_activity_at: string | null
          loss_reason: string | null
          margin_amount: number | null
          margin_pct: number | null
          metadata: Json | null
          name: string | null
          next_follow_up_at: string | null
          primary_contact_id: string | null
          stage_id: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          amount?: number | null
          assigned_rep_id?: string | null
          closed_at?: string | null
          company_id?: string | null
          competitor?: string | null
          created_at?: string | null
          deleted_at?: string | null
          expected_close_on?: string | null
          hubspot_deal_id?: string | null
          id?: string | null
          last_activity_at?: string | null
          loss_reason?: string | null
          margin_amount?: number | null
          margin_pct?: number | null
          metadata?: Json | null
          name?: string | null
          next_follow_up_at?: string | null
          primary_contact_id?: string | null
          stage_id?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          amount?: number | null
          assigned_rep_id?: string | null
          closed_at?: string | null
          company_id?: string | null
          competitor?: string | null
          created_at?: string | null
          deleted_at?: string | null
          expected_close_on?: string | null
          hubspot_deal_id?: string | null
          id?: string | null
          last_activity_at?: string | null
          loss_reason?: string | null
          margin_amount?: number | null
          margin_pct?: number | null
          metadata?: Json | null
          name?: string | null
          next_follow_up_at?: string | null
          primary_contact_id?: string | null
          stage_id?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_deals_assigned_rep_id_fkey"
            columns: ["assigned_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "crm_deals_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_deal_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "exec_pipeline_stage_summary_v"
            referencedColumns: ["stage_id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "mv_exec_pipeline_stage_summary"
            referencedColumns: ["stage_id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "qrm_deal_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_deals_rep_safe: {
        Row: {
          amount: number | null
          assigned_rep_id: string | null
          closed_at: string | null
          company_id: string | null
          created_at: string | null
          deleted_at: string | null
          deposit_amount: number | null
          deposit_status: string | null
          expected_close_on: string | null
          hubspot_deal_id: string | null
          id: string | null
          last_activity_at: string | null
          margin_pct: number | null
          name: string | null
          next_follow_up_at: string | null
          primary_contact_id: string | null
          sla_deadline_at: string | null
          sort_position: number | null
          stage_id: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          amount?: number | null
          assigned_rep_id?: string | null
          closed_at?: string | null
          company_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          deposit_amount?: number | null
          deposit_status?: string | null
          expected_close_on?: string | null
          hubspot_deal_id?: string | null
          id?: string | null
          last_activity_at?: string | null
          margin_pct?: number | null
          name?: string | null
          next_follow_up_at?: string | null
          primary_contact_id?: string | null
          sla_deadline_at?: string | null
          sort_position?: number | null
          stage_id?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          amount?: number | null
          assigned_rep_id?: string | null
          closed_at?: string | null
          company_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          deposit_amount?: number | null
          deposit_status?: string | null
          expected_close_on?: string | null
          hubspot_deal_id?: string | null
          id?: string | null
          last_activity_at?: string | null
          margin_pct?: number | null
          name?: string | null
          next_follow_up_at?: string | null
          primary_contact_id?: string | null
          sla_deadline_at?: string | null
          sort_position?: number | null
          stage_id?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_deals_assigned_rep_id_fkey"
            columns: ["assigned_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "crm_deals_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_deal_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "exec_pipeline_stage_summary_v"
            referencedColumns: ["stage_id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "mv_exec_pipeline_stage_summary"
            referencedColumns: ["stage_id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "qrm_deal_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_deals_weighted: {
        Row: {
          amount: number | null
          assigned_rep_id: string | null
          closed_at: string | null
          company_id: string | null
          created_at: string | null
          expected_close_on: string | null
          hubspot_deal_id: string | null
          id: string | null
          last_activity_at: string | null
          name: string | null
          next_follow_up_at: string | null
          primary_contact_id: string | null
          stage_id: string | null
          stage_name: string | null
          stage_probability: number | null
          updated_at: string | null
          weighted_amount: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_deals_assigned_rep_id_fkey"
            columns: ["assigned_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "crm_deals_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_deal_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "exec_pipeline_stage_summary_v"
            referencedColumns: ["stage_id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "mv_exec_pipeline_stage_summary"
            referencedColumns: ["stage_id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "qrm_deal_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_duplicate_candidates: {
        Row: {
          created_at: string | null
          id: string | null
          left_contact_id: string | null
          right_contact_id: string | null
          rule_id: string | null
          score: number | null
          status:
            | Database["public"]["Enums"]["crm_duplicate_candidate_status"]
            | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          left_contact_id?: string | null
          right_contact_id?: string | null
          rule_id?: string | null
          score?: number | null
          status?:
            | Database["public"]["Enums"]["crm_duplicate_candidate_status"]
            | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          left_contact_id?: string | null
          right_contact_id?: string | null
          rule_id?: string | null
          score?: number | null
          status?:
            | Database["public"]["Enums"]["crm_duplicate_candidate_status"]
            | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_duplicate_candidates_left_contact_id_fkey"
            columns: ["left_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_duplicate_candidates_left_contact_id_fkey"
            columns: ["left_contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_duplicate_candidates_right_contact_id_fkey"
            columns: ["right_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_duplicate_candidates_right_contact_id_fkey"
            columns: ["right_contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_embeddings: {
        Row: {
          content: string | null
          created_at: string | null
          embedding: string | null
          entity_id: string | null
          entity_type: string | null
          id: string | null
          metadata: Json | null
          updated_at: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          embedding?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          metadata?: Json | null
          updated_at?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          embedding?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          metadata?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      crm_equipment: {
        Row: {
          aging_bucket: string | null
          asset_tag: string | null
          availability:
            | Database["public"]["Enums"]["crm_equipment_availability"]
            | null
          category: Database["public"]["Enums"]["crm_equipment_category"] | null
          company_id: string | null
          condition:
            | Database["public"]["Enums"]["crm_equipment_condition"]
            | null
          created_at: string | null
          current_market_value: number | null
          daily_rental_rate: number | null
          deleted_at: string | null
          engine_hours: number | null
          fuel_type: string | null
          id: string | null
          intake_stage: number | null
          last_inspection_at: string | null
          latitude: number | null
          location_description: string | null
          longitude: number | null
          make: string | null
          metadata: Json | null
          mileage: number | null
          model: string | null
          monthly_rental_rate: number | null
          name: string | null
          next_service_due_at: string | null
          notes: string | null
          operating_capacity: string | null
          ownership:
            | Database["public"]["Enums"]["crm_equipment_ownership"]
            | null
          photo_urls: Json | null
          primary_contact_id: string | null
          purchase_date: string | null
          purchase_price: number | null
          purchased_from_qep: boolean | null
          readiness_blocker_reason: string | null
          readiness_status: string | null
          replacement_cost: number | null
          sale_ready_at: string | null
          serial_number: string | null
          updated_at: string | null
          vin_pin: string | null
          warranty_expires_on: string | null
          weekly_rental_rate: number | null
          weight_class: string | null
          workspace_id: string | null
          year: number | null
        }
        Insert: {
          aging_bucket?: string | null
          asset_tag?: string | null
          availability?:
            | Database["public"]["Enums"]["crm_equipment_availability"]
            | null
          category?:
            | Database["public"]["Enums"]["crm_equipment_category"]
            | null
          company_id?: string | null
          condition?:
            | Database["public"]["Enums"]["crm_equipment_condition"]
            | null
          created_at?: string | null
          current_market_value?: number | null
          daily_rental_rate?: number | null
          deleted_at?: string | null
          engine_hours?: number | null
          fuel_type?: string | null
          id?: string | null
          intake_stage?: number | null
          last_inspection_at?: string | null
          latitude?: number | null
          location_description?: string | null
          longitude?: number | null
          make?: string | null
          metadata?: Json | null
          mileage?: number | null
          model?: string | null
          monthly_rental_rate?: number | null
          name?: string | null
          next_service_due_at?: string | null
          notes?: string | null
          operating_capacity?: string | null
          ownership?:
            | Database["public"]["Enums"]["crm_equipment_ownership"]
            | null
          photo_urls?: Json | null
          primary_contact_id?: string | null
          purchase_date?: string | null
          purchase_price?: number | null
          purchased_from_qep?: boolean | null
          readiness_blocker_reason?: string | null
          readiness_status?: string | null
          replacement_cost?: number | null
          sale_ready_at?: string | null
          serial_number?: string | null
          updated_at?: string | null
          vin_pin?: string | null
          warranty_expires_on?: string | null
          weekly_rental_rate?: number | null
          weight_class?: string | null
          workspace_id?: string | null
          year?: number | null
        }
        Update: {
          aging_bucket?: string | null
          asset_tag?: string | null
          availability?:
            | Database["public"]["Enums"]["crm_equipment_availability"]
            | null
          category?:
            | Database["public"]["Enums"]["crm_equipment_category"]
            | null
          company_id?: string | null
          condition?:
            | Database["public"]["Enums"]["crm_equipment_condition"]
            | null
          created_at?: string | null
          current_market_value?: number | null
          daily_rental_rate?: number | null
          deleted_at?: string | null
          engine_hours?: number | null
          fuel_type?: string | null
          id?: string | null
          intake_stage?: number | null
          last_inspection_at?: string | null
          latitude?: number | null
          location_description?: string | null
          longitude?: number | null
          make?: string | null
          metadata?: Json | null
          mileage?: number | null
          model?: string | null
          monthly_rental_rate?: number | null
          name?: string | null
          next_service_due_at?: string | null
          notes?: string | null
          operating_capacity?: string | null
          ownership?:
            | Database["public"]["Enums"]["crm_equipment_ownership"]
            | null
          photo_urls?: Json | null
          primary_contact_id?: string | null
          purchase_date?: string | null
          purchase_price?: number | null
          purchased_from_qep?: boolean | null
          readiness_blocker_reason?: string | null
          readiness_status?: string | null
          replacement_cost?: number | null
          sale_ready_at?: string | null
          serial_number?: string | null
          updated_at?: string | null
          vin_pin?: string | null
          warranty_expires_on?: string | null
          weekly_rental_rate?: number | null
          weight_class?: string | null
          workspace_id?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_equipment_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_equipment_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_equipment_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "crm_equipment_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_equipment_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_external_id_map: {
        Row: {
          created_at: string | null
          external_id: string | null
          id: string | null
          internal_id: string | null
          object_type: string | null
          source_system: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          external_id?: string | null
          id?: string | null
          internal_id?: string | null
          object_type?: string | null
          source_system?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          external_id?: string | null
          id?: string | null
          internal_id?: string | null
          object_type?: string | null
          source_system?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      crm_geofences: {
        Row: {
          created_at: string | null
          created_by: string | null
          geofence_type: string | null
          id: string | null
          is_active: boolean | null
          linked_company_id: string | null
          linked_deal_id: string | null
          metadata: Json | null
          name: string | null
          polygon: unknown
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          geofence_type?: string | null
          id?: string | null
          is_active?: boolean | null
          linked_company_id?: string | null
          linked_deal_id?: string | null
          metadata?: Json | null
          name?: string | null
          polygon?: unknown
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          geofence_type?: string | null
          id?: string | null
          is_active?: boolean | null
          linked_company_id?: string | null
          linked_deal_id?: string | null
          metadata?: Json | null
          name?: string | null
          polygon?: unknown
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_geofences_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_geofences_linked_company_id_fkey"
            columns: ["linked_company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_geofences_linked_company_id_fkey"
            columns: ["linked_company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_geofences_linked_company_id_fkey"
            columns: ["linked_company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "crm_geofences_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_geofences_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_geofences_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_geofences_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_geofences_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_geofences_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      crm_hubspot_import_errors: {
        Row: {
          created_at: string | null
          entity_type: string | null
          external_id: string | null
          id: string | null
          message: string | null
          payload_snippet: Json | null
          reason_code: string | null
          run_id: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          entity_type?: string | null
          external_id?: string | null
          id?: string | null
          message?: string | null
          payload_snippet?: Json | null
          reason_code?: string | null
          run_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          entity_type?: string | null
          external_id?: string | null
          id?: string | null
          message?: string | null
          payload_snippet?: Json | null
          reason_code?: string | null
          run_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_hubspot_import_errors_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "crm_hubspot_import_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_hubspot_import_errors_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "qrm_hubspot_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_hubspot_import_runs: {
        Row: {
          activities_processed: number | null
          companies_processed: number | null
          completed_at: string | null
          contacts_processed: number | null
          created_at: string | null
          deals_processed: number | null
          error_count: number | null
          error_summary: string | null
          id: string | null
          initiated_by: string | null
          metadata: Json | null
          started_at: string | null
          status: Database["public"]["Enums"]["crm_import_run_status"] | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          activities_processed?: number | null
          companies_processed?: number | null
          completed_at?: string | null
          contacts_processed?: number | null
          created_at?: string | null
          deals_processed?: number | null
          error_count?: number | null
          error_summary?: string | null
          id?: string | null
          initiated_by?: string | null
          metadata?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["crm_import_run_status"] | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          activities_processed?: number | null
          companies_processed?: number | null
          completed_at?: string | null
          contacts_processed?: number | null
          created_at?: string | null
          deals_processed?: number | null
          error_count?: number | null
          error_summary?: string | null
          id?: string | null
          initiated_by?: string | null
          metadata?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["crm_import_run_status"] | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_hubspot_import_runs_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_in_app_notifications: {
        Row: {
          body: string | null
          created_at: string | null
          deal_id: string | null
          id: string | null
          kind: string | null
          metadata: Json | null
          read_at: string | null
          reminder_instance_id: string | null
          title: string | null
          updated_at: string | null
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string | null
          deal_id?: string | null
          id?: string | null
          kind?: string | null
          metadata?: Json | null
          read_at?: string | null
          reminder_instance_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string | null
          deal_id?: string | null
          id?: string | null
          kind?: string | null
          metadata?: Json | null
          read_at?: string | null
          reminder_instance_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_in_app_notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_in_app_notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_in_app_notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_in_app_notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_in_app_notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_in_app_notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "crm_in_app_notifications_reminder_instance_id_fkey"
            columns: ["reminder_instance_id"]
            isOneToOne: false
            referencedRelation: "crm_reminder_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_in_app_notifications_reminder_instance_id_fkey"
            columns: ["reminder_instance_id"]
            isOneToOne: false
            referencedRelation: "qrm_reminder_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_in_app_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_merge_audit_events: {
        Row: {
          actor_user_id: string | null
          created_at: string | null
          id: string | null
          loser_contact_id: string | null
          metadata: Json | null
          occurred_at: string | null
          snapshot: Json | null
          survivor_contact_id: string | null
          workspace_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string | null
          id?: string | null
          loser_contact_id?: string | null
          metadata?: Json | null
          occurred_at?: string | null
          snapshot?: Json | null
          survivor_contact_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string | null
          id?: string | null
          loser_contact_id?: string | null
          metadata?: Json | null
          occurred_at?: string | null
          snapshot?: Json | null
          survivor_contact_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_merge_audit_events_loser_contact_id_fkey"
            columns: ["loser_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_merge_audit_events_loser_contact_id_fkey"
            columns: ["loser_contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_merge_audit_events_survivor_contact_id_fkey"
            columns: ["survivor_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_merge_audit_events_survivor_contact_id_fkey"
            columns: ["survivor_contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_quote_audit_events: {
        Row: {
          actor_user_id: string | null
          created_at: string | null
          event_type: string | null
          id: string | null
          metadata: Json | null
          quote_id: string | null
          request_id: string | null
          workspace_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string | null
          event_type?: string | null
          id?: string | null
          metadata?: Json | null
          quote_id?: string | null
          request_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string | null
          event_type?: string | null
          id?: string | null
          metadata?: Json | null
          quote_id?: string | null
          request_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_quote_audit_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_quote_audit_events_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_reminder_instances: {
        Row: {
          assigned_user_id: string | null
          created_at: string | null
          deal_id: string | null
          deleted_at: string | null
          due_at: string | null
          fired_at: string | null
          id: string | null
          idempotency_key: string | null
          source: Database["public"]["Enums"]["crm_reminder_source"] | null
          status: Database["public"]["Enums"]["crm_reminder_status"] | null
          task_activity_id: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          assigned_user_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          deleted_at?: string | null
          due_at?: string | null
          fired_at?: string | null
          id?: string | null
          idempotency_key?: string | null
          source?: Database["public"]["Enums"]["crm_reminder_source"] | null
          status?: Database["public"]["Enums"]["crm_reminder_status"] | null
          task_activity_id?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          assigned_user_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          deleted_at?: string | null
          due_at?: string | null
          fired_at?: string | null
          id?: string | null
          idempotency_key?: string | null
          source?: Database["public"]["Enums"]["crm_reminder_source"] | null
          status?: Database["public"]["Enums"]["crm_reminder_status"] | null
          task_activity_id?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_reminder_instances_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_reminder_instances_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_reminder_instances_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_reminder_instances_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_reminder_instances_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_reminder_instances_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_reminder_instances_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "crm_reminder_instances_task_activity_id_fkey"
            columns: ["task_activity_id"]
            isOneToOne: false
            referencedRelation: "crm_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_reminder_instances_task_activity_id_fkey"
            columns: ["task_activity_id"]
            isOneToOne: false
            referencedRelation: "qrm_activities"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_tags: {
        Row: {
          color: string | null
          created_at: string | null
          deleted_at: string | null
          id: string | null
          name: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string | null
          name?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string | null
          name?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      crm_territories: {
        Row: {
          assigned_rep_id: string | null
          created_at: string | null
          deleted_at: string | null
          description: string | null
          id: string | null
          name: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          assigned_rep_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string | null
          name?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          assigned_rep_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string | null
          name?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_territories_assigned_rep_id_fkey"
            columns: ["assigned_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_signals: {
        Row: {
          deal_id: string | null
          observed_at: string | null
          payload: Json | null
          severity: string | null
          signal_source: string | null
          signal_subtype: string | null
          source_record_id: string | null
        }
        Relationships: []
      }
      equipment_lifecycle_summary: {
        Row: {
          current_hours: number | null
          customer_health_score: number | null
          customer_name: string | null
          customer_profile_id: string | null
          equipment_serial: string | null
          fleet_intelligence_id: string | null
          make: string | null
          model: string | null
          predicted_replacement_date: string | null
          replacement_confidence: number | null
          revenue_breakdown: Json | null
          year: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fleet_intelligence_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "customer_profiles_extended"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_intelligence_customer_profile_id_fkey"
            columns: ["customer_profile_id"]
            isOneToOne: false
            referencedRelation: "exec_health_movers"
            referencedColumns: ["customer_profile_id"]
          },
        ]
      }
      equipment_status_canonical: {
        Row: {
          company_id: string | null
          equipment_id: string | null
          eta: string | null
          last_updated: string | null
          stage_label: string | null
          stage_source: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_equipment_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_equipment_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_equipment_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      exec_branch_comparison: {
        Row: {
          active: number | null
          branch_id: string | null
          closed: number | null
          overdue: number | null
          workspace_id: string | null
        }
        Relationships: []
      }
      exec_deposits_aging_v: {
        Row: {
          ar_exposure_dollars: number | null
          avg_verification_hours: number | null
          pending_count: number | null
          received_unverified_count: number | null
          refund_exposure_dollars: number | null
          refund_in_flight_count: number | null
          requested_count: number | null
          verified_count: number | null
        }
        Relationships: []
      }
      exec_exception_summary: {
        Row: {
          latest: string | null
          open_count: number | null
          severity: string | null
          source: string | null
          workspace_id: string | null
        }
        Relationships: []
      }
      exec_health_movers: {
        Row: {
          customer_profile_id: string | null
          health_score: number | null
          health_score_components: Json | null
          health_score_updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          customer_profile_id?: string | null
          health_score?: number | null
          health_score_components?: Json | null
          health_score_updated_at?: string | null
          workspace_id?: never
        }
        Update: {
          customer_profile_id?: string | null
          health_score?: number | null
          health_score_components?: Json | null
          health_score_updated_at?: string | null
          workspace_id?: never
        }
        Relationships: []
      }
      exec_inventory_readiness_v: {
        Row: {
          blocked_units: number | null
          in_prep_units: number | null
          intake_stalled: number | null
          ready_rate_pct: number | null
          ready_units: number | null
          total_units: number | null
        }
        Relationships: []
      }
      exec_margin_daily_v: {
        Row: {
          day: string | null
          margin_dollars: number | null
          median_margin: number | null
          negative_margin_deal_count: number | null
        }
        Relationships: []
      }
      exec_margin_waterfall_v: {
        Row: {
          gross_margin_dollars: number | null
          load_dollars: number | null
          loaded_margin_pct: number | null
          month: string | null
          net_contribution_dollars: number | null
          revenue: number | null
        }
        Relationships: []
      }
      exec_payment_compliance_v: {
        Row: {
          day: string | null
          exception_attempts: number | null
          exception_rate_pct: number | null
          overrides: number | null
          passed_attempts: number | null
          total_attempts: number | null
        }
        Relationships: []
      }
      exec_pipeline_stage_summary_v: {
        Row: {
          avg_age_days: number | null
          avg_inactivity_days: number | null
          open_deal_count: number | null
          raw_pipeline: number | null
          stage_id: string | null
          stage_name: string | null
          stage_probability: number | null
          weighted_pipeline: number | null
        }
        Relationships: []
      }
      exec_quote_risk: {
        Row: {
          expiring_soon_count: number | null
          quote_count: number | null
          status: string | null
          total_dollars: number | null
          workspace_id: string | null
        }
        Relationships: []
      }
      exec_rental_return_summary_v: {
        Row: {
          aging_returns: number | null
          avg_resolution_hours: number | null
          fresh_returns: number | null
          open_returns: number | null
          refund_pending: number | null
        }
        Relationships: []
      }
      exec_revenue_daily_v: {
        Row: {
          closed_deal_count: number | null
          day: string | null
          margin_dollars: number | null
          margin_pct: number | null
          revenue: number | null
        }
        Relationships: []
      }
      exec_service_backlog: {
        Row: {
          closed_recent: number | null
          in_progress: number | null
          overdue: number | null
          parts_waiting: number | null
          workspace_id: string | null
        }
        Relationships: []
      }
      exec_traffic_summary_v: {
        Row: {
          at_risk_24h: number | null
          avg_cycle_time_hours: number | null
          blocked: number | null
          completed: number | null
          completed_on_time: number | null
          day: string | null
          on_time_rate_pct: number | null
          total_tickets: number | null
        }
        Relationships: []
      }
      flow_pending_events: {
        Row: {
          consumed_by_runs: Json | null
          correlation_id: string | null
          entity_id: string | null
          entity_type: string | null
          event_id: string | null
          flow_event_type: string | null
          flow_event_version: number | null
          occurred_at: string | null
          parent_event_id: string | null
          properties: Json | null
          source_module: string | null
          workspace_id: string | null
        }
        Insert: {
          consumed_by_runs?: Json | null
          correlation_id?: string | null
          entity_id?: string | null
          entity_type?: string | null
          event_id?: string | null
          flow_event_type?: string | null
          flow_event_version?: number | null
          occurred_at?: string | null
          parent_event_id?: string | null
          properties?: Json | null
          source_module?: string | null
          workspace_id?: string | null
        }
        Update: {
          consumed_by_runs?: Json | null
          correlation_id?: string | null
          entity_id?: string | null
          entity_type?: string | null
          event_id?: string | null
          flow_event_type?: string | null
          flow_event_version?: number | null
          occurred_at?: string | null
          parent_event_id?: string | null
          properties?: Json | null
          source_module?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      margin_analytics_view: {
        Row: {
          avg_margin_pct: number | null
          deal_count: number | null
          equipment_category: string | null
          flagged_deal_count: number | null
          month_bucket: string | null
          rep_id: string | null
          rep_name: string | null
          total_pipeline: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_deals_assigned_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mv_exec_deposits_aging: {
        Row: {
          ar_exposure_dollars: number | null
          avg_verification_hours: number | null
          pending_count: number | null
          received_unverified_count: number | null
          refund_exposure_dollars: number | null
          refund_in_flight_count: number | null
          requested_count: number | null
          verified_count: number | null
          workspace_id: string | null
        }
        Relationships: []
      }
      mv_exec_inventory_readiness: {
        Row: {
          blocked_units: number | null
          in_prep_units: number | null
          intake_stalled: number | null
          ready_rate_pct: number | null
          ready_units: number | null
          total_units: number | null
          workspace_id: string | null
        }
        Relationships: []
      }
      mv_exec_margin_daily: {
        Row: {
          day: string | null
          margin_dollars: number | null
          median_margin: number | null
          negative_margin_deal_count: number | null
          workspace_id: string | null
        }
        Relationships: []
      }
      mv_exec_margin_waterfall: {
        Row: {
          gross_margin_dollars: number | null
          load_dollars: number | null
          loaded_margin_pct: number | null
          month: string | null
          net_contribution_dollars: number | null
          revenue: number | null
          workspace_id: string | null
        }
        Relationships: []
      }
      mv_exec_payment_compliance: {
        Row: {
          day: string | null
          exception_attempts: number | null
          exception_rate_pct: number | null
          overrides: number | null
          passed_attempts: number | null
          total_attempts: number | null
          workspace_id: string | null
        }
        Relationships: []
      }
      mv_exec_pipeline_stage_summary: {
        Row: {
          avg_age_days: number | null
          avg_inactivity_days: number | null
          open_deal_count: number | null
          raw_pipeline: number | null
          stage_id: string | null
          stage_name: string | null
          stage_probability: number | null
          weighted_pipeline: number | null
          workspace_id: string | null
        }
        Relationships: []
      }
      mv_exec_rental_return_summary: {
        Row: {
          aging_returns: number | null
          avg_resolution_hours: number | null
          fresh_returns: number | null
          open_returns: number | null
          refund_pending: number | null
          workspace_id: string | null
        }
        Relationships: []
      }
      mv_exec_revenue_daily: {
        Row: {
          closed_deal_count: number | null
          day: string | null
          margin_dollars: number | null
          margin_pct: number | null
          revenue: number | null
          workspace_id: string | null
        }
        Relationships: []
      }
      mv_exec_traffic_summary: {
        Row: {
          at_risk_24h: number | null
          avg_cycle_time_hours: number | null
          blocked: number | null
          completed: number | null
          completed_on_time: number | null
          day: string | null
          on_time_rate_pct: number | null
          total_tickets: number | null
          workspace_id: string | null
        }
        Relationships: []
      }
      parts_forecast_risk_summary: {
        Row: {
          branch_id: string | null
          computed_at: string | null
          confidence_high: number | null
          confidence_low: number | null
          consumption_velocity: number | null
          coverage_status: string | null
          current_qty_on_hand: number | null
          current_reorder_point: number | null
          days_of_stock_remaining: number | null
          drivers: Json | null
          forecast_month: string | null
          part_number: string | null
          predicted_qty: number | null
          qty_on_hand_at_forecast: number | null
          reorder_point_at_forecast: number | null
          stockout_risk: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_parts_demand_forecasts_branch"
            columns: ["workspace_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["workspace_id", "slug"]
          },
        ]
      }
      parts_inventory_reorder_status: {
        Row: {
          avg_lead_time_days: number | null
          bin_location: string | null
          branch_id: string | null
          catalog_id: string | null
          consumption_velocity: number | null
          days_until_stockout: number | null
          economic_order_qty: number | null
          inventory_id: string | null
          part_number: string | null
          qty_on_hand: number | null
          reorder_computed_at: string | null
          reorder_point: number | null
          safety_stock: number | null
          stock_status: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parts_inventory_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "parts_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_inventory_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "v_parts_dead_capital"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_inventory_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "v_parts_embedding_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_inventory_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "v_parts_import_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_inventory_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "v_parts_intelligence"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_inventory_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "v_parts_margin_signal"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_inventory_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "v_parts_pricing_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_inventory_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "v_parts_stockout_risk"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "parts_inventory_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "v_parts_velocity"
            referencedColumns: ["part_id"]
          },
        ]
      }
      portal_trade_in_opportunities: {
        Row: {
          crm_company_id: string | null
          crm_contact_id: string | null
          current_hours: number | null
          customer_email: string | null
          customer_name: string | null
          fleet_id: string | null
          make: string | null
          model: string | null
          outreach_status: Database["public"]["Enums"]["outreach_status"] | null
          portal_customer_id: string | null
          predicted_replacement_date: string | null
          replacement_confidence: number | null
          trade_in_notes: string | null
          warranty_expiry: string | null
          year: number | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_fleet_portal_customer_id_fkey"
            columns: ["portal_customer_id"]
            isOneToOne: false
            referencedRelation: "portal_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_customers_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_customers_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_customers_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "portal_customers_crm_contact_id_fkey"
            columns: ["crm_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_customers_crm_contact_id_fkey"
            columns: ["crm_contact_id"]
            isOneToOne: false
            referencedRelation: "qrm_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      price_change_impact: {
        Row: {
          catalog_entry_id: string | null
          current_list_price: number | null
          deal_id: string | null
          line_item_id: string | null
          make: string | null
          model: string | null
          price_change_pct: number | null
          price_change_source: string | null
          price_changed_at: string | null
          price_delta_total: number | null
          quote_created_at: string | null
          quote_package_id: string | null
          quote_status: string | null
          quote_total: number | null
          quoted_list_price: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_package_line_items_catalog_entry_id_fkey"
            columns: ["catalog_entry_id"]
            isOneToOne: false
            referencedRelation: "catalog_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_packages_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_packages_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_elevated_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_packages_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_rep_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_packages_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals_weighted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_packages_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "qrm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_packages_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_rep_pipeline"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      revenue_by_make_model: {
        Row: {
          avg_lifetime_revenue_per_unit: number | null
          make: string | null
          model: string | null
          total_lifetime_revenue: number | null
          unit_count: number | null
        }
        Relationships: []
      }
      service_dashboard_rollup: {
        Row: {
          active_count: number | null
          branch_id: string | null
          closed_count: number | null
          overdue_count: number | null
          pending_count: number | null
          total_count: number | null
          workspace_id: string | null
        }
        Relationships: []
      }
      sop_compliance_summary: {
        Row: {
          abandoned_executions: number | null
          blocked_executions: number | null
          completed_executions: number | null
          completion_rate_pct: number | null
          completions: number | null
          deferred_count: number | null
          department: string | null
          eligible_executions: number | null
          na_count: number | null
          satisfied_elsewhere_count: number | null
          skips: number | null
          sort_order: number | null
          step_compliance_pct: number | null
          step_id: string | null
          step_title: string | null
          template_id: string | null
          template_title: string | null
          total_executions: number | null
          version: number | null
        }
        Relationships: []
      }
      v_branch_stack_ranking: {
        Row: {
          at_reorder_count: number | null
          branch_code: string | null
          dead_parts: number | null
          dead_parts_quartile_asc: number | null
          dead_pct: number | null
          inventory_quartile: number | null
          inventory_value: number | null
          parts_count: number | null
          reorder_quartile_asc: number | null
          workspace_id: string | null
        }
        Relationships: []
      }
      v_machine_parts_connections: {
        Row: {
          association_strength: number | null
          branch_code: string | null
          cost_price: number | null
          daily_velocity: number | null
          history_12mo_sales: number | null
          link_source: string | null
          list_price: number | null
          machine_category: string | null
          machine_id: string | null
          manufacturer: string | null
          model: string | null
          model_family: string | null
          on_hand: number | null
          part_description: string | null
          part_id: string | null
          part_number: string | null
          usage_frequency: string | null
          velocity_class: string | null
          vendor_code: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "machine_parts_links_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machine_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_parts_links_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_parts_links_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_dead_capital"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "machine_parts_links_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_embedding_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_parts_links_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_import_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "machine_parts_links_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_intelligence"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "machine_parts_links_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_margin_signal"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "machine_parts_links_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_pricing_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "machine_parts_links_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_stockout_risk"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "machine_parts_links_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_velocity"
            referencedColumns: ["part_id"]
          },
        ]
      }
      v_parts_dead_capital: {
        Row: {
          branch_code: string | null
          capital_on_hand: number | null
          cost_price: number | null
          dead_pattern: string | null
          description: string | null
          on_hand: number | null
          part_id: string | null
          part_number: string | null
          velocity_class: string | null
          workspace_id: string | null
        }
        Relationships: []
      }
      v_parts_embedding_backlog: {
        Row: {
          backlog_reason: string | null
          category: string | null
          category_code: string | null
          description: string | null
          embedding_computed_at: string | null
          id: string | null
          machine_code: string | null
          manufacturer: string | null
          model_code: string | null
          part_number: string | null
          updated_at: string | null
          vendor_code: string | null
          workspace_id: string | null
        }
        Insert: {
          backlog_reason?: never
          category?: string | null
          category_code?: string | null
          description?: string | null
          embedding_computed_at?: string | null
          id?: string | null
          machine_code?: string | null
          manufacturer?: string | null
          model_code?: string | null
          part_number?: string | null
          updated_at?: string | null
          vendor_code?: string | null
          workspace_id?: string | null
        }
        Update: {
          backlog_reason?: never
          category?: string | null
          category_code?: string | null
          description?: string | null
          embedding_computed_at?: string | null
          id?: string | null
          machine_code?: string | null
          manufacturer?: string | null
          model_code?: string | null
          part_number?: string | null
          updated_at?: string | null
          vendor_code?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      v_parts_import_drift: {
        Row: {
          bin_location_moved: boolean | null
          branch_code: string | null
          co_code: string | null
          current_bin_location: string | null
          current_cost_price: number | null
          current_list_price: number | null
          current_on_hand: number | null
          description: string | null
          div_code: string | null
          inventory_swing_over_50pct: boolean | null
          last_import_run_id: string | null
          last_imported_at: string | null
          part_id: string | null
          part_number: string | null
          previous_bin_location: string | null
          previous_on_hand_approx: number | null
          workspace_id: string | null
        }
        Relationships: []
      }
      v_parts_intelligence: {
        Row: {
          average_cost: number | null
          branch_code: string | null
          capital_on_hand: number | null
          class_code: string | null
          co_code: string | null
          cost_price: number | null
          daily_velocity: number | null
          days_of_stock: number | null
          description: string | null
          div_code: string | null
          forecast_90d_qty: number | null
          forecast_stockout_risk: string | null
          history_12mo_active_months: number | null
          history_12mo_sales: number | null
          latest_forecast_month: string | null
          list_price: number | null
          margin_pct_on_cost: number | null
          margin_pct_on_vendor_list: number | null
          on_hand: number | null
          part_id: string | null
          part_number: string | null
          potential_overpay: boolean | null
          reorder_point: number | null
          stockout_risk: string | null
          velocity_class: string | null
          vendor_code: string | null
          vendor_list_price: number | null
          workspace_id: string | null
          yoy_growth_pct: number | null
        }
        Relationships: []
      }
      v_parts_margin_signal: {
        Row: {
          average_cost: number | null
          branch_code: string | null
          co_code: string | null
          cost_price: number | null
          description: string | null
          div_code: string | null
          list_price: number | null
          margin_pct_on_cost: number | null
          margin_pct_on_vendor_list: number | null
          on_hand: number | null
          part_id: string | null
          part_number: string | null
          potential_overpay: boolean | null
          reorder_point: number | null
          vendor_code: string | null
          vendor_list_price: number | null
          vendor_price_date: string | null
          workspace_id: string | null
        }
        Relationships: []
      }
      v_parts_pricing_drift: {
        Row: {
          auto_apply: boolean | null
          class_code: string | null
          cost_price: number | null
          current_margin_pct: number | null
          current_sell_price: number | null
          delta_dollars: number | null
          delta_pct: number | null
          out_of_tolerance: boolean | null
          part_id: string | null
          part_number: string | null
          rule_id: string | null
          rule_name: string | null
          rule_type: Database["public"]["Enums"]["pricing_rule_type"] | null
          target_margin_pct: number | null
          target_sell_price: number | null
          tolerance_pct: number | null
          vendor_code: string | null
          workspace_id: string | null
        }
        Relationships: []
      }
      v_parts_queue: {
        Row: {
          age_minutes: number | null
          assigned_to: string | null
          assignee_name: string | null
          auto_escalated: boolean | null
          bay_number: string | null
          cancelled_at: string | null
          created_at: string | null
          customer_id: string | null
          customer_name: string | null
          escalated_at: string | null
          estimated_completion: string | null
          fulfilled_at: string | null
          id: string | null
          is_overdue: boolean | null
          items: Json | null
          machine_category: string | null
          machine_description: string | null
          machine_manufacturer: string | null
          machine_model: string | null
          machine_profile_id: string | null
          notes: string | null
          priority: string | null
          priority_sort: number | null
          request_source: string | null
          requested_by: string | null
          requester_name: string | null
          status: string | null
          updated_at: string | null
          work_order_number: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parts_requests_machine_profile_id_fkey"
            columns: ["machine_profile_id"]
            isOneToOne: false
            referencedRelation: "machine_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_parts_stockout_risk: {
        Row: {
          branch_code: string | null
          capital_on_hand: number | null
          daily_velocity: number | null
          days_of_stock: number | null
          description: string | null
          list_price: number | null
          on_hand: number | null
          part_id: string | null
          part_number: string | null
          reorder_point: number | null
          stockout_risk: string | null
          velocity_class: string | null
          vendor_code: string | null
          workspace_id: string | null
        }
        Relationships: []
      }
      v_parts_velocity: {
        Row: {
          activity_code: string | null
          average_cost: number | null
          branch_code: string | null
          capital_on_hand: number | null
          class_code: string | null
          co_code: string | null
          cost_price: number | null
          daily_velocity: number | null
          description: string | null
          div_code: string | null
          history_12mo_active_months: number | null
          history_12mo_bin_trips: number | null
          history_12mo_demands: number | null
          history_12mo_sales: number | null
          history_13_24mo_sales: number | null
          list_price: number | null
          movement_code: string | null
          on_hand: number | null
          part_id: string | null
          part_number: string | null
          recorded_last_12mo_sales: number | null
          reorder_point: number | null
          velocity_class: string | null
          vendor_code: string | null
          workspace_id: string | null
          yoy_growth_pct: number | null
        }
        Relationships: []
      }
      v_predictive_plays: {
        Row: {
          current_on_hand_across_branches: number | null
          customer_name: string | null
          days_until_due: number | null
          fleet_id: string | null
          forecast_stockout_risk: string | null
          id: string | null
          machine_hours: number | null
          machine_make: string | null
          machine_model: string | null
          machine_serial: string | null
          machine_year: number | null
          part_description: string | null
          part_id: string | null
          part_number: string | null
          portal_customer_id: string | null
          probability: number | null
          projected_due_date: string | null
          projected_revenue: number | null
          projection_window: string | null
          reason: string | null
          recommended_order_qty: number | null
          signal_type: string | null
          status: string | null
          suggested_order_by: string | null
          suggested_vendor_name: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "predicted_parts_plays_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "customer_fleet"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "portal_trade_in_opportunities"
            referencedColumns: ["fleet_id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_dead_capital"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_embedding_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_import_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_intelligence"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_margin_signal"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_pricing_drift"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_stockout_risk"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_parts_velocity"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "predicted_parts_plays_portal_customer_id_fkey"
            columns: ["portal_customer_id"]
            isOneToOne: false
            referencedRelation: "portal_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      v_profile_active_role_blend: {
        Row: {
          effective_from: string | null
          effective_to: string | null
          id: string | null
          iron_role: string | null
          iron_role_display: string | null
          profile_id: string | null
          reason: string | null
          weight: number | null
        }
        Insert: {
          effective_from?: string | null
          effective_to?: string | null
          id?: string | null
          iron_role?: string | null
          iron_role_display?: never
          profile_id?: string | null
          reason?: string | null
          weight?: number | null
        }
        Update: {
          effective_from?: string | null
          effective_to?: string | null
          id?: string | null
          iron_role?: string | null
          iron_role_display?: never
          profile_id?: string | null
          reason?: string | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "profile_role_blend_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_rep_customers: {
        Row: {
          active_quotes: number | null
          city: string | null
          company_name: string | null
          customer_id: string | null
          days_since_contact: number | null
          last_interaction: string | null
          open_deals: number | null
          opportunity_score: number | null
          primary_contact_email: string | null
          primary_contact_name: string | null
          primary_contact_phone: string | null
          state: string | null
        }
        Relationships: []
      }
      v_rep_pipeline: {
        Row: {
          amount: number | null
          company_id: string | null
          created_at: string | null
          customer_name: string | null
          days_since_activity: number | null
          deal_id: string | null
          deal_name: string | null
          deal_score: number | null
          expected_close_on: string | null
          heat_status: string | null
          last_activity_at: string | null
          next_follow_up_at: string | null
          primary_contact_name: string | null
          primary_contact_phone: string | null
          stage: string | null
          stage_sort: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "qrm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_rep_customers"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      v_replenish_queue_enriched: {
        Row: {
          approved_at: string | null
          branch_id: string | null
          cdk_vendor_list_price: number | null
          computation_batch_id: string | null
          created_at: string | null
          current_list_price: number | null
          customer_machine_hours: number | null
          customer_machine_make: string | null
          customer_machine_model: string | null
          customer_name: string | null
          economic_order_qty: number | null
          edited_at: string | null
          edited_by: string | null
          estimated_total: number | null
          estimated_unit_cost: number | null
          forecast_covered_days: number | null
          forecast_driven: boolean | null
          id: string | null
          live_on_hand: number | null
          ordered_at: string | null
          ordered_by: string | null
          originating_play_id: string | null
          part_description: string | null
          part_number: string | null
          part_vendor_code: string | null
          play_part_description: string | null
          play_probability: number | null
          play_projected_due: string | null
          play_reason: string | null
          po_reference: string | null
          potential_overpay_flag: boolean | null
          qty_on_hand: number | null
          recommended_qty: number | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          reorder_point: number | null
          scheduled_for: string | null
          selected_vendor_id: string | null
          source_type: string | null
          status: string | null
          updated_at: string | null
          vendor_lead_time_hours: number | null
          vendor_name: string | null
          vendor_price_corroborated: boolean | null
          vendor_score: number | null
          vendor_selection_reason: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_parts_auto_replenish_queue_branch"
            columns: ["workspace_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["workspace_id", "slug"]
          },
          {
            foreignKeyName: "parts_auto_replenish_queue_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_auto_replenish_queue_ordered_by_fkey"
            columns: ["ordered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_auto_replenish_queue_originating_play_id_fkey"
            columns: ["originating_play_id"]
            isOneToOne: false
            referencedRelation: "predicted_parts_plays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_auto_replenish_queue_originating_play_id_fkey"
            columns: ["originating_play_id"]
            isOneToOne: false
            referencedRelation: "v_predictive_plays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_auto_replenish_queue_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_auto_replenish_queue_selected_vendor_id_fkey"
            columns: ["selected_vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_health_scorecard"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "parts_auto_replenish_queue_selected_vendor_id_fkey"
            columns: ["selected_vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_supplier_fill_rate: {
        Row: {
          avg_approve_to_order_hours: number | null
          fill_rate_pct: number | null
          items_90d: number | null
          items_approved: number | null
          items_expired: number | null
          items_ordered: number | null
          items_rejected: number | null
          vendor_id: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parts_auto_replenish_queue_selected_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_health_scorecard"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "parts_auto_replenish_queue_selected_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_supplier_health_scorecard: {
        Row: {
          avg_approve_to_order_hours: number | null
          avg_lead_time_hours: number | null
          catalog_parts: number | null
          days_since_last_price_file: number | null
          fill_rate_pct_90d: number | null
          health_tier: string | null
          last_price_file_at: string | null
          parts_compared: number | null
          parts_up: number | null
          parts_up_more_than_5pct: number | null
          price_change_pct_yoy: number | null
          price_competitiveness: number | null
          profile_composite_score: number | null
          profile_fill_rate: number | null
          replenish_items_90d: number | null
          replenish_items_ordered: number | null
          responsiveness_score: number | null
          supplier_type: string | null
          vendor_id: string | null
          vendor_name: string | null
          workspace_id: string | null
        }
        Relationships: []
      }
      v_supplier_price_creep: {
        Row: {
          max_current_price: number | null
          max_prior_price: number | null
          parts_compared: number | null
          parts_down: number | null
          parts_up: number | null
          parts_up_more_than_5pct: number | null
          vendor_code: string | null
          vendor_id: string | null
          weighted_change_pct: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parts_vendor_prices_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_health_scorecard"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "parts_vendor_prices_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      action_predictive_play: {
        Args: { p_action: string; p_note?: string; p_play_id: string }
        Returns: Json
      }
      adjust_parts_inventory_delta: {
        Args: {
          p_branch_id: string
          p_delta: number
          p_part_number: string
          p_workspace_id: string
        }
        Returns: Json
      }
      adjust_parts_inventory_delta_strict: {
        Args: {
          p_branch_id: string
          p_delta: number
          p_part_number: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      analytics_latest_snapshots: {
        Args: { p_metric_keys?: string[]; p_role_scope?: string }
        Returns: {
          calculated_at: string
          comparison_value: number
          confidence_score: number
          data_quality_score: number
          metadata: Json
          metric_key: string
          metric_value: number
          period_end: string
          period_start: string
          refresh_state: string
          target_value: number
        }[]
      }
      analytics_quick_kpi: { Args: { p_metric_key: string }; Returns: number }
      apply_ar_override: {
        Args: {
          p_approver_id: string
          p_block_id: string
          p_reason: string
          p_window_days?: number
        }
        Returns: {
          block_reason: string
          block_threshold_days: number
          blocked_at: string
          blocked_by: string | null
          cleared_at: string | null
          cleared_by: string | null
          company_id: string
          created_at: string
          current_max_aging_days: number | null
          id: string
          override_accounting_notified_at: string | null
          override_approver_id: string | null
          override_created_at: string | null
          override_reason: string | null
          override_until: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ar_credit_blocks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_replenish_rows: { Args: { p_ids: string[] }; Returns: Json }
      archive_crm_company: { Args: { p_company_id: string }; Returns: Json }
      archive_crm_contact: { Args: { p_contact_id: string }; Returns: Json }
      archive_crm_deal: { Args: { p_deal_id: string }; Returns: Json }
      backfill_customer_lifecycle_events: {
        Args: never
        Returns: {
          event_type: string
          inserted_count: number
        }[]
      }
      backfill_profile: {
        Args: {
          p_email: string
          p_full_name?: string
          p_id: string
          p_iron_role?: string
          p_role?: string
          p_workspace?: string
        }
        Returns: undefined
      }
      batch_apply_follow_up_touchpoint_ai: {
        Args: { p_rows: Json }
        Returns: number
      }
      bulk_update_parts_embeddings: { Args: { p_updates: Json }; Returns: Json }
      calculate_deposit_tier: {
        Args: { p_equipment_value: number }
        Returns: Json
      }
      calculate_trade_value: {
        Args: {
          p_auction_value: number
          p_discount_pct?: number
          p_reconditioning?: number
        }
        Returns: Json
      }
      campaign_in_my_workspace: {
        Args: { p_campaign_id: string }
        Returns: boolean
      }
      check_demo_hour_alerts: {
        Args: never
        Returns: {
          alert_type: string
          deal_id: string
          demo_id: string
          hours_used: number
          max_hours: number
          pct_used: number
        }[]
      }
      check_rate_limit: {
        Args: {
          p_endpoint: string
          p_max_requests: number
          p_user_id: string
          p_window_seconds: number
        }
        Returns: boolean
      }
      claim_dge_refresh_job: {
        Args: { p_lease_seconds?: number }
        Returns: {
          attempt_count: number
          dedupe_key: string
          job_id: string
          job_type: string
          request_payload: Json
          workspace_id: string
        }[]
      }
      complete_dge_refresh_job: {
        Args: {
          p_job_id: string
          p_last_error?: string
          p_result_payload?: Json
          p_status: string
        }
        Returns: undefined
      }
      compute_customer_health_score: {
        Args: { p_customer_profile_id: string }
        Returns: number
      }
      compute_deal_timing_alerts: {
        Args: { p_workspace_id: string }
        Returns: number
      }
      compute_handoff_seam_scores: {
        Args: {
          p_period_end: string
          p_period_start: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      compute_ownership_health_score: {
        Args: { p_workspace?: string }
        Returns: Json
      }
      compute_seeded_forecast: {
        Args: { p_forecast_months?: number; p_workspace?: string }
        Returns: Json
      }
      create_post_sale_cadence: {
        Args: {
          p_assigned_to?: string
          p_contact_id?: string
          p_deal_id: string
          p_workspace_id?: string
        }
        Returns: string
      }
      create_sales_cadence: {
        Args: {
          p_assigned_to?: string
          p_contact_id?: string
          p_deal_id: string
          p_workspace_id?: string
        }
        Returns: string
      }
      crm_company_parent_would_create_cycle: {
        Args: { p_company_id: string; p_parent_company_id: string }
        Returns: boolean
      }
      crm_company_subtree_rollups: {
        Args: { p_company_id: string; p_workspace_id: string }
        Returns: {
          contact_count: number
          equipment_count: number
        }[]
      }
      crm_dismiss_follow_up_reminder: {
        Args: { p_reminder_id: string }
        Returns: boolean
      }
      crm_dispatch_due_follow_up_reminders: {
        Args: { p_limit?: number }
        Returns: Json
      }
      crm_manager_at_risk_deals: {
        Args: { p_limit?: number }
        Returns: {
          amount: number
          assigned_rep_id: string
          deal_id: string
          deal_name: string
          hours_overdue: number
          next_follow_up_at: string
        }[]
      }
      crm_merge_contacts: {
        Args: {
          p_actor_user_id: string
          p_idempotency_key?: string
          p_loser_contact_id: string
          p_survivor_contact_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      crm_refresh_deal_last_activity: {
        Args: { p_deal_id: string }
        Returns: undefined
      }
      crm_refresh_duplicate_candidates: {
        Args: { p_workspace_id: string }
        Returns: number
      }
      crm_reorder_pipeline_deals: {
        Args: { p_ordered_deal_ids: string[]; p_stage_id: string }
        Returns: undefined
      }
      crm_rep_can_access_activity: {
        Args: { p_activity_id: string }
        Returns: boolean
      }
      crm_rep_can_access_company: {
        Args: { p_company_id: string }
        Returns: boolean
      }
      crm_rep_can_access_contact: {
        Args: { p_contact_id: string }
        Returns: boolean
      }
      crm_rep_can_access_custom_record: {
        Args: {
          p_record_id: string
          p_record_type: Database["public"]["Enums"]["crm_custom_field_object_type"]
        }
        Returns: boolean
      }
      crm_rep_can_access_deal: { Args: { p_deal_id: string }; Returns: boolean }
      crm_rep_can_access_equipment: {
        Args: { p_equipment_id: string }
        Returns: boolean
      }
      crm_schedule_follow_up_reminder: {
        Args: {
          p_deal_id: string
          p_due_at: string
          p_source: Database["public"]["Enums"]["crm_reminder_source"]
        }
        Returns: string
      }
      customer_can_view_maintenance: {
        Args: { p_fleet_id: string; p_subscription_id: string }
        Returns: boolean
      }
      customer_fleet_llm_context: {
        Args: { p_fleet_id: string }
        Returns: Json
      }
      decide_flow_approval: {
        Args: { p_approval_id: string; p_decision: string; p_reason?: string }
        Returns: undefined
      }
      document_role_can_view_audience: {
        Args: {
          p_audience: Database["public"]["Enums"]["document_audience"]
          p_role: string
        }
        Returns: boolean
      }
      eligible_deals_for_playbook: {
        Args: { p_limit?: number; p_workspace?: string }
        Returns: {
          assigned_rep_id: string
          closed_at: string
          company_id: string
          deal_id: string
          equipment_id: string
          make: string
          model: string
          workspace_id: string
        }[]
      }
      emit_event:
        | {
            Args: {
              p_correlation_id?: string
              p_entity_id?: string
              p_entity_type?: string
              p_event_type: string
              p_parent_event_id?: string
              p_payload?: Json
              p_source_module: string
              p_workspace_id?: string
            }
            Returns: string
          }
        | {
            Args: {
              p_actor_id?: string
              p_actor_type?: string
              p_correlation_id?: string
              p_entity_id?: string
              p_entity_type?: string
              p_event_type: string
              p_parent_event_id?: string
              p_payload?: Json
              p_source_module: string
              p_workspace_id?: string
            }
            Returns: string
          }
      enqueue_analytics_alert:
        | {
            Args: {
              p_alert_type: string
              p_branch_id?: string
              p_business_impact_type?: string
              p_business_impact_value?: number
              p_dedupe_key?: string
              p_description?: string
              p_entity_id?: string
              p_entity_type?: string
              p_metadata?: Json
              p_metric_key: string
              p_role_target?: string
              p_root_cause_guess?: string
              p_severity: string
              p_source_record_ids?: Json
              p_suggested_action?: string
              p_title: string
            }
            Returns: string
          }
        | {
            Args: {
              p_alert_type: string
              p_branch_id?: string
              p_business_impact_type?: string
              p_business_impact_value?: number
              p_dedupe_key?: string
              p_description?: string
              p_entity_id?: string
              p_entity_type?: string
              p_metadata?: Json
              p_metric_key: string
              p_role_target?: string
              p_root_cause_guess?: string
              p_severity: string
              p_source_record_ids?: Json
              p_suggested_action?: string
              p_title: string
              p_workspace_id: string
            }
            Returns: string
          }
      enqueue_dge_refresh_job: {
        Args: {
          p_dedupe_key: string
          p_job_type: string
          p_priority?: number
          p_request_payload?: Json
          p_requested_by?: string
          p_workspace_id: string
        }
        Returns: {
          enqueued: boolean
          job_id: string
          job_status: string
        }[]
      }
      enqueue_exception: {
        Args: {
          p_detail?: string
          p_entity_id?: string
          p_entity_table?: string
          p_payload?: Json
          p_severity?: string
          p_source: string
          p_title: string
        }
        Returns: string
      }
      enqueue_workflow_dead_letter: {
        Args: {
          p_failed_step?: string
          p_payload?: Json
          p_reason: string
          p_run_id: string
          p_workflow_slug: string
        }
        Returns: string
      }
      exec_suppress_override_update: {
        Args: { p_part_id: string; p_payload: Json }
        Returns: Json
      }
      extract_portal_quote_version_text: {
        Args: { p_key_a: string; p_key_b: string; p_quote_data: Json }
        Returns: string
      }
      find_duplicate_companies: {
        Args: { p_threshold?: number }
        Returns: {
          company_a_id: string
          company_a_name: string
          company_b_id: string
          company_b_name: string
          group_key: string
          similarity_score: number
        }[]
      }
      find_part_substitutes: {
        Args: {
          p_branch_id?: string
          p_part_number: string
          p_workspace_id: string
        }
        Returns: {
          available_branch: string
          catalog_description: string
          confidence: number
          fitment_notes: string
          lead_time_delta_days: number
          price_delta: number
          qty_available: number
          relationship: string
          source: string
          substitute_part_number: string
          xref_id: string
        }[]
      }
      flare_dedupe_count:
        | {
            Args: {
              p_description: string
              p_route: string
              p_threshold?: number
            }
            Returns: number
          }
        | {
            Args: {
              p_description: string
              p_first_error?: string
              p_route: string
              p_threshold?: number
            }
            Returns: number
          }
      flare_recent_user_activity: { Args: { p_user_id: string }; Returns: Json }
      flare_recent_voice_capture: {
        Args: { p_user_id: string }
        Returns: string
      }
      flow_cleanup_idempotency: { Args: never; Returns: number }
      flow_escalate_approvals: {
        Args: never
        Returns: {
          escalated: number
          expired: number
        }[]
      }
      flow_resolve_context: { Args: { p_event_id: string }; Returns: Json }
      flow_resume_run: { Args: { p_run_id: string }; Returns: string }
      fuzzy_match_company: {
        Args: {
          p_company_name: string
          p_threshold?: number
          p_workspace_id: string
        }
        Returns: {
          company_id: string
          company_name: string
          match_method: string
          name_similarity: number
        }[]
      }
      fuzzy_match_contact: {
        Args: {
          p_company_name?: string
          p_first_name: string
          p_last_name: string
          p_threshold?: number
          p_workspace_id: string
        }
        Returns: {
          company_id: string
          company_name: string
          contact_id: string
          contact_name: string
          match_method: string
          name_similarity: number
        }[]
      }
      generate_cross_department_alerts: {
        Args: { p_workspace_id: string }
        Returns: number
      }
      generate_qb_deal_number: { Args: never; Returns: string }
      generate_qb_quote_number: { Args: never; Returns: string }
      get_account_360: { Args: { p_company_id: string }; Returns: Json }
      get_asset_24h_activity: {
        Args: { p_equipment_id: string }
        Returns: {
          category: string
          count: number
          detail: string
          event_type: string
          last_at: string
        }[]
      }
      get_asset_360: { Args: { p_equipment_id: string }; Returns: Json }
      get_asset_badges: { Args: { p_equipment_id: string }; Returns: Json }
      get_asset_countdowns: {
        Args: { p_equipment_id: string }
        Returns: {
          current: number
          label: string
          sort_order: number
          target: number
          tone: string
          unit: string
        }[]
      }
      get_auth_user_metadata: {
        Args: never
        Returns: {
          banned_until: string
          email: string
          email_confirmed_at: string
          id: string
          last_sign_in_at: string
          raw_user_meta_data: Json
        }[]
      }
      get_branch_by_slug: {
        Args: { p_slug: string; p_workspace_id: string }
        Returns: {
          address_line1: string | null
          address_line2: string | null
          business_hours: Json
          capabilities: Json
          city: string | null
          country: string
          created_at: string
          default_tax_rate: number | null
          deleted_at: string | null
          delivery_radius_miles: number | null
          display_name: string
          doc_footer_text: string | null
          email_main: string | null
          email_parts: string | null
          email_sales: string | null
          email_service: string | null
          fax: string | null
          general_manager_id: string | null
          header_tagline: string | null
          id: string
          is_active: boolean
          latitude: number | null
          license_numbers: Json
          logo_url: string | null
          longitude: number | null
          max_service_bays: number | null
          metadata: Json
          notes: string | null
          parts_counter: boolean
          parts_manager_id: string | null
          phone_main: string | null
          phone_parts: string | null
          phone_sales: string | null
          phone_service: string | null
          postal_code: string | null
          rental_yard_capacity: number | null
          sales_manager_id: string | null
          service_manager_id: string | null
          short_code: string | null
          slug: string
          state_province: string | null
          tax_id: string | null
          timezone: string
          updated_at: string
          website_url: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "branches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_deal_composite: { Args: { p_deal_id: string }; Returns: Json }
      get_deposit_tier: { Args: { p_amount: number }; Returns: string }
      get_fleet_radar: { Args: { p_company_id: string }; Returns: Json }
      get_health_score_with_deltas: {
        Args: { p_customer_profile_id: string }
        Returns: Json
      }
      get_my_iron_role: { Args: never; Returns: string }
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      get_my_workspace: { Args: never; Returns: string }
      get_parts_reorder_history: {
        Args: { p_portal_customer_id: string }
        Returns: Json
      }
      get_portal_customer_id: { Args: never; Returns: string }
      get_portal_fleet_with_status: {
        Args: { p_portal_customer_id: string }
        Returns: Json
      }
      get_timing_dashboard: { Args: { p_workspace_id: string }; Returns: Json }
      insert_lifecycle_event_once: {
        Args: {
          p_company_id: string
          p_event_type: string
          p_metadata: Json
          p_source_id: string
          p_source_table: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      inspection_in_my_workspace: {
        Args: { p_demo_id: string }
        Returns: boolean
      }
      iron_bump_memory: {
        Args: {
          p_action_type?: string
          p_entity_id: string
          p_entity_type: string
          p_user_id: string
        }
        Returns: undefined
      }
      iron_compute_slos: { Args: { p_workspace_id?: string }; Returns: Json }
      iron_decay_memory: { Args: never; Returns: Json }
      iron_increment_usage: {
        Args: {
          p_classifications?: number
          p_cost_usd_micro?: number
          p_flow_executes?: number
          p_tokens_in?: number
          p_tokens_out?: number
          p_user_id: string
          p_workspace_id: string
        }
        Returns: {
          bucket_date: string
          classifications: number
          cost_usd_micro: number
          degradation_state: string
          flow_executes: number
          tokens_in: number
          tokens_out: number
          user_id: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "iron_usage_counters"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      iron_mark_run_undone: {
        Args: { p_compensation_log: Json; p_run_id: string; p_user_id: string }
        Returns: undefined
      }
      iron_set_degradation_state: {
        Args: { p_state: string; p_user_id: string }
        Returns: undefined
      }
      iron_top_flows: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: {
          execution_count: number
          flow_slug: string
          last_used_at: string
          recency_score: number
        }[]
      }
      iron_upsert_flow_suggestion: {
        Args: {
          p_first_seen_at: string
          p_last_seen_at: string
          p_new_examples: Json
          p_occurrence_delta: number
          p_pattern_signature: string
          p_short_label: string
          p_unique_users: number
          p_workspace_id: string
        }
        Returns: string
      }
      kb_health_snapshot: { Args: never; Returns: Json }
      list_crm_companies_page: {
        Args: {
          p_after_id?: string
          p_after_name?: string
          p_limit?: number
          p_search?: string
        }
        Returns: {
          address_line_1: string
          address_line_2: string
          assigned_rep_id: string
          city: string
          country: string
          created_at: string
          id: string
          name: string
          parent_company_id: string
          postal_code: string
          state: string
          updated_at: string
          workspace_id: string
        }[]
      }
      list_crm_contacts_for_company_subtree_page: {
        Args: {
          p_after_first_name?: string
          p_after_id?: string
          p_after_last_name?: string
          p_company_id: string
          p_limit?: number
          p_search?: string
        }
        Returns: {
          assigned_rep_id: string
          created_at: string
          dge_customer_profile_id: string
          email: string
          first_name: string
          id: string
          last_name: string
          merged_into_contact_id: string
          phone: string
          primary_company_id: string
          title: string
          updated_at: string
          workspace_id: string
        }[]
      }
      list_crm_contacts_page: {
        Args: {
          p_after_first_name?: string
          p_after_id?: string
          p_after_last_name?: string
          p_limit?: number
          p_search?: string
        }
        Returns: {
          assigned_rep_id: string
          created_at: string
          dge_customer_profile_id: string
          email: string
          first_name: string
          id: string
          last_name: string
          merged_into_contact_id: string
          phone: string
          primary_company_id: string
          title: string
          updated_at: string
          workspace_id: string
        }[]
      }
      log_analytics_action: {
        Args: {
          p_action_type: string
          p_after_state?: Json
          p_alert_id?: string
          p_before_state?: Json
          p_entity_id?: string
          p_entity_type?: string
          p_metadata?: Json
          p_metric_key?: string
          p_source_widget?: string
        }
        Returns: string
      }
      log_crm_auth_event: {
        Args: {
          p_actor_user_id?: string
          p_event_type: Database["public"]["Enums"]["crm_auth_event_type"]
          p_ip_inet?: unknown
          p_metadata?: Json
          p_outcome: Database["public"]["Enums"]["crm_auth_event_outcome"]
          p_request_id?: string
          p_resource?: string
          p_subject_user_id?: string
          p_user_agent?: string
          p_workspace_id: string
        }
        Returns: string
      }
      log_knowledge_gap: {
        Args: {
          p_question: string
          p_trace_id?: string
          p_user_id: string
          p_workspace_id: string
        }
        Returns: {
          created_at: string
          frequency: number
          id: string
          last_asked_at: string
          question: string
          question_normalized: string | null
          resolved: boolean
          trace_id: string | null
          updated_at: string
          user_id: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "knowledge_gaps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      lookup_intervention_history: {
        Args: { p_alert_title: string; p_alert_type: string; p_limit?: number }
        Returns: {
          alert_type: string
          id: string
          recurrence_count: number
          resolution_notes: string
          resolution_type: string
          resolved_at: string
          resolved_by: string
          time_to_resolve_minutes: number
        }[]
      }
      machine_parts_graph_refresh: {
        Args: { p_workspace?: string }
        Returns: Json
      }
      machine_parts_intel: {
        Args: { p_limit?: number; p_machine_id: string }
        Returns: Json
      }
      mark_event_consumed: {
        Args: { p_event_id: string; p_run_id: string }
        Returns: undefined
      }
      mark_notification_read: {
        Args: { p_notification_id: string }
        Returns: undefined
      }
      mark_replenish_ordered: {
        Args: { p_ids: string[]; p_po_reference?: string }
        Returns: Json
      }
      match_parts_hybrid: {
        Args: {
          p_alpha?: number
          p_category?: string
          p_manufacturer?: string
          p_match_count?: number
          p_query_embedding: string
          p_query_text: string
          p_workspace?: string
        }
        Returns: {
          category: string
          cosine_similarity: number
          cost_price: number
          description: string
          fts_norm: number
          fts_rank: number
          hybrid_score: number
          list_price: number
          machine_code: string
          manufacturer: string
          match_source: string
          model_code: string
          on_hand: number
          part_id: string
          part_number: string
          vendor_code: string
        }[]
      }
      match_quote_incentives: {
        Args: { p_quote_package_id: string }
        Returns: {
          ai_confidence: number | null
          created_at: string
          description: string | null
          discount_type: string
          discount_value: number
          effective_date: string | null
          eligibility_criteria: string | null
          eligibility_rules: Json
          eligible_categories: string[] | null
          eligible_models: string[] | null
          end_date: string | null
          entered_by: string | null
          expiration_date: string | null
          id: string
          is_active: boolean
          manufacturer: string | null
          metadata: Json | null
          oem_name: string
          program_code: string | null
          program_name: string
          requires_approval: boolean
          source: string | null
          source_url: string | null
          stackable: boolean
          stacking_rules: string | null
          start_date: string
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "manufacturer_incentives"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      match_service_knowledge: {
        Args: {
          p_fault_code?: string
          p_limit?: number
          p_make?: string
          p_model?: string
        }
        Returns: {
          contributed_by: string | null
          created_at: string
          fault_code: string | null
          id: string
          make: string | null
          model: string | null
          parts_used: Json
          solution: string
          symptom: string
          updated_at: string
          use_count: number
          verified: boolean
          verified_at: string | null
          verified_by: string | null
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "service_knowledge_base"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      merge_companies: {
        Args: {
          p_caller_notes?: string
          p_discard_id: string
          p_dry_run?: boolean
          p_keep_id: string
        }
        Returns: Json
      }
      next_vendor_order_date: {
        Args: { p_branch?: string; p_from_date?: string; p_vendor_id: string }
        Returns: string
      }
      normalize_knowledge_gap_question: {
        Args: { p_question: string }
        Returns: string
      }
      owner_dashboard_summary: { Args: { p_workspace?: string }; Returns: Json }
      owner_event_feed: {
        Args: { p_hours_back?: number; p_workspace?: string }
        Returns: Json
      }
      owner_team_signals: {
        Args: { p_limit?: number; p_workspace?: string }
        Returns: Json
      }
      parts_import_dashboard_stats: {
        Args: { p_workspace?: string }
        Returns: Json
      }
      parts_import_drift_summary: { Args: { p_run_id?: string }; Returns: Json }
      parts_intelligence_summary: {
        Args: { p_workspace?: string }
        Returns: Json
      }
      parts_replenish_queue_summary: {
        Args: { p_workspace?: string }
        Returns: Json
      }
      pick_profile_active_workspace: {
        Args: { target_profile_id: string }
        Returns: string
      }
      pipeline_velocity_rpc: {
        Args: { p_threshold_days?: number }
        Returns: {
          avg_days_in_stage: number
          is_bottleneck: boolean
          max_days_in_stage: number
          open_deal_count: number
          raw_pipeline: number
          sort_order: number
          stage_id: string
          stage_name: string
          threshold_days: number
          weighted_pipeline: number
        }[]
      }
      portal_get_service_job_timeline: {
        Args: { p_service_request_id: string }
        Returns: Json
      }
      portal_record_invoice_payment: {
        Args: {
          p_amount: number
          p_invoice_id: string
          p_payment_method?: string
          p_payment_reference?: string
        }
        Returns: Json
      }
      post_sale_playbook_summary: {
        Args: { p_limit?: number; p_workspace?: string }
        Returns: Json
      }
      predict_parts_needs: {
        Args: { p_lookahead_days?: number; p_workspace?: string }
        Returns: Json
      }
      predictive_plays_summary: {
        Args: { p_workspace?: string }
        Returns: Json
      }
      pricing_rules_preview: { Args: { p_rule_id: string }; Returns: Json }
      pricing_rules_summary: { Args: never; Returns: Json }
      pricing_suggestions_apply: {
        Args: { p_note?: string; p_suggestion_ids: string[] }
        Returns: Json
      }
      pricing_suggestions_dismiss: {
        Args: { p_note?: string; p_suggestion_ids: string[] }
        Returns: Json
      }
      pricing_suggestions_generate: {
        Args: { p_rule_id?: string }
        Returns: Json
      }
      qb_search_equipment_fuzzy: {
        Args: { p_brand_id?: string; p_limit?: number; p_query: string }
        Returns: {
          brand_code: string
          brand_id: string
          brand_name: string
          family: string
          id: string
          list_price_cents: number
          model_code: string
          model_year: number
          name_display: string
          similarity: number
        }[]
      }
      qrm_company_fk_columns: {
        Args: never
        Returns: {
          column_name: string
          on_delete: string
          table_name: string
        }[]
      }
      qrm_stage_age: { Args: { p_deal_id: string }; Returns: number }
      qrm_time_balance: {
        Args: { p_workspace_id: string }
        Returns: {
          days_in_stage: number
          deal_id: string
          stage_age_days: number
          stage_name: string
        }[]
      }
      qrm_time_bank: {
        Args: { p_default_budget_days?: number; p_workspace_id: string }
        Returns: {
          assigned_rep_id: string
          assigned_rep_name: string
          budget_days: number
          company_id: string
          company_name: string
          days_in_stage: number
          deal_id: string
          deal_name: string
          has_explicit_budget: boolean
          is_over: boolean
          pct_used: number
          remaining_days: number
          stage_age_days: number
          stage_id: string
          stage_name: string
        }[]
      }
      qrm_undo_company_merge: { Args: { p_audit_id: string }; Returns: Json }
      recent_orders_for_part: {
        Args: {
          p_customer_name?: string
          p_limit?: number
          p_part_number: string
        }
        Returns: Json
      }
      recompute_health_score_for_company: {
        Args: { p_company_id: string }
        Returns: undefined
      }
      record_handoff_event: {
        Args: {
          p_from_user_id: string
          p_handoff_at?: string
          p_handoff_reason: string
          p_source_event_id?: string
          p_source_fingerprint?: string
          p_source_status_from?: string
          p_source_status_to?: string
          p_source_table?: string
          p_subject_id: string
          p_subject_label?: string
          p_subject_type: string
          p_to_user_id: string
          p_workspace_id: string
        }
        Returns: string
      }
      record_portal_customer_notification: {
        Args: {
          p_body: string
          p_category: string
          p_channel: string
          p_dedupe_key?: string
          p_event_type: string
          p_metadata?: Json
          p_portal_customer_id: string
          p_related_entity_id?: string
          p_related_entity_type?: string
          p_sent_at?: string
          p_title: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      refresh_exec_materialized_views: { Args: never; Returns: undefined }
      reject_replenish_rows: {
        Args: { p_ids: string[]; p_reason?: string }
        Returns: Json
      }
      replenish_queue_summary_v2: { Args: never; Returns: Json }
      request_flow_approval: {
        Args: {
          p_assigned_role?: string
          p_assigned_to?: string
          p_context_summary?: Json
          p_detail?: string
          p_due_in_hours?: number
          p_escalate_in_hours?: number
          p_run_id: string
          p_step_id: string
          p_subject: string
          p_workflow_slug: string
        }
        Returns: string
      }
      resolve_parts_import_conflicts_bulk: {
        Args: {
          p_field_names: string[]
          p_notes?: string
          p_resolution: Database["public"]["Enums"]["parts_import_conflict_resolution"]
          p_run_id: string
        }
        Returns: number
      }
      resolve_parts_order_company_id: {
        Args: { p_crm_company_id: string; p_portal_customer_id: string }
        Returns: string
      }
      retrieve_document_evidence: {
        Args: {
          keyword_query: string
          match_count?: number
          p_workspace_id?: string
          query_embedding: string
          semantic_match_threshold?: number
          user_role: string
        }
        Returns: {
          access_class: string
          chunk_kind: string
          confidence: number
          context_excerpt: string
          excerpt: string
          page_number: number
          parent_chunk_id: string
          section_title: string
          source_id: string
          source_title: string
          source_type: string
        }[]
      }
      run_data_quality_audit: {
        Args: never
        Returns: {
          found_count: number
          issue_class: string
        }[]
      }
      save_follow_up_sequence: {
        Args: {
          p_actor_user_id: string
          p_description: string
          p_is_active: boolean
          p_name: string
          p_sequence_id: string
          p_steps: Json
          p_trigger_stage: string
        }
        Returns: Json
      }
      search_parts_orders_for_link: {
        Args: { p_term: string; p_workspace: string }
        Returns: {
          created_at: string
          customer_email: string
          customer_first_name: string
          customer_last_name: string
          fulfillment_run_id: string
          id: string
          status: string
        }[]
      }
      service_parts_accept_intake_line: {
        Args: { p_actor_id: string; p_requirement_id: string }
        Returns: Json
      }
      service_parts_apply_fulfillment_action: {
        Args: {
          p_action: string
          p_actor_id: string
          p_override_reason?: string
          p_requirement_id: string
        }
        Returns: Json
      }
      service_post_internal_billing_to_invoice: {
        Args: { p_actor_id: string; p_service_job_id: string }
        Returns: Json
      }
      set_active_workspace: { Args: { target: string }; Returns: string }
      signature_in_my_workspace: {
        Args: { p_package_id: string }
        Returns: boolean
      }
      sop_completion_in_my_workspace: {
        Args: { p_execution_id: string }
        Returns: boolean
      }
      sop_step_in_my_workspace: {
        Args: { p_template_id: string }
        Returns: boolean
      }
      subscription_in_my_workspace: {
        Args: { p_sub_id: string }
        Returns: boolean
      }
      supplier_health_summary: { Args: { p_workspace?: string }; Returns: Json }
      touchpoint_in_my_workspace: {
        Args: { p_cadence_id: string }
        Returns: boolean
      }
      update_replenish_qty: {
        Args: { p_id: string; p_new_qty: number }
        Returns: Json
      }
      user_owns_conversation: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      validate_payment: {
        Args: {
          p_amount: number
          p_customer_id: string
          p_is_delivery_day?: boolean
          p_payment_type: string
          p_transaction_type: string
          p_workspace_id: string
        }
        Returns: Json
      }
      write_ai_inferred_play: {
        Args: {
          p_batch_id: string
          p_fleet_id: string
          p_llm_model: string
          p_llm_reasoning: string
          p_machine_profile_id: string
          p_part_description: string
          p_part_id: string
          p_part_number: string
          p_portal_customer_id: string
          p_probability: number
          p_projected_due_date: string
          p_projection_window: string
          p_reason: string
          p_workspace: string
        }
        Returns: string
      }
      write_kpi_snapshot: {
        Args: {
          p_data_quality_score: number
          p_metadata: Json
          p_metric_key: string
          p_metric_value: number
          p_period_end: string
          p_period_start: string
          p_refresh_state: string
          p_workspace_id: string
        }
        Returns: string
      }
    }
    Enums: {
      activity_type:
        | "task_created"
        | "email_sent"
        | "call_logged"
        | "stalled_alert"
        | "enrollment_created"
        | "enrollment_completed"
        | "enrollment_cancelled"
        | "deal_stage_change"
        | "integration_config_updated"
        | "integration_connection_tested"
        | "integration_card_clicked"
        | "integration_panel_opened"
        | "customer_profile_viewed"
        | "admin_integrations_viewed"
        | "integration_card_opened"
        | "integration_credentials_saved"
        | "integration_credentials_save_failed"
        | "integration_test_connection_clicked"
        | "integration_badge_rendered"
      crm_activity_type: "note" | "call" | "email" | "meeting" | "task" | "sms"
      crm_auth_event_outcome: "success" | "failure"
      crm_auth_event_type:
        | "login_success"
        | "login_failure"
        | "logout"
        | "token_refresh"
        | "password_reset_request"
        | "password_reset_complete"
        | "access_denied"
      crm_custom_field_object_type: "contact" | "company" | "equipment"
      crm_deal_equipment_role:
        | "subject"
        | "trade_in"
        | "rental"
        | "part_exchange"
      crm_duplicate_candidate_status: "open" | "dismissed" | "merged"
      crm_equipment_availability:
        | "available"
        | "rented"
        | "sold"
        | "in_service"
        | "in_transit"
        | "reserved"
        | "decommissioned"
      crm_equipment_category:
        | "excavator"
        | "loader"
        | "backhoe"
        | "dozer"
        | "skid_steer"
        | "crane"
        | "forklift"
        | "telehandler"
        | "truck"
        | "trailer"
        | "dump_truck"
        | "aerial_lift"
        | "boom_lift"
        | "scissor_lift"
        | "compactor"
        | "roller"
        | "generator"
        | "compressor"
        | "pump"
        | "welder"
        | "attachment"
        | "bucket"
        | "breaker"
        | "concrete"
        | "paving"
        | "drill"
        | "boring"
        | "other"
      crm_equipment_condition:
        | "new"
        | "excellent"
        | "good"
        | "fair"
        | "poor"
        | "salvage"
      crm_equipment_ownership:
        | "owned"
        | "leased"
        | "customer_owned"
        | "rental_fleet"
        | "consignment"
      crm_import_run_status:
        | "queued"
        | "running"
        | "completed"
        | "completed_with_errors"
        | "failed"
        | "cancelled"
      crm_reminder_source: "pipeline_quick" | "deal_detail" | "voice" | "system"
      crm_reminder_status: "scheduled" | "fired" | "dismissed" | "superseded"
      document_audience:
        | "company_wide"
        | "finance"
        | "leadership"
        | "admin_owner"
        | "owner_only"
      document_audit_event_type:
        | "uploaded"
        | "reindexed"
        | "approved"
        | "published"
        | "archived"
        | "reclassified"
        | "deleted"
        | "status_changed"
        | "ingest_failed"
        | "review_due"
      document_source: "onedrive" | "pdf_upload" | "manual"
      document_status:
        | "draft"
        | "pending_review"
        | "published"
        | "archived"
        | "ingest_failed"
      enrollment_status: "active" | "completed" | "paused" | "cancelled"
      followup_step_type: "task" | "email" | "call_log" | "stalled_alert"
      integration_status_enum:
        | "connected"
        | "pending_credentials"
        | "error"
        | "demo_mode"
      outreach_status:
        | "pending"
        | "approved"
        | "sent"
        | "deferred"
        | "dismissed"
      parts_import_conflict_priority: "high" | "normal" | "low"
      parts_import_conflict_resolution:
        | "keep_current"
        | "take_incoming"
        | "custom"
      parts_import_file_type:
        | "partmast"
        | "vendor_price"
        | "vendor_contacts"
        | "unknown"
      parts_import_status:
        | "pending"
        | "parsing"
        | "previewing"
        | "awaiting_conflicts"
        | "committing"
        | "committed"
        | "failed"
        | "rolled_back"
        | "cancelled"
      parts_xref_relationship:
        | "interchangeable"
        | "supersedes"
        | "superseded_by"
        | "aftermarket_equivalent"
        | "oem_equivalent"
        | "kit_component"
        | "kit_parent"
      pricing_level_target:
        | "list_price"
        | "pricing_level_1"
        | "pricing_level_2"
        | "pricing_level_3"
        | "pricing_level_4"
        | "all_levels"
      pricing_persona:
        | "value_driven"
        | "relationship_loyal"
        | "budget_constrained"
        | "urgency_buyer"
      pricing_rule_scope_type:
        | "global"
        | "vendor"
        | "class"
        | "category"
        | "machine_code"
        | "part"
      pricing_rule_type:
        | "min_margin_pct"
        | "target_margin_pct"
        | "markup_multiplier"
        | "markup_with_floor"
      pricing_suggestion_status:
        | "pending"
        | "approved"
        | "applied"
        | "dismissed"
        | "expired"
      scenario_type: "max_margin" | "balanced" | "win_the_deal"
      service_parts_action_type:
        | "pick"
        | "transfer"
        | "order"
        | "substitute"
        | "receive"
        | "stage"
        | "consume"
        | "return"
      service_priority: "normal" | "urgent" | "critical"
      service_request_type:
        | "repair"
        | "pm_service"
        | "inspection"
        | "machine_down"
        | "recall"
        | "warranty"
      service_source_type:
        | "call"
        | "walk_in"
        | "field_tech"
        | "sales_handoff"
        | "portal"
      service_stage:
        | "request_received"
        | "triaging"
        | "diagnosis_selected"
        | "quote_drafted"
        | "quote_sent"
        | "approved"
        | "parts_pending"
        | "parts_staged"
        | "haul_scheduled"
        | "scheduled"
        | "in_progress"
        | "blocked_waiting"
        | "quality_check"
        | "ready_for_pickup"
        | "invoice_ready"
        | "invoiced"
        | "paid_closed"
      service_status_flag:
        | "machine_down"
        | "shop_job"
        | "field_job"
        | "internal"
        | "warranty_recall"
        | "customer_pay"
        | "good_faith"
        | "waiting_customer"
        | "waiting_vendor"
        | "waiting_transfer"
        | "waiting_haul"
      sync_frequency:
        | "realtime"
        | "hourly"
        | "every_6_hours"
        | "daily"
        | "weekly"
        | "manual"
      user_role: "rep" | "admin" | "manager" | "owner"
      voice_capture_status: "pending" | "processing" | "synced" | "failed"
      voice_intent:
        | "lookup"
        | "stock_check"
        | "add_to_order"
        | "history"
        | "other"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_type: [
        "task_created",
        "email_sent",
        "call_logged",
        "stalled_alert",
        "enrollment_created",
        "enrollment_completed",
        "enrollment_cancelled",
        "deal_stage_change",
        "integration_config_updated",
        "integration_connection_tested",
        "integration_card_clicked",
        "integration_panel_opened",
        "customer_profile_viewed",
        "admin_integrations_viewed",
        "integration_card_opened",
        "integration_credentials_saved",
        "integration_credentials_save_failed",
        "integration_test_connection_clicked",
        "integration_badge_rendered",
      ],
      crm_activity_type: ["note", "call", "email", "meeting", "task", "sms"],
      crm_auth_event_outcome: ["success", "failure"],
      crm_auth_event_type: [
        "login_success",
        "login_failure",
        "logout",
        "token_refresh",
        "password_reset_request",
        "password_reset_complete",
        "access_denied",
      ],
      crm_custom_field_object_type: ["contact", "company", "equipment"],
      crm_deal_equipment_role: [
        "subject",
        "trade_in",
        "rental",
        "part_exchange",
      ],
      crm_duplicate_candidate_status: ["open", "dismissed", "merged"],
      crm_equipment_availability: [
        "available",
        "rented",
        "sold",
        "in_service",
        "in_transit",
        "reserved",
        "decommissioned",
      ],
      crm_equipment_category: [
        "excavator",
        "loader",
        "backhoe",
        "dozer",
        "skid_steer",
        "crane",
        "forklift",
        "telehandler",
        "truck",
        "trailer",
        "dump_truck",
        "aerial_lift",
        "boom_lift",
        "scissor_lift",
        "compactor",
        "roller",
        "generator",
        "compressor",
        "pump",
        "welder",
        "attachment",
        "bucket",
        "breaker",
        "concrete",
        "paving",
        "drill",
        "boring",
        "other",
      ],
      crm_equipment_condition: [
        "new",
        "excellent",
        "good",
        "fair",
        "poor",
        "salvage",
      ],
      crm_equipment_ownership: [
        "owned",
        "leased",
        "customer_owned",
        "rental_fleet",
        "consignment",
      ],
      crm_import_run_status: [
        "queued",
        "running",
        "completed",
        "completed_with_errors",
        "failed",
        "cancelled",
      ],
      crm_reminder_source: ["pipeline_quick", "deal_detail", "voice", "system"],
      crm_reminder_status: ["scheduled", "fired", "dismissed", "superseded"],
      document_audience: [
        "company_wide",
        "finance",
        "leadership",
        "admin_owner",
        "owner_only",
      ],
      document_audit_event_type: [
        "uploaded",
        "reindexed",
        "approved",
        "published",
        "archived",
        "reclassified",
        "deleted",
        "status_changed",
        "ingest_failed",
        "review_due",
      ],
      document_source: ["onedrive", "pdf_upload", "manual"],
      document_status: [
        "draft",
        "pending_review",
        "published",
        "archived",
        "ingest_failed",
      ],
      enrollment_status: ["active", "completed", "paused", "cancelled"],
      followup_step_type: ["task", "email", "call_log", "stalled_alert"],
      integration_status_enum: [
        "connected",
        "pending_credentials",
        "error",
        "demo_mode",
      ],
      outreach_status: ["pending", "approved", "sent", "deferred", "dismissed"],
      parts_import_conflict_priority: ["high", "normal", "low"],
      parts_import_conflict_resolution: [
        "keep_current",
        "take_incoming",
        "custom",
      ],
      parts_import_file_type: [
        "partmast",
        "vendor_price",
        "vendor_contacts",
        "unknown",
      ],
      parts_import_status: [
        "pending",
        "parsing",
        "previewing",
        "awaiting_conflicts",
        "committing",
        "committed",
        "failed",
        "rolled_back",
        "cancelled",
      ],
      parts_xref_relationship: [
        "interchangeable",
        "supersedes",
        "superseded_by",
        "aftermarket_equivalent",
        "oem_equivalent",
        "kit_component",
        "kit_parent",
      ],
      pricing_level_target: [
        "list_price",
        "pricing_level_1",
        "pricing_level_2",
        "pricing_level_3",
        "pricing_level_4",
        "all_levels",
      ],
      pricing_persona: [
        "value_driven",
        "relationship_loyal",
        "budget_constrained",
        "urgency_buyer",
      ],
      pricing_rule_scope_type: [
        "global",
        "vendor",
        "class",
        "category",
        "machine_code",
        "part",
      ],
      pricing_rule_type: [
        "min_margin_pct",
        "target_margin_pct",
        "markup_multiplier",
        "markup_with_floor",
      ],
      pricing_suggestion_status: [
        "pending",
        "approved",
        "applied",
        "dismissed",
        "expired",
      ],
      scenario_type: ["max_margin", "balanced", "win_the_deal"],
      service_parts_action_type: [
        "pick",
        "transfer",
        "order",
        "substitute",
        "receive",
        "stage",
        "consume",
        "return",
      ],
      service_priority: ["normal", "urgent", "critical"],
      service_request_type: [
        "repair",
        "pm_service",
        "inspection",
        "machine_down",
        "recall",
        "warranty",
      ],
      service_source_type: [
        "call",
        "walk_in",
        "field_tech",
        "sales_handoff",
        "portal",
      ],
      service_stage: [
        "request_received",
        "triaging",
        "diagnosis_selected",
        "quote_drafted",
        "quote_sent",
        "approved",
        "parts_pending",
        "parts_staged",
        "haul_scheduled",
        "scheduled",
        "in_progress",
        "blocked_waiting",
        "quality_check",
        "ready_for_pickup",
        "invoice_ready",
        "invoiced",
        "paid_closed",
      ],
      service_status_flag: [
        "machine_down",
        "shop_job",
        "field_job",
        "internal",
        "warranty_recall",
        "customer_pay",
        "good_faith",
        "waiting_customer",
        "waiting_vendor",
        "waiting_transfer",
        "waiting_haul",
      ],
      sync_frequency: [
        "realtime",
        "hourly",
        "every_6_hours",
        "daily",
        "weekly",
        "manual",
      ],
      user_role: ["rep", "admin", "manager", "owner"],
      voice_capture_status: ["pending", "processing", "synced", "failed"],
      voice_intent: [
        "lookup",
        "stock_check",
        "add_to_order",
        "history",
        "other",
      ],
    },
  },
} as const

export type UserRole = Database["public"]["Enums"]["user_role"]
