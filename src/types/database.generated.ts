export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      preference_merge_reviews: {
        Row: {
          created_at: string
          guest_default_servings: number
          guest_measurement_system: Database["public"]["Enums"]["measurement_system"]
          guest_notifications_enabled: boolean
          id: string
          merge_ticket_id: string
          resolved_at: string | null
          used_guest_values: boolean | null
          user_id: string
        }
        Insert: {
          created_at?: string
          guest_default_servings: number
          guest_measurement_system: Database["public"]["Enums"]["measurement_system"]
          guest_notifications_enabled: boolean
          id?: string
          merge_ticket_id: string
          resolved_at?: string | null
          used_guest_values?: boolean | null
          user_id: string
        }
        Update: {
          created_at?: string
          guest_default_servings?: number
          guest_measurement_system?: Database["public"]["Enums"]["measurement_system"]
          guest_notifications_enabled?: boolean
          id?: string
          merge_ticket_id?: string
          resolved_at?: string | null
          used_guest_values?: boolean | null
          user_id?: string
        }
        Relationships: []
      }
      privacy_requests: {
        Row: {
          completed_at: string | null
          correlation_id: string
          id: string
          request_type: Database["public"]["Enums"]["privacy_request_type"]
          requested_at: string
          safe_error_code: string | null
          status: Database["public"]["Enums"]["privacy_request_status"]
          target_completion_at: string
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          correlation_id: string
          id?: string
          request_type: Database["public"]["Enums"]["privacy_request_type"]
          requested_at?: string
          safe_error_code?: string | null
          status?: Database["public"]["Enums"]["privacy_request_status"]
          target_completion_at: string
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          correlation_id?: string
          id?: string
          request_type?: Database["public"]["Enums"]["privacy_request_type"]
          requested_at?: string
          safe_error_code?: string | null
          status?: Database["public"]["Enums"]["privacy_request_status"]
          target_completion_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          locale: string
          onboarding_completed_at: string | null
          onboarding_state: Database["public"]["Enums"]["onboarding_state"]
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          locale?: string
          onboarding_completed_at?: string | null
          onboarding_state?: Database["public"]["Enums"]["onboarding_state"]
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          display_name?: string | null
          locale?: string
          onboarding_completed_at?: string | null
          onboarding_state?: Database["public"]["Enums"]["onboarding_state"]
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      scan_deletions: {
        Row: {
          accepted_at: string
          completed_at: string | null
          id: string
          media_delete_by: string
          owner_id: string | null
          scan_id: string
        }
        Insert: {
          accepted_at?: string
          completed_at?: string | null
          id?: string
          media_delete_by: string
          owner_id?: string | null
          scan_id: string
        }
        Update: {
          accepted_at?: string
          completed_at?: string | null
          id?: string
          media_delete_by?: string
          owner_id?: string | null
          scan_id?: string
        }
        Relationships: []
      }
      scans: {
        Row: {
          assessment: string | null
          confirmed_at: string | null
          confirmed_ingredients: Json | null
          created_at: string
          deleted_at: string | null
          draft_revision: number
          first_uploaded_at: string | null
          id: string
          image_revision: number
          ingredients: Json
          manual_fallback: boolean
          media_expires_at: string | null
          owner_id: string
          safe_error_code: string | null
          sanitization_state: Database["public"]["Enums"]["scan_sanitization_state"]
          source: Database["public"]["Enums"]["scan_source"]
          state: Database["public"]["Enums"]["scan_state"]
          updated_at: string
          version: number
        }
        Insert: {
          assessment?: string | null
          confirmed_at?: string | null
          confirmed_ingredients?: Json | null
          created_at?: string
          deleted_at?: string | null
          draft_revision?: number
          first_uploaded_at?: string | null
          id?: string
          image_revision: number
          ingredients?: Json
          manual_fallback?: boolean
          media_expires_at?: string | null
          owner_id: string
          safe_error_code?: string | null
          sanitization_state?: Database["public"]["Enums"]["scan_sanitization_state"]
          source: Database["public"]["Enums"]["scan_source"]
          state: Database["public"]["Enums"]["scan_state"]
          updated_at?: string
          version?: number
        }
        Update: {
          assessment?: string | null
          confirmed_at?: string | null
          confirmed_ingredients?: Json | null
          created_at?: string
          deleted_at?: string | null
          draft_revision?: number
          first_uploaded_at?: string | null
          id?: string
          image_revision?: number
          ingredients?: Json
          manual_fallback?: boolean
          media_expires_at?: string | null
          owner_id?: string
          safe_error_code?: string | null
          sanitization_state?: Database["public"]["Enums"]["scan_sanitization_state"]
          source?: Database["public"]["Enums"]["scan_source"]
          state?: Database["public"]["Enums"]["scan_state"]
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          created_at: string
          default_servings: number
          measurement_system: Database["public"]["Enums"]["measurement_system"]
          notifications_enabled: boolean
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          default_servings?: number
          measurement_system?: Database["public"]["Enums"]["measurement_system"]
          notifications_enabled?: boolean
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          default_servings?: number
          measurement_system?: Database["public"]["Enums"]["measurement_system"]
          notifications_enabled?: boolean
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      consume_account_merge_ticket: {
        Args: { p_correlation_id: string; p_token_hash: string }
        Returns: {
          merge_ticket_id: string
          preference_review_id: string
          source_user_id: string
        }[]
      }
      create_scan: {
        Args: {
          p_ingredients?: Json
          p_key: string
          p_source: Database["public"]["Enums"]["scan_source"]
        }
        Returns: {
          assessment: string | null
          confirmed_at: string | null
          confirmed_ingredients: Json | null
          created_at: string
          deleted_at: string | null
          draft_revision: number
          first_uploaded_at: string | null
          id: string
          image_revision: number
          ingredients: Json
          manual_fallback: boolean
          media_expires_at: string | null
          owner_id: string
          safe_error_code: string | null
          sanitization_state: Database["public"]["Enums"]["scan_sanitization_state"]
          source: Database["public"]["Enums"]["scan_source"]
          state: Database["public"]["Enums"]["scan_state"]
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "scans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      internal_account_scan_cleanup: {
        Args: { p_request: string }
        Returns: Json
      }
      internal_account_scan_cleanup_ready: {
        Args: { p_request: string }
        Returns: boolean
      }
      internal_complete_account_deletion: {
        Args: {
          p_request_id: string
          p_safe_error_code?: string
          p_success: boolean
        }
        Returns: undefined
      }
      internal_complete_account_merge: {
        Args: {
          p_correlation_id: string
          p_merge_ticket_id: string
          p_target_user_id: string
        }
        Returns: undefined
      }
      internal_mark_account_deletion_processing: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      internal_scan_ack_cleanup: {
        Args: { p_image: string; p_token: string }
        Returns: boolean
      }
      internal_scan_claim_cleanup: { Args: { p_limit?: number }; Returns: Json }
      internal_scan_claim_job: {
        Args: { p_scan: string; p_stage: string }
        Returns: Json
      }
      internal_scan_expire: { Args: { p_scan: string }; Returns: boolean }
      internal_scan_finish_job: {
        Args: { p_body: Json; p_job: string; p_lease: string }
        Returns: boolean
      }
      internal_scan_reconcile_deletions: { Args: never; Returns: number }
      internal_scan_upload: {
        Args: {
          p_body: Json
          p_key: string
          p_operation: string
          p_owner: string
          p_scan: string
        }
        Returns: Json
      }
      issue_account_merge_ticket: {
        Args: { p_expires_at: string; p_token_hash: string }
        Returns: string
      }
      mutate_scan: {
        Args: {
          p_body: Json
          p_key: string
          p_operation: string
          p_scan: string
        }
        Returns: Json
      }
      request_account_deletion: {
        Args: { p_correlation_id: string }
        Returns: string
      }
      resolve_preference_merge: {
        Args: { p_review_id: string; p_use_guest_values: boolean }
        Returns: undefined
      }
    }
    Enums: {
      account_status: "active" | "deletion_pending" | "blocked"
      measurement_system: "metric" | "us"
      onboarding_state: "not_started" | "in_progress" | "completed"
      privacy_request_status: "accepted" | "processing" | "completed" | "failed"
      privacy_request_type: "export" | "delete"
      scan_sanitization_state:
        | "not_started"
        | "pending"
        | "running"
        | "passed"
        | "rejected"
        | "failed"
        | "cancelled"
      scan_source: "camera" | "gallery" | "manual"
      scan_state:
        | "awaiting_upload"
        | "sanitizing"
        | "queued"
        | "recognizing"
        | "needs_confirmation"
        | "confirmed"
        | "failed"
        | "cancelled"
        | "expired"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      account_status: ["active", "deletion_pending", "blocked"],
      measurement_system: ["metric", "us"],
      onboarding_state: ["not_started", "in_progress", "completed"],
      privacy_request_status: ["accepted", "processing", "completed", "failed"],
      privacy_request_type: ["export", "delete"],
      scan_sanitization_state: [
        "not_started",
        "pending",
        "running",
        "passed",
        "rejected",
        "failed",
        "cancelled",
      ],
      scan_source: ["camera", "gallery", "manual"],
      scan_state: [
        "awaiting_upload",
        "sanitizing",
        "queued",
        "recognizing",
        "needs_confirmation",
        "confirmed",
        "failed",
        "cancelled",
        "expired",
      ],
    },
  },
} as const
