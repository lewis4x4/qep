// Auto-generated from Supabase + voice_captures extension
// Last updated: 2026-03-26

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// Custom types used in voice capture UI
export type UserRole = "rep" | "admin" | "manager" | "owner";
export type DocumentSource = "onedrive" | "pdf_upload" | "manual";
export type VoiceCaptureStatus = "pending" | "processing" | "synced" | "failed";
export type DealStage =
  | "initial_contact"
  | "follow_up"
  | "demo_scheduled"
  | "quote_sent"
  | "negotiation"
  | "closed_won"
  | "closed_lost";

export interface ExtractedDealData {
  customer_name: string | null;
  company_name: string | null;
  machine_interest: string | null;
  attachments_discussed: string | null;
  deal_stage: DealStage | null;
  budget_range: string | null;
  key_concerns: string | null;
  action_items: string[];
  next_step: string | null;
  follow_up_date: string | null;
}

export type Database = {
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
      documents: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          metadata: Json | null
          mime_type: string | null
          raw_text: string | null
          source: Database["public"]["Enums"]["document_source"]
          source_id: string | null
          source_url: string | null
          title: string
          updated_at: string
          uploaded_by: string | null
          word_count: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json | null
          mime_type?: string | null
          raw_text?: string | null
          source: Database["public"]["Enums"]["document_source"]
          source_id?: string | null
          source_url?: string | null
          title: string
          updated_at?: string
          uploaded_by?: string | null
          word_count?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json | null
          mime_type?: string | null
          raw_text?: string | null
          source?: Database["public"]["Enums"]["document_source"]
          source_id?: string | null
          source_url?: string | null
          title?: string
          updated_at?: string
          uploaded_by?: string | null
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      document_source: "onedrive" | "pdf_upload" | "manual"
      enrollment_status: "active" | "completed" | "paused" | "cancelled"
      followup_step_type: "task" | "email" | "call_log" | "stalled_alert"
      user_role: "rep" | "admin" | "manager" | "owner"
      voice_capture_status: "pending" | "processing" | "synced" | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
