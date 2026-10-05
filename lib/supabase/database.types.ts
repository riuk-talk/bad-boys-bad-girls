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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      admin_users: {
        Row: {
          created_at: string
          note: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          note?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          note?: string | null
          user_id?: string
        }
        Relationships: []
      }
      answers: {
        Row: {
          accepted_option_ids: number[] | null
          importance: Database["public"]["Enums"]["importance"]
          option_id: number
          question_id: number
          updated_at: string
          user_id: string
        }
        Insert: {
          accepted_option_ids?: number[] | null
          importance?: Database["public"]["Enums"]["importance"]
          option_id: number
          question_id: number
          updated_at?: string
          user_id: string
        }
        Update: {
          accepted_option_ids?: number[] | null
          importance?: Database["public"]["Enums"]["importance"]
          option_id?: number
          question_id?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answers_question_id_option_id_fkey"
            columns: ["question_id", "option_id"]
            isOneToOne: false
            referencedRelation: "question_options"
            referencedColumns: ["question_id", "id"]
          },
          {
            foreignKeyName: "answers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          ban_hash_retention_months: number
          egress_alert_gb: number
          email_auth_reserve: number
          email_daily_quota: number
          id: boolean
          launch_mode: Database["public"]["Enums"]["launch_mode"]
          promenade_max_appearances_per_day: number
          storage_alert_mb: number
          updated_at: string
          zone_bad_active_days: number
        }
        Insert: {
          ban_hash_retention_months?: number
          egress_alert_gb?: number
          email_auth_reserve?: number
          email_daily_quota?: number
          id?: boolean
          launch_mode?: Database["public"]["Enums"]["launch_mode"]
          promenade_max_appearances_per_day?: number
          storage_alert_mb?: number
          updated_at?: string
          zone_bad_active_days?: number
        }
        Update: {
          ban_hash_retention_months?: number
          egress_alert_gb?: number
          email_auth_reserve?: number
          email_daily_quota?: number
          id?: boolean
          launch_mode?: Database["public"]["Enums"]["launch_mode"]
          promenade_max_appearances_per_day?: number
          storage_alert_mb?: number
          updated_at?: string
          zone_bad_active_days?: number
        }
        Relationships: []
      }
      banned_email_hashes: {
        Row: {
          banned_at: string
          expires_at: string
          hash: string
        }
        Insert: {
          banned_at?: string
          expires_at: string
          hash: string
        }
        Update: {
          banned_at?: string
          expires_at?: string
          hash?: string
        }
        Relationships: []
      }
      casier_charges: {
        Row: {
          charge_1: string
          charge_2: string
          charge_3: string
          profile_id: string
          true_index: number
          updated_at: string
        }
        Insert: {
          charge_1: string
          charge_2: string
          charge_3: string
          profile_id: string
          true_index: number
          updated_at?: string
        }
        Update: {
          charge_1?: string
          charge_2?: string
          charge_3?: string
          profile_id?: string
          true_index?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "casier_charges_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consents: {
        Row: {
          created_at: string
          granted: boolean
          id: number
          ip_truncated: unknown
          text_version: string
          type: Database["public"]["Enums"]["consent_type"]
          user_id: string
        }
        Insert: {
          created_at?: string
          granted: boolean
          id?: never
          ip_truncated?: unknown
          text_version: string
          type: Database["public"]["Enums"]["consent_type"]
          user_id: string
        }
        Update: {
          created_at?: string
          granted?: boolean
          id?: never
          ip_truncated?: unknown
          text_version?: string
          type?: Database["public"]["Enums"]["consent_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_outbox: {
        Row: {
          attempts: number
          created_at: string
          id: number
          kind: Database["public"]["Enums"]["email_kind"]
          not_before: string
          payload: Json
          priority: number
          sent_at: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: never
          kind: Database["public"]["Enums"]["email_kind"]
          not_before?: string
          payload?: Json
          priority?: number
          sent_at?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: never
          kind?: Database["public"]["Enums"]["email_kind"]
          not_before?: string
          payload?: Json
          priority?: number
          sent_at?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_outbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      flagged_texts: {
        Row: {
          created_at: string
          excerpt: string
          id: number
          matched_terms: string[]
          source: Database["public"]["Enums"]["flag_source"]
          source_id: string | null
          status: Database["public"]["Enums"]["report_status"]
          user_id: string | null
        }
        Insert: {
          created_at?: string
          excerpt: string
          id?: never
          matched_terms: string[]
          source: Database["public"]["Enums"]["flag_source"]
          source_id?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          user_id?: string | null
        }
        Update: {
          created_at?: string
          excerpt?: string
          id?: never
          matched_terms?: string[]
          source?: Database["public"]["Enums"]["flag_source"]
          source_id?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flagged_texts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_zones: {
        Row: {
          auto_open: boolean
          center_place_id: number
          created_at: string
          id: number
          name: string
          opened_at: string | null
          radius_km: number
          ready_at: string | null
          slug: string
          status: Database["public"]["Enums"]["zone_status"]
          threshold_bads: number
          threshold_men_pct: number
          threshold_women_pct: number
          timezone: string
        }
        Insert: {
          auto_open?: boolean
          center_place_id: number
          created_at?: string
          id?: never
          name: string
          opened_at?: string | null
          radius_km: number
          ready_at?: string | null
          slug: string
          status?: Database["public"]["Enums"]["zone_status"]
          threshold_bads?: number
          threshold_men_pct?: number
          threshold_women_pct?: number
          timezone?: string
        }
        Update: {
          auto_open?: boolean
          center_place_id?: number
          created_at?: string
          id?: never
          name?: string
          opened_at?: string | null
          radius_km?: number
          ready_at?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["zone_status"]
          threshold_bads?: number
          threshold_men_pct?: number
          threshold_women_pct?: number
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_zones_center_place_id_fkey"
            columns: ["center_place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_keywords: {
        Row: {
          category: Database["public"]["Enums"]["report_category"]
          id: number
          is_active: boolean
          lang: string
          term: string
        }
        Insert: {
          category: Database["public"]["Enums"]["report_category"]
          id?: never
          is_active?: boolean
          lang: string
          term: string
        }
        Update: {
          category?: Database["public"]["Enums"]["report_category"]
          id?: never
          is_active?: boolean
          lang?: string
          term?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          email_date_accepted: boolean
          email_dormant: boolean
          email_permit_granted: boolean
          email_request_digest: boolean
          email_visit_reminder: boolean
          email_weekly: boolean
          email_zone_opened: boolean
          push_messages: boolean
          push_promenade: boolean
          push_prompt_declined_at: string | null
          push_requests: boolean
          push_visits: boolean
          unsubscribe_token: string
          user_id: string
        }
        Insert: {
          email_date_accepted?: boolean
          email_dormant?: boolean
          email_permit_granted?: boolean
          email_request_digest?: boolean
          email_visit_reminder?: boolean
          email_weekly?: boolean
          email_zone_opened?: boolean
          push_messages?: boolean
          push_promenade?: boolean
          push_prompt_declined_at?: string | null
          push_requests?: boolean
          push_visits?: boolean
          unsubscribe_token?: string
          user_id: string
        }
        Update: {
          email_date_accepted?: boolean
          email_dormant?: boolean
          email_permit_granted?: boolean
          email_request_digest?: boolean
          email_visit_reminder?: boolean
          email_weekly?: boolean
          email_zone_opened?: boolean
          push_messages?: boolean
          push_promenade?: boolean
          push_prompt_declined_at?: string | null
          push_requests?: boolean
          push_visits?: boolean
          unsubscribe_token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      photos: {
        Row: {
          created_at: string
          height: number | null
          id: string
          owner_id: string
          pending_path: string | null
          position: number
          public_path_large: string | null
          public_path_small: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["moderation_status"]
          width: number | null
        }
        Insert: {
          created_at?: string
          height?: number | null
          id?: string
          owner_id: string
          pending_path?: string | null
          position: number
          public_path_large?: string | null
          public_path_small?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["moderation_status"]
          width?: number | null
        }
        Update: {
          created_at?: string
          height?: number | null
          id?: string
          owner_id?: string
          pending_path?: string | null
          position?: number
          public_path_large?: string | null
          public_path_small?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["moderation_status"]
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "photos_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      places: {
        Row: {
          country_code: string
          id: number
          lat: number
          lng: number
          name: string
          name_search: string | null
          official_code: string
          population: number | null
          postal_codes: string[]
        }
        Insert: {
          country_code?: string
          id?: never
          lat: number
          lng: number
          name: string
          name_search?: string | null
          official_code: string
          population?: number | null
          postal_codes?: string[]
        }
        Update: {
          country_code?: string
          id?: never
          lat?: number
          lng?: number
          name?: string
          name_search?: string | null
          official_code?: string
          population?: number | null
          postal_codes?: string[]
        }
        Relationships: []
      }
      profile_tribes: {
        Row: {
          detail: string | null
          profile_id: string
          tribe_id: number
        }
        Insert: {
          detail?: string | null
          profile_id: string
          tribe_id: number
        }
        Update: {
          detail?: string | null
          profile_id?: string
          tribe_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "profile_tribes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_tribes_tribe_id_fkey"
            columns: ["tribe_id"]
            isOneToOne: false
            referencedRelation: "tribes"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          banned_at: string | null
          bio: string | null
          birthdate: string | null
          casier_updated_at: string | null
          consecutive_dismissals: number
          created_at: string
          dormant_since: string | null
          gender: Database["public"]["Enums"]["gender"] | null
          hidden_reason: string | null
          id: string
          is_paused: boolean
          is_reglo: boolean
          is_seed: boolean
          last_seen_at: string | null
          lat: number | null
          lng: number | null
          moderation_status: Database["public"]["Enums"]["moderation_status"]
          onboarding_completed_at: string | null
          onboarding_step: number
          paused_at: string | null
          pending_requests_count: number
          place_id: number | null
          pseudo: string | null
          referral_code: string
          referred_by: string | null
          requests_cap: number
          requests_closed_manual: boolean
          requests_open: boolean
          role: Database["public"]["Enums"]["member_role"] | null
          role_changed_at: string | null
          seek_age_max: number
          seek_age_min: number
          seeking_genders: Database["public"]["Enums"]["gender"][]
          suspended_until: string | null
          updated_at: string
          visit_motive: string | null
          zone_id: number | null
        }
        Insert: {
          banned_at?: string | null
          bio?: string | null
          birthdate?: string | null
          casier_updated_at?: string | null
          consecutive_dismissals?: number
          created_at?: string
          dormant_since?: string | null
          gender?: Database["public"]["Enums"]["gender"] | null
          hidden_reason?: string | null
          id: string
          is_paused?: boolean
          is_reglo?: boolean
          is_seed?: boolean
          last_seen_at?: string | null
          lat?: number | null
          lng?: number | null
          moderation_status?: Database["public"]["Enums"]["moderation_status"]
          onboarding_completed_at?: string | null
          onboarding_step?: number
          paused_at?: string | null
          pending_requests_count?: number
          place_id?: number | null
          pseudo?: string | null
          referral_code?: string
          referred_by?: string | null
          requests_cap?: number
          requests_closed_manual?: boolean
          requests_open?: boolean
          role?: Database["public"]["Enums"]["member_role"] | null
          role_changed_at?: string | null
          seek_age_max?: number
          seek_age_min?: number
          seeking_genders?: Database["public"]["Enums"]["gender"][]
          suspended_until?: string | null
          updated_at?: string
          visit_motive?: string | null
          zone_id?: number | null
        }
        Update: {
          banned_at?: string | null
          bio?: string | null
          birthdate?: string | null
          casier_updated_at?: string | null
          consecutive_dismissals?: number
          created_at?: string
          dormant_since?: string | null
          gender?: Database["public"]["Enums"]["gender"] | null
          hidden_reason?: string | null
          id?: string
          is_paused?: boolean
          is_reglo?: boolean
          is_seed?: boolean
          last_seen_at?: string | null
          lat?: number | null
          lng?: number | null
          moderation_status?: Database["public"]["Enums"]["moderation_status"]
          onboarding_completed_at?: string | null
          onboarding_step?: number
          paused_at?: string | null
          pending_requests_count?: number
          place_id?: number | null
          pseudo?: string | null
          referral_code?: string
          referred_by?: string | null
          requests_cap?: number
          requests_closed_manual?: boolean
          requests_open?: boolean
          role?: Database["public"]["Enums"]["member_role"] | null
          role_changed_at?: string | null
          seek_age_max?: number
          seek_age_min?: number
          seeking_genders?: Database["public"]["Enums"]["gender"][]
          suspended_until?: string | null
          updated_at?: string
          visit_motive?: string | null
          zone_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "launch_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      question_options: {
        Row: {
          id: number
          label: Json
          position: number
          question_id: number
        }
        Insert: {
          id: number
          label: Json
          position: number
          question_id: number
        }
        Update: {
          id?: number
          label?: Json
          position?: number
          question_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "question_options_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          created_at: string
          id: number
          is_active: boolean
          label: Json
          phase: Database["public"]["Enums"]["question_phase"]
          position: number
        }
        Insert: {
          created_at?: string
          id: number
          is_active?: boolean
          label: Json
          phase: Database["public"]["Enums"]["question_phase"]
          position: number
        }
        Update: {
          created_at?: string
          id?: number
          is_active?: boolean
          label?: Json
          phase?: Database["public"]["Enums"]["question_phase"]
          position?: number
        }
        Relationships: []
      }
      tribes: {
        Row: {
          id: number
          is_active: boolean
          label: Json
          slug: string
          sort: number
        }
        Insert: {
          id?: never
          is_active?: boolean
          label: Json
          slug: string
          sort?: number
        }
        Update: {
          id?: never
          is_active?: boolean
          label?: Json
          slug?: string
          sort?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      age_years: { Args: { at?: string; birthdate: string }; Returns: number }
      ban_email_hash: { Args: { p_email: string }; Returns: string }
      claim_referral: { Args: { p_code: string }; Returns: boolean }
      common_points: {
        Args: { p_a: string; p_b: string; p_n?: number }
        Returns: {
          answer: Json
          question: Json
          question_id: number
        }[]
      }
      complete_onboarding: { Args: never; Returns: undefined }
      complicity_score: {
        Args: { p_a: string; p_b: string }
        Returns: {
          capped: boolean
          common_count: number
          score: number
        }[]
      }
      counts_for_zone: {
        Args: { p: Database["public"]["Tables"]["profiles"]["Row"] }
        Returns: boolean
      }
      flag_keywords: {
        Args: {
          p_source: Database["public"]["Enums"]["flag_source"]
          p_source_id: string
          p_text: string
          p_user: string
        }
        Returns: undefined
      }
      has_contacts: { Args: { value: string }; Returns: boolean }
      hook_before_user_created: { Args: { event: Json }; Returns: Json }
      immutable_unaccent: { Args: { value: string }; Returns: string }
      importance_weight: {
        Args: { value: Database["public"]["Enums"]["importance"] }
        Returns: number
      }
      is_admin: { Args: never; Returns: boolean }
      mask_contacts: { Args: { value: string }; Returns: string }
      new_referral_code: { Args: never; Returns: string }
      normalize_text: { Args: { value: string }; Returns: string }
      recompute_profile_zones: { Args: never; Returns: number }
      referral_count: { Args: never; Returns: number }
      search_places: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          id: number
          name: string
          official_code: string
          postal_codes: string[]
        }[]
      }
      set_onboarding_role: {
        Args: { p_role: Database["public"]["Enums"]["member_role"] }
        Returns: undefined
      }
      touch_activity: { Args: never; Returns: undefined }
      zone_for: { Args: { p_lat: number; p_lng: number }; Returns: number }
      zone_progress: {
        Args: never
        Returns: {
          bad_boys: number
          bad_girls: number
          bads: number
          launch_mode: Database["public"]["Enums"]["launch_mode"]
          min_bad_boys: number
          min_bad_girls: number
          ready: boolean
          status: Database["public"]["Enums"]["zone_status"]
          threshold_bads: number
          visitors_waiting: number
          zone_id: number
          zone_name: string
        }[]
      }
    }
    Enums: {
      consent_type: "terms" | "privacy" | "age_18" | "art9_seeking"
      email_kind:
        | "request_digest"
        | "date_accepted"
        | "zone_opened"
        | "profile_dormant"
        | "weekly_digest"
        | "moderation_decision"
        | "onboarding_reminder"
        | "admin_photos_pending"
        | "visit_reminder"
        | "permit_granted"
        | "admin_zone_ready"
      flag_source:
        | "pseudo"
        | "bio"
        | "visit_motive"
        | "casier"
        | "tribe_detail"
        | "visit_request"
        | "message"
        | "date_venue"
      gender: "man" | "woman" | "non_binary" | "other"
      importance: "low" | "important" | "essential"
      launch_mode: "zones" | "open"
      member_role: "bad" | "visitor"
      moderation_status: "pending" | "approved" | "rejected"
      question_phase: "core" | "extra"
      report_category:
        | "fake_profile"
        | "minor"
        | "harassment"
        | "sexual_content"
        | "violence_threat"
        | "scam"
        | "other"
      report_status: "open" | "upheld" | "rejected"
      zone_status: "waitlist" | "open"
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
      consent_type: ["terms", "privacy", "age_18", "art9_seeking"],
      email_kind: [
        "request_digest",
        "date_accepted",
        "zone_opened",
        "profile_dormant",
        "weekly_digest",
        "moderation_decision",
        "onboarding_reminder",
        "admin_photos_pending",
        "visit_reminder",
        "permit_granted",
        "admin_zone_ready",
      ],
      flag_source: [
        "pseudo",
        "bio",
        "visit_motive",
        "casier",
        "tribe_detail",
        "visit_request",
        "message",
        "date_venue",
      ],
      gender: ["man", "woman", "non_binary", "other"],
      importance: ["low", "important", "essential"],
      launch_mode: ["zones", "open"],
      member_role: ["bad", "visitor"],
      moderation_status: ["pending", "approved", "rejected"],
      question_phase: ["core", "extra"],
      report_category: [
        "fake_profile",
        "minor",
        "harassment",
        "sexual_content",
        "violence_threat",
        "scam",
        "other",
      ],
      report_status: ["open", "upheld", "rejected"],
      zone_status: ["waitlist", "open"],
    },
  },
} as const
