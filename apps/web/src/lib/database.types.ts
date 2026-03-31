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
export type SignalConfidence = "high" | "medium" | "low" | "unknown";
export type DecisionMakerStatus =
  | "decision_maker"
  | "influencer"
  | "operator"
  | "gatekeeper"
  | "unknown";
export type PreferredContactChannel =
  | "call"
  | "text"
  | "email"
  | "in_person"
  | "unknown";
export type IntentLevel =
  | "curious"
  | "evaluating"
  | "quote_ready"
  | "demo_ready"
  | "ready_to_buy"
  | "unknown";
export type UrgencyLevel = "low" | "medium" | "high" | "urgent" | "unknown";
export type FinancingInterest =
  | "cash"
  | "finance"
  | "lease"
  | "rental"
  | "rent_to_own"
  | "unknown";
export type ConditionPreference = "new" | "used" | "either" | "unknown";
export type TradeInLikelihood =
  | "none"
  | "possible"
  | "likely"
  | "confirmed"
  | "unknown";
export type BudgetConfidence = "firm" | "soft" | "vague" | "unknown";
export type QuoteReadiness = "not_ready" | "partial" | "ready";
export type AvailabilitySensitivity =
  | "must_have_now"
  | "soon"
  | "flexible"
  | "unknown";
export type OperatorSkillLevel = "new" | "experienced" | "mixed" | "unknown";
export type Sentiment =
  | "positive"
  | "neutral"
  | "cautious"
  | "skeptical"
  | "frustrated"
  | "unknown";
export type ProbabilitySignal = "low" | "medium" | "high" | "unknown";
export type BuyerPersona =
  | "price_first"
  | "uptime_first"
  | "growth_owner"
  | "spec_driven"
  | "rental_first"
  | "unknown";
export type FollowUpMode =
  | "call"
  | "text"
  | "email"
  | "visit"
  | "quote"
  | "demo"
  | "unknown";

export interface ExtractedEvidenceSnippet {
  field: string;
  quote: string;
  confidence?: SignalConfidence | null;
}

export interface ExtractedDealData {
  record: {
    contactName: string | null;
    contactRole: string | null;
    companyName: string | null;
    companyType: string | null;
    decisionMakerStatus: DecisionMakerStatus;
    preferredContactChannel: PreferredContactChannel;
    locationContext: string | null;
    additionalStakeholders: string[];
  };
  opportunity: {
    machineInterest: string | null;
    equipmentCategory: string | null;
    equipmentMake: string | null;
    equipmentModel: string | null;
    attachmentsDiscussed: string[];
    applicationUseCase: string | null;
    dealStage: DealStage | null;
    intentLevel: IntentLevel;
    urgencyLevel: UrgencyLevel;
    timelineToBuy: string | null;
    financingInterest: FinancingInterest;
    newVsUsedPreference: ConditionPreference;
    tradeInLikelihood: TradeInLikelihood;
    budgetRange: string | null;
    budgetConfidence: BudgetConfidence;
    competitorsMentioned: string[];
    keyConcerns: string | null;
    objections: string[];
    quoteReadiness: QuoteReadiness;
    nextStep: string | null;
    nextStepDeadline: string | null;
    actionItems: string[];
    followUpDate: string | null;
  };
  operations: {
    branchRelevance: string | null;
    territorySignal: string | null;
    serviceOpportunity: boolean;
    partsOpportunity: boolean;
    rentalOpportunity: boolean;
    crossSellOpportunity: string[];
    existingFleetContext: string | null;
    replacementTrigger: string | null;
    availabilitySensitivity: AvailabilitySensitivity;
    uptimeSensitivity: ProbabilitySignal;
    jobsiteConditions: string[];
    operatorSkillLevel: OperatorSkillLevel;
  };
  guidance: {
    customerSentiment: Sentiment;
    probabilitySignal: ProbabilitySignal;
    stalledRisk: ProbabilitySignal;
    buyerPersona: BuyerPersona;
    managerAttentionFlag: boolean;
    recommendedNextAction: string | null;
    recommendedFollowUpMode: FollowUpMode;
    summaryForRep: string | null;
    summaryForManager: string | null;
  };
  evidence: {
    snippets: ExtractedEvidenceSnippet[];
    confidence: Record<string, SignalConfidence>;
  };
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
      integration_status: {
        Row: {
          id: string
          integration_key: string
          display_name: string
          status: Database["public"]["Enums"]["integration_status_enum"]
          credentials_encrypted: string | null
          endpoint_url: string | null
          auth_type: string
          sync_frequency: Database["public"]["Enums"]["sync_frequency"]
          last_sync_at: string | null
          last_sync_records: number
          last_sync_error: string | null
          last_test_at: string | null
          last_test_success: boolean | null
          last_test_latency_ms: number | null
          last_test_error: string | null
          config: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          integration_key: string
          display_name: string
          status?: Database["public"]["Enums"]["integration_status_enum"]
          credentials_encrypted?: string | null
          endpoint_url?: string | null
          auth_type?: string
          sync_frequency?: Database["public"]["Enums"]["sync_frequency"]
          last_sync_at?: string | null
          last_sync_records?: number
          last_sync_error?: string | null
          last_test_at?: string | null
          last_test_success?: boolean | null
          last_test_latency_ms?: number | null
          last_test_error?: string | null
          config?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          integration_key?: string
          display_name?: string
          status?: Database["public"]["Enums"]["integration_status_enum"]
          credentials_encrypted?: string | null
          endpoint_url?: string | null
          auth_type?: string
          sync_frequency?: Database["public"]["Enums"]["sync_frequency"]
          last_sync_at?: string | null
          last_sync_records?: number
          last_sync_error?: string | null
          last_test_at?: string | null
          last_test_success?: boolean | null
          last_test_latency_ms?: number | null
          last_test_error?: string | null
          config?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: []
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
        | "integration_config_updated"
        | "integration_connection_tested"
        | "integration_card_clicked"
        | "integration_panel_opened"
      document_source: "onedrive" | "pdf_upload" | "manual"
      enrollment_status: "active" | "completed" | "paused" | "cancelled"
      followup_step_type: "task" | "email" | "call_log" | "stalled_alert"
      user_role: "rep" | "admin" | "manager" | "owner"
      voice_capture_status: "pending" | "processing" | "synced" | "failed"
      integration_status_enum: "connected" | "pending_credentials" | "error" | "demo_mode"
      sync_frequency: "realtime" | "hourly" | "every_6_hours" | "daily" | "weekly" | "manual"
      scenario_type: "max_margin" | "balanced" | "win_the_deal"
      pricing_persona: "value_driven" | "relationship_loyal" | "budget_constrained" | "urgency_buyer"
      outreach_status: "pending" | "approved" | "sent" | "deferred" | "dismissed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
