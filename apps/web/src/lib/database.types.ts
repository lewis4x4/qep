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

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          email: string | null;
          role: UserRole;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["profiles"]["Row"], "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
      };
      documents: {
        Row: {
          id: string;
          title: string;
          source: DocumentSource;
          source_id: string | null;
          source_url: string | null;
          mime_type: string | null;
          raw_text: string | null;
          metadata: Record<string, unknown>;
          word_count: number | null;
          is_active: boolean;
          uploaded_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["documents"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["documents"]["Insert"]>;
      };
      chunks: {
        Row: {
          id: string;
          document_id: string;
          chunk_index: number;
          content: string;
          token_count: number | null;
          embedding: number[] | null;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["chunks"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["chunks"]["Insert"]>;
      };
      onedrive_sync_state: {
        Row: {
          id: string;
          user_id: string | null;
          drive_id: string | null;
          delta_token: string | null;
          access_token_encrypted: string | null;
          refresh_token_encrypted: string | null;
          token_expires_at: string | null;
          last_synced_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["onedrive_sync_state"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["onedrive_sync_state"]["Insert"]>;
      };
      voice_captures: {
        Row: {
          id: string;
          user_id: string;
          audio_storage_path: string | null;
          duration_seconds: number | null;
          transcript: string | null;
          extracted_data: ExtractedDealData;
          hubspot_deal_id: string | null;
          hubspot_contact_id: string | null;
          hubspot_note_id: string | null;
          hubspot_task_id: string | null;
          hubspot_synced_at: string | null;
          sync_status: VoiceCaptureStatus;
          sync_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["voice_captures"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["voice_captures"]["Insert"]>;
      };
    };
    Functions: {
      search_chunks: {
        Args: {
          query_embedding: number[];
          match_threshold?: number;
          match_count?: number;
        };
        Returns: {
          id: string;
          document_id: string;
          document_title: string;
          content: string;
          metadata: Record<string, unknown>;
          similarity: number;
        }[];
      };
    };
  };
}
