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
          attachments: Json | null
          branch: string | null
          brochure_url: string | null
          category: string | null
          condition: string | null
          created_at: string
          dealer_cost: number | null
          external_id: string | null
          id: string
          imported_at: string | null
          is_available: boolean
          last_synced_at: string | null
          list_price: number | null
          make: string
          model: string
          msrp: number | null
          photos: Json | null
          serial_number: string | null
          source: string
          stock_number: string | null
          updated_at: string
          video_url: string | null
          workspace_id: string
          year: number | null
        }
        Insert: {
          attachments?: Json | null
          branch?: string | null
          brochure_url?: string | null
          category?: string | null
          condition?: string | null
          created_at?: string
          dealer_cost?: number | null
          external_id?: string | null
          id?: string
          imported_at?: string | null
          is_available?: boolean
          last_synced_at?: string | null
          list_price?: number | null
          make: string
          model: string
          msrp?: number | null
          photos?: Json | null
          serial_number?: string | null
          source?: string
          stock_number?: string | null
          updated_at?: string
          video_url?: string | null
          workspace_id?: string
          year?: number | null
        }
        Update: {
          attachments?: Json | null
          branch?: string | null
          brochure_url?: string | null
          category?: string | null
          condition?: string | null
          created_at?: string
          dealer_cost?: number | null
          external_id?: string | null
          id?: string
          imported_at?: string | null
          is_available?: boolean
          last_synced_at?: string | null
          list_price?: number | null
          make?: string
          model?: string
          msrp?: number | null
          photos?: Json | null
          serial_number?: string | null
          source?: string
          stock_number?: string | null
          updated_at?: string
          video_url?: string | null
          workspace_id?: string
          year?: number | null
        }
        Relationships: []
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
      crm_deal_equipment: {
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
            foreignKeyName: "crm_deal_equipment_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_deal_stages: {
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
      crm_deals: {
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
          hubspot_deal_id: string | null
          id: string
          last_activity_at: string | null
          loss_reason: string | null
          margin_amount: number | null
          margin_check_status: string
          margin_pct: number | null
          metadata: Json
          name: string
          needs_assessment_id: string | null
          next_follow_up_at: string | null
          primary_contact_id: string | null
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
          hubspot_deal_id?: string | null
          id?: string
          last_activity_at?: string | null
          loss_reason?: string | null
          margin_amount?: number | null
          margin_check_status?: string
          margin_pct?: number | null
          metadata?: Json
          name: string
          needs_assessment_id?: string | null
          next_follow_up_at?: string | null
          primary_contact_id?: string | null
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
          hubspot_deal_id?: string | null
          id?: string
          last_activity_at?: string | null
          loss_reason?: string | null
          margin_amount?: number | null
          margin_check_status?: string
          margin_pct?: number | null
          metadata?: Json
          name?: string
          needs_assessment_id?: string | null
          next_follow_up_at?: string | null
          primary_contact_id?: string | null
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
      crm_embeddings: {
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
      crm_equipment: {
        Row: {
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
          purchase_price: number | null
          replacement_cost: number | null
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
          purchase_price?: number | null
          replacement_cost?: number | null
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
          purchase_price?: number | null
          replacement_cost?: number | null
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
      crm_in_app_notifications: {
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
            foreignKeyName: "crm_in_app_notifications_reminder_instance_id_fkey"
            columns: ["reminder_instance_id"]
            isOneToOne: false
            referencedRelation: "crm_reminder_instances"
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
      crm_reminder_instances: {
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
            foreignKeyName: "crm_reminder_instances_task_activity_id_fkey"
            columns: ["task_activity_id"]
            isOneToOne: false
            referencedRelation: "crm_activities"
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
            foreignKeyName: "demos_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "crm_equipment"
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
          refund_policy: string
          required_amount: number
          status: string
          updated_at: string
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
          refund_policy?: string
          required_amount: number
          status?: string
          updated_at?: string
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
          refund_policy?: string
          required_amount?: number
          status?: string
          updated_at?: string
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
            foreignKeyName: "deposits_verified_by_fkey"
            columns: ["verified_by"]
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
            foreignKeyName: "equipment_intake_pdi_signed_off_by_fkey"
            columns: ["pdi_signed_off_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            foreignKeyName: "escalation_tickets_touchpoint_id_fkey"
            columns: ["touchpoint_id"]
            isOneToOne: false
            referencedRelation: "follow_up_touchpoints"
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
      knowledge_gaps: {
        Row: {
          created_at: string
          frequency: number
          id: string
          last_asked_at: string
          question: string
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
            foreignKeyName: "maintenance_schedules_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "customer_fleet"
            referencedColumns: ["id"]
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
            foreignKeyName: "outreach_queue_fleet_intelligence_id_fkey"
            columns: ["fleet_intelligence_id"]
            isOneToOne: false
            referencedRelation: "fleet_intelligence"
            referencedColumns: ["id"]
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
      parts_catalog: {
        Row: {
          category: string | null
          cost_price: number | null
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          is_active: boolean
          list_price: number | null
          manufacturer: string | null
          part_number: string
          uom: string | null
          updated_at: string
          weight_lb: number | null
          workspace_id: string
        }
        Insert: {
          category?: string | null
          cost_price?: number | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          list_price?: number | null
          manufacturer?: string | null
          part_number: string
          uom?: string | null
          updated_at?: string
          weight_lb?: number | null
          workspace_id?: string
        }
        Update: {
          category?: string | null
          cost_price?: number | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          list_price?: number | null
          manufacturer?: string | null
          part_number?: string
          uom?: string | null
          updated_at?: string
          weight_lb?: number | null
          workspace_id?: string
        }
        Relationships: []
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
            foreignKeyName: "parts_order_lines_parts_order_id_fkey"
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
          line_items: Json
          notes: string | null
          order_source: string
          portal_customer_id: string | null
          shipping: number | null
          shipping_address: Json | null
          status: string
          subtotal: number | null
          tax: number | null
          total: number | null
          tracking_number: string | null
          updated_at: string
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
          line_items?: Json
          notes?: string | null
          order_source?: string
          portal_customer_id?: string | null
          shipping?: number | null
          shipping_address?: Json | null
          status?: string
          subtotal?: number | null
          tax?: number | null
          total?: number | null
          tracking_number?: string | null
          updated_at?: string
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
          line_items?: Json
          notes?: string | null
          order_source?: string
          portal_customer_id?: string | null
          shipping?: number | null
          shipping_address?: Json | null
          status?: string
          subtotal?: number | null
          tax?: number | null
          total?: number | null
          tracking_number?: string | null
          updated_at?: string
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
            foreignKeyName: "parts_orders_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "customer_fleet"
            referencedColumns: ["id"]
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
      payment_validations: {
        Row: {
          amount: number
          created_at: string
          customer_id: string | null
          daily_check_total: number | null
          id: string
          invoice_reference: string | null
          is_delivery_day: boolean | null
          override_by: string | null
          override_reason: string | null
          passed: boolean
          payment_type: string
          rule_applied: string | null
          transaction_type: string | null
          validation_date: string
          workspace_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          customer_id?: string | null
          daily_check_total?: number | null
          id?: string
          invoice_reference?: string | null
          is_delivery_day?: boolean | null
          override_by?: string | null
          override_reason?: string | null
          passed: boolean
          payment_type: string
          rule_applied?: string | null
          transaction_type?: string | null
          validation_date?: string
          workspace_id?: string
        }
        Update: {
          amount?: number
          created_at?: string
          customer_id?: string | null
          daily_check_total?: number | null
          id?: string
          invoice_reference?: string | null
          is_delivery_day?: boolean | null
          override_by?: string | null
          override_reason?: string | null
          passed?: boolean
          payment_type?: string
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
            foreignKeyName: "payment_validations_override_by_fkey"
            columns: ["override_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            foreignKeyName: "portal_customers_crm_contact_id_fkey"
            columns: ["crm_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
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
            foreignKeyName: "prospecting_visits_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
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
          deal_id: string
          entry_mode: string | null
          equipment: Json
          equipment_total: number | null
          expires_at: string | null
          financing_scenarios: Json | null
          id: string
          margin_amount: number | null
          margin_pct: number | null
          net_total: number | null
          pdf_generated_at: string | null
          pdf_url: string | null
          photos_included: Json | null
          sent_at: string | null
          sent_via: string | null
          status: string
          subtotal: number | null
          trade_allowance: number | null
          trade_credit: number | null
          trade_in_valuation_id: string | null
          updated_at: string
          video_url: string | null
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
          deal_id: string
          entry_mode?: string | null
          equipment?: Json
          equipment_total?: number | null
          expires_at?: string | null
          financing_scenarios?: Json | null
          id?: string
          margin_amount?: number | null
          margin_pct?: number | null
          net_total?: number | null
          pdf_generated_at?: string | null
          pdf_url?: string | null
          photos_included?: Json | null
          sent_at?: string | null
          sent_via?: string | null
          status?: string
          subtotal?: number | null
          trade_allowance?: number | null
          trade_credit?: number | null
          trade_in_valuation_id?: string | null
          updated_at?: string
          video_url?: string | null
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
          deal_id?: string
          entry_mode?: string | null
          equipment?: Json
          equipment_total?: number | null
          expires_at?: string | null
          financing_scenarios?: Json | null
          id?: string
          margin_amount?: number | null
          margin_pct?: number | null
          net_total?: number | null
          pdf_generated_at?: string | null
          pdf_url?: string | null
          photos_included?: Json | null
          sent_at?: string | null
          sent_via?: string | null
          status?: string
          subtotal?: number | null
          trade_allowance?: number | null
          trade_credit?: number | null
          trade_in_valuation_id?: string | null
          updated_at?: string
          video_url?: string | null
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
            foreignKeyName: "quote_signatures_quote_package_id_fkey"
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
      rental_returns: {
        Row: {
          balance_due: number | null
          charge_amount: number | null
          condition_photos: Json | null
          created_at: string
          credit_invoice_number: string | null
          damage_description: string | null
          decided_by: string | null
          deposit_amount: number | null
          deposit_covers_charges: boolean | null
          equipment_id: string | null
          has_charges: boolean | null
          id: string
          inspection_checklist: Json | null
          inspection_date: string | null
          inspector_id: string | null
          original_payment_method: string | null
          refund_check_turnaround: string | null
          refund_method: string | null
          refund_status: string | null
          rental_contract_reference: string | null
          status: string
          updated_at: string
          work_order_number: string | null
          workspace_id: string
        }
        Insert: {
          balance_due?: number | null
          charge_amount?: number | null
          condition_photos?: Json | null
          created_at?: string
          credit_invoice_number?: string | null
          damage_description?: string | null
          decided_by?: string | null
          deposit_amount?: number | null
          deposit_covers_charges?: boolean | null
          equipment_id?: string | null
          has_charges?: boolean | null
          id?: string
          inspection_checklist?: Json | null
          inspection_date?: string | null
          inspector_id?: string | null
          original_payment_method?: string | null
          refund_check_turnaround?: string | null
          refund_method?: string | null
          refund_status?: string | null
          rental_contract_reference?: string | null
          status?: string
          updated_at?: string
          work_order_number?: string | null
          workspace_id?: string
        }
        Update: {
          balance_due?: number | null
          charge_amount?: number | null
          condition_photos?: Json | null
          created_at?: string
          credit_invoice_number?: string | null
          damage_description?: string | null
          decided_by?: string | null
          deposit_amount?: number | null
          deposit_covers_charges?: boolean | null
          equipment_id?: string | null
          has_charges?: boolean | null
          id?: string
          inspection_checklist?: Json | null
          inspection_date?: string | null
          inspector_id?: string | null
          original_payment_method?: string | null
          refund_check_turnaround?: string | null
          refund_method?: string | null
          refund_status?: string | null
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
            foreignKeyName: "rental_returns_inspector_id_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            foreignKeyName: "service_jobs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
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
        ]
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
        ]
      }
      traffic_tickets: {
        Row: {
          billing_comments: string
          coordinator_id: string | null
          created_at: string
          deal_id: string | null
          delivery_address: string | null
          delivery_lat: number | null
          delivery_lng: number | null
          delivery_photos: Json | null
          delivery_signature_url: string | null
          demo_id: string | null
          department: string
          driver_checklist: Json | null
          driver_id: string | null
          equipment_id: string | null
          from_location: string
          hour_meter_reading: number | null
          id: string
          locked: boolean | null
          problems_reported: string | null
          requested_by: string | null
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
          coordinator_id?: string | null
          created_at?: string
          deal_id?: string | null
          delivery_address?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_photos?: Json | null
          delivery_signature_url?: string | null
          demo_id?: string | null
          department: string
          driver_checklist?: Json | null
          driver_id?: string | null
          equipment_id?: string | null
          from_location: string
          hour_meter_reading?: number | null
          id?: string
          locked?: boolean | null
          problems_reported?: string | null
          requested_by?: string | null
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
          coordinator_id?: string | null
          created_at?: string
          deal_id?: string | null
          delivery_address?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_photos?: Json | null
          delivery_signature_url?: string | null
          demo_id?: string | null
          department?: string
          driver_checklist?: Json | null
          driver_id?: string | null
          equipment_id?: string | null
          from_location?: string
          hour_meter_reading?: number | null
          id?: string
          locked?: boolean | null
          problems_reported?: string | null
          requested_by?: string | null
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
          created_at: string
          id: string
          machine_down_escalation_path: string | null
          name: string
          notes: string | null
          responsiveness_score: number | null
          supplier_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          after_hours_contact?: string | null
          avg_lead_time_hours?: number | null
          category_support?: Json
          created_at?: string
          id?: string
          machine_down_escalation_path?: string | null
          name: string
          notes?: string | null
          responsiveness_score?: number | null
          supplier_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          after_hours_contact?: string | null
          avg_lead_time_hours?: number | null
          category_support?: Json
          created_at?: string
          id?: string
          machine_down_escalation_path?: string | null
          name?: string
          notes?: string | null
          responsiveness_score?: number | null
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
            foreignKeyName: "voice_captures_linked_contact_id_fkey"
            columns: ["linked_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
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
            foreignKeyName: "voice_captures_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_qrm_results: {
        Row: {
          cadence_id: string | null
          company_id: string | null
          company_match_confidence: number | null
          company_match_method: string | null
          contact_id: string | null
          contact_match_confidence: number | null
          contact_match_method: string | null
          created_at: string
          deal_action: string | null
          deal_id: string | null
          entity_creation_duration_ms: number | null
          errors: Json | null
          extraction_duration_ms: number | null
          id: string
          needs_assessment_id: string | null
          qrm_narrative: string | null
          total_duration_ms: number | null
          voice_capture_id: string
          workspace_id: string
        }
        Insert: {
          cadence_id?: string | null
          company_id?: string | null
          company_match_confidence?: number | null
          company_match_method?: string | null
          contact_id?: string | null
          contact_match_confidence?: number | null
          contact_match_method?: string | null
          created_at?: string
          deal_action?: string | null
          deal_id?: string | null
          entity_creation_duration_ms?: number | null
          errors?: Json | null
          extraction_duration_ms?: number | null
          id?: string
          needs_assessment_id?: string | null
          qrm_narrative?: string | null
          total_duration_ms?: number | null
          voice_capture_id: string
          workspace_id?: string
        }
        Update: {
          cadence_id?: string | null
          company_id?: string | null
          company_match_confidence?: number | null
          company_match_method?: string | null
          contact_id?: string | null
          contact_match_confidence?: number | null
          contact_match_method?: string | null
          created_at?: string
          deal_action?: string | null
          deal_id?: string | null
          entity_creation_duration_ms?: number | null
          errors?: Json | null
          extraction_duration_ms?: number | null
          id?: string
          needs_assessment_id?: string | null
          qrm_narrative?: string | null
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
            foreignKeyName: "voice_qrm_results_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
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
      archive_crm_company: { Args: { p_company_id: string }; Returns: Json }
      archive_crm_contact: { Args: { p_contact_id: string }; Returns: Json }
      archive_crm_deal: { Args: { p_deal_id: string }; Returns: Json }
      batch_apply_follow_up_touchpoint_ai: {
        Args: { p_rows: Json }
        Returns: number
      }
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
      document_role_can_view_audience: {
        Args: {
          p_audience: Database["public"]["Enums"]["document_audience"]
          p_role: string
        }
        Returns: boolean
      }
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
      get_deal_composite: { Args: { p_deal_id: string }; Returns: Json }
      get_deposit_tier: { Args: { p_amount: number }; Returns: string }
      get_my_iron_role: { Args: never; Returns: string }
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      get_my_workspace: { Args: never; Returns: string }
      get_portal_customer_id: { Args: never; Returns: string }
      inspection_in_my_workspace: {
        Args: { p_demo_id: string }
        Returns: boolean
      }
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
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      signature_in_my_workspace: {
        Args: { p_package_id: string }
        Returns: boolean
      }
      subscription_in_my_workspace: {
        Args: { p_sub_id: string }
        Returns: boolean
      }
      touchpoint_in_my_workspace: {
        Args: { p_cadence_id: string }
        Returns: boolean
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
    },
  },
} as const

export type UserRole = Database["public"]["Enums"]["user_role"]
