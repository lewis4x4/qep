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
      analytics_events: {
        Row: {
          context: Json
          entity_id: string | null
          entity_type: string | null
          event_id: string
          event_name: string
          event_version: number
          occurred_at: string
          project_id: string
          properties: Json | null
          received_at: string
          request_id: string | null
          role: string
          session_id: string | null
          source: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          context?: Json
          entity_id?: string | null
          entity_type?: string | null
          event_id?: string
          event_name: string
          event_version?: number
          occurred_at?: string
          project_id: string
          properties?: Json | null
          received_at?: string
          request_id?: string | null
          role?: string
          session_id?: string | null
          source: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          context?: Json
          entity_id?: string | null
          entity_type?: string | null
          event_id?: string
          event_name?: string
          event_version?: number
          occurred_at?: string
          project_id?: string
          properties?: Json | null
          received_at?: string
          request_id?: string | null
          role?: string
          session_id?: string | null
          source?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: []
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
      chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          metadata: Json | null
          token_count: number | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          token_count?: number | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
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
      crm_activities: {
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
            foreignKeyName: "crm_activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
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
        ]
      }
      crm_activity_templates: {
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
      crm_auth_audit_events: {
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
      crm_companies: {
        Row: {
          address_line_1: string | null
          address_line_2: string | null
          assigned_rep_id: string | null
          city: string | null
          country: string | null
          created_at: string
          deleted_at: string | null
          hubspot_company_id: string | null
          id: string
          metadata: Json
          name: string
          parent_company_id: string | null
          postal_code: string | null
          state: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          address_line_1?: string | null
          address_line_2?: string | null
          assigned_rep_id?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          hubspot_company_id?: string | null
          id?: string
          metadata?: Json
          name: string
          parent_company_id?: string | null
          postal_code?: string | null
          state?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          address_line_1?: string | null
          address_line_2?: string | null
          assigned_rep_id?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          hubspot_company_id?: string | null
          id?: string
          metadata?: Json
          name?: string
          parent_company_id?: string | null
          postal_code?: string | null
          state?: string | null
          updated_at?: string
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
        ]
      }
      crm_contact_companies: {
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
            foreignKeyName: "crm_contact_companies_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contact_tags: {
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
            foreignKeyName: "crm_contact_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "crm_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contact_territories: {
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
            foreignKeyName: "crm_contact_territories_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "crm_territories"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contacts: {
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
            foreignKeyName: "crm_contacts_merged_into_contact_id_fkey"
            columns: ["merged_into_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_primary_company_id_fkey"
            columns: ["primary_company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_custom_field_definitions: {
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
      crm_custom_field_values: {
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
        ]
      }
      crm_deal_stages: {
        Row: {
          created_at: string
          hubspot_stage_id: string | null
          id: string
          is_closed_lost: boolean
          is_closed_won: boolean
          name: string
          probability: number | null
          sort_order: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          hubspot_stage_id?: string | null
          id?: string
          is_closed_lost?: boolean
          is_closed_won?: boolean
          name: string
          probability?: number | null
          sort_order?: number
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          hubspot_stage_id?: string | null
          id?: string
          is_closed_lost?: boolean
          is_closed_won?: boolean
          name?: string
          probability?: number | null
          sort_order?: number
          updated_at?: string
          workspace_id?: string
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
          created_at: string
          deleted_at: string | null
          expected_close_on: string | null
          hubspot_deal_id: string | null
          id: string
          last_activity_at: string | null
          loss_reason: string | null
          margin_amount: number | null
          margin_pct: number | null
          metadata: Json
          name: string
          next_follow_up_at: string | null
          primary_contact_id: string | null
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
          deleted_at?: string | null
          expected_close_on?: string | null
          hubspot_deal_id?: string | null
          id?: string
          last_activity_at?: string | null
          loss_reason?: string | null
          margin_amount?: number | null
          margin_pct?: number | null
          metadata?: Json
          name: string
          next_follow_up_at?: string | null
          primary_contact_id?: string | null
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
          deleted_at?: string | null
          expected_close_on?: string | null
          hubspot_deal_id?: string | null
          id?: string
          last_activity_at?: string | null
          loss_reason?: string | null
          margin_amount?: number | null
          margin_pct?: number | null
          metadata?: Json
          name?: string
          next_follow_up_at?: string | null
          primary_contact_id?: string | null
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
            foreignKeyName: "crm_deals_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_deal_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_duplicate_candidates: {
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
            foreignKeyName: "crm_duplicate_candidates_right_contact_id_fkey"
            columns: ["right_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_equipment: {
        Row: {
          asset_tag: string | null
          company_id: string
          created_at: string
          deleted_at: string | null
          id: string
          metadata: Json
          name: string
          primary_contact_id: string | null
          serial_number: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          asset_tag?: string | null
          company_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          metadata?: Json
          name: string
          primary_contact_id?: string | null
          serial_number?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          asset_tag?: string | null
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          metadata?: Json
          name?: string
          primary_contact_id?: string | null
          serial_number?: string | null
          updated_at?: string
          workspace_id?: string
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
            foreignKeyName: "crm_equipment_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_external_id_map: {
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
      crm_hubspot_import_errors: {
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
        ]
      }
      crm_hubspot_import_runs: {
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
      crm_merge_audit_events: {
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
            foreignKeyName: "crm_merge_audit_events_survivor_contact_id_fkey"
            columns: ["survivor_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_quote_audit_events: {
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
      crm_tags: {
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
      crm_territories: {
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
            foreignKeyName: "customer_deal_history_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
        ]
      }
      customer_profiles_extended: {
        Row: {
          attachment_rate: number | null
          avg_days_to_close: number | null
          avg_deal_size: number | null
          avg_discount_pct: number | null
          company_name: string | null
          created_at: string
          customer_name: string
          fleet_size: number | null
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
          company_name?: string | null
          created_at?: string
          customer_name: string
          fleet_size?: number | null
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
          company_name?: string | null
          created_at?: string
          customer_name?: string
          fleet_size?: number | null
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
          seasonal_pattern?: string | null
          service_contract_rate?: number | null
          total_deals?: number | null
          updated_at?: string
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
          review_owner_user_id: string | null
          source: Database["public"]["Enums"]["document_source"]
          source_id: string | null
          source_url: string | null
          status: Database["public"]["Enums"]["document_status"]
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
          review_owner_user_id?: string | null
          source: Database["public"]["Enums"]["document_source"]
          source_id?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["document_status"]
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
          review_owner_user_id?: string | null
          source?: Database["public"]["Enums"]["document_source"]
          source_id?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["document_status"]
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
      manufacturer_incentives: {
        Row: {
          created_at: string
          discount_type: string
          discount_value: number
          eligibility_criteria: string | null
          eligible_categories: string[] | null
          eligible_models: string[] | null
          end_date: string | null
          entered_by: string | null
          id: string
          is_active: boolean
          metadata: Json | null
          oem_name: string
          program_name: string
          source: string | null
          stacking_rules: string | null
          start_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          discount_type: string
          discount_value: number
          eligibility_criteria?: string | null
          eligible_categories?: string[] | null
          eligible_models?: string[] | null
          end_date?: string | null
          entered_by?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json | null
          oem_name: string
          program_name: string
          source?: string | null
          stacking_rules?: string | null
          start_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          discount_type?: string
          discount_value?: number
          eligibility_criteria?: string | null
          eligible_categories?: string[] | null
          eligible_models?: string[] | null
          end_date?: string | null
          entered_by?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json | null
          oem_name?: string
          program_name?: string
          source?: string | null
          stacking_rules?: string | null
          start_date?: string
          updated_at?: string
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
      onedrive_sync_state: {
        Row: {
          access_token_encrypted: string | null
          created_at: string
          delta_token: string | null
          drive_id: string | null
          id: string
          last_synced_at: string | null
          refresh_token_encrypted: string | null
          token_expires_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          access_token_encrypted?: string | null
          created_at?: string
          delta_token?: string | null
          drive_id?: string | null
          id?: string
          last_synced_at?: string | null
          refresh_token_encrypted?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          access_token_encrypted?: string | null
          created_at?: string
          delta_token?: string | null
          drive_id?: string | null
          id?: string
          last_synced_at?: string | null
          refresh_token_encrypted?: string | null
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
            foreignKeyName: "outreach_queue_fleet_intelligence_id_fkey"
            columns: ["fleet_intelligence_id"]
            isOneToOne: false
            referencedRelation: "fleet_intelligence"
            referencedColumns: ["id"]
          },
        ]
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
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
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
      voice_captures: {
        Row: {
          audio_storage_path: string | null
          created_at: string
          duration_seconds: number | null
          extracted_data: Json
          hubspot_contact_id: string | null
          hubspot_deal_id: string | null
          hubspot_note_id: string | null
          hubspot_synced_at: string | null
          hubspot_task_id: string | null
          id: string
          sync_error: string | null
          sync_status: Database["public"]["Enums"]["voice_capture_status"]
          transcript: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          audio_storage_path?: string | null
          created_at?: string
          duration_seconds?: number | null
          extracted_data?: Json
          hubspot_contact_id?: string | null
          hubspot_deal_id?: string | null
          hubspot_note_id?: string | null
          hubspot_synced_at?: string | null
          hubspot_task_id?: string | null
          id?: string
          sync_error?: string | null
          sync_status?: Database["public"]["Enums"]["voice_capture_status"]
          transcript?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          audio_storage_path?: string | null
          created_at?: string
          duration_seconds?: number | null
          extracted_data?: Json
          hubspot_contact_id?: string | null
          hubspot_deal_id?: string | null
          hubspot_note_id?: string | null
          hubspot_synced_at?: string | null
          hubspot_task_id?: string | null
          id?: string
          sync_error?: string | null
          sync_status?: Database["public"]["Enums"]["voice_capture_status"]
          transcript?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_captures_user_id_fkey"
            columns: ["user_id"]
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
    }
    Views: {
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
            foreignKeyName: "crm_deals_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_deal_stages"
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
          expected_close_on: string | null
          hubspot_deal_id: string | null
          id: string | null
          last_activity_at: string | null
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
          created_at?: string | null
          deleted_at?: string | null
          expected_close_on?: string | null
          hubspot_deal_id?: string | null
          id?: string | null
          last_activity_at?: string | null
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
          created_at?: string | null
          deleted_at?: string | null
          expected_close_on?: string | null
          hubspot_deal_id?: string | null
          id?: string | null
          last_activity_at?: string | null
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
            foreignKeyName: "crm_deals_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_deal_stages"
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
            foreignKeyName: "crm_deals_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_deal_stages"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      archive_crm_company: { Args: { p_company_id: string }; Returns: Json }
      archive_crm_contact: { Args: { p_contact_id: string }; Returns: Json }
      archive_crm_deal: { Args: { p_deal_id: string }; Returns: Json }
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
      document_role_can_view_audience: {
        Args: {
          p_audience: Database["public"]["Enums"]["document_audience"]
          p_role: string
        }
        Returns: boolean
      }
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      get_my_workspace: { Args: never; Returns: string }
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
      retrieve_document_evidence: {
        Args: {
          keyword_query: string
          match_count?: number
          query_embedding: string
          semantic_match_threshold?: number
          user_role: string
        }
        Returns: {
          access_class: string
          confidence: number
          excerpt: string
          source_id: string
          source_title: string
          source_type: string
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
      search_chunks: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          content: string
          document_id: string
          document_title: string
          id: string
          metadata: Json
          similarity: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
      crm_duplicate_candidate_status: "open" | "dismissed" | "merged"
      crm_import_run_status:
        | "queued"
        | "running"
        | "completed"
        | "completed_with_errors"
        | "failed"
        | "cancelled"
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
      pricing_persona:
        | "value_driven"
        | "relationship_loyal"
        | "budget_constrained"
        | "urgency_buyer"
      scenario_type: "max_margin" | "balanced" | "win_the_deal"
      sync_frequency:
        | "realtime"
        | "hourly"
        | "every_6_hours"
        | "daily"
        | "weekly"
        | "manual"
      user_role: "rep" | "admin" | "manager" | "owner"
      voice_capture_status: "pending" | "processing" | "synced" | "failed"
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
      crm_duplicate_candidate_status: ["open", "dismissed", "merged"],
      crm_import_run_status: [
        "queued",
        "running",
        "completed",
        "completed_with_errors",
        "failed",
        "cancelled",
      ],
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
      pricing_persona: [
        "value_driven",
        "relationship_loyal",
        "budget_constrained",
        "urgency_buyer",
      ],
      scenario_type: ["max_margin", "balanced", "win_the_deal"],
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
    },
  },
} as const

export type UserRole = Database["public"]["Enums"]["user_role"]
