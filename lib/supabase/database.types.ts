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
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          unblocked_at: string | null
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          unblocked_at?: string | null
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          unblocked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      moderation_actions: {
        Row: {
          action: Database["public"]["Enums"]["moderation_action_type"]
          admin_id: string | null
          created_at: string
          id: number
          reason: string | null
          report_id: number | null
          target_user_id: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["moderation_action_type"]
          admin_id?: string | null
          created_at?: string
          id?: never
          reason?: string | null
          report_id?: number | null
          target_user_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["moderation_action_type"]
          admin_id?: string | null
          created_at?: string
          id?: never
          reason?: string | null
          report_id?: number | null
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "moderation_actions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_actions_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      notifications: {
        Row: {
          created_at: string
          id: number
          payload: Json
          read_at: string | null
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          payload?: Json
          read_at?: string | null
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          payload?: Json
          read_at?: string | null
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
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
          ecrou: string | null
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
          ecrou?: string | null
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
          ecrou?: string | null
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
      promenade_picks: {
        Row: {
          bad_id: string
          id: number
          promenade_date: string
          rank: number
          score: number
          seen_at: string | null
          visible_from: string
          visible_until: string
          visitor_id: string
          zone_id: number | null
        }
        Insert: {
          bad_id: string
          id?: never
          promenade_date: string
          rank: number
          score: number
          seen_at?: string | null
          visible_from: string
          visible_until: string
          visitor_id: string
          zone_id?: number | null
        }
        Update: {
          bad_id?: string
          id?: never
          promenade_date?: string
          rank?: number
          score?: number
          seen_at?: string | null
          visible_from?: string
          visible_until?: string
          visitor_id?: string
          zone_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "promenade_picks_bad_id_fkey"
            columns: ["bad_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promenade_picks_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promenade_picks_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "launch_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      push_outbox: {
        Row: {
          attempts: number
          created_at: string
          dedupe_key: string
          id: number
          not_before: string
          payload: Json
          sent_at: string | null
          status: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          dedupe_key: string
          id?: never
          not_before?: string
          payload?: Json
          sent_at?: string | null
          status?: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          dedupe_key?: string
          id?: never
          not_before?: string
          payload?: Json
          sent_at?: string | null
          status?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_outbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string | null
          created_at: string
          endpoint: string | null
          failure_count: number
          id: string
          last_success_at: string | null
          locale: string
          p256dh: string | null
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          auth?: string | null
          created_at?: string
          endpoint?: string | null
          failure_count?: number
          id?: string
          last_success_at?: string | null
          locale?: string
          p256dh?: string | null
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          auth?: string | null
          created_at?: string
          endpoint?: string | null
          failure_count?: number
          id?: string
          last_success_at?: string | null
          locale?: string
          p256dh?: string | null
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      reports: {
        Row: {
          category: Database["public"]["Enums"]["report_category"]
          comment: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: number
          reporter_id: string | null
          status: Database["public"]["Enums"]["report_status"]
          target_id: string
          target_type: Database["public"]["Enums"]["report_target"]
          target_user_id: string | null
        }
        Insert: {
          category: Database["public"]["Enums"]["report_category"]
          comment?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: never
          reporter_id?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_id: string
          target_type: Database["public"]["Enums"]["report_target"]
          target_user_id?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["report_category"]
          comment?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: never
          reporter_id?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_id?: string
          target_type?: Database["public"]["Enums"]["report_target"]
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      super_admins: {
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
      visit_requests: {
        Row: {
          bad_id: string
          casier_snapshot: Json
          choose_deadline: string | null
          close_reason: Database["public"]["Enums"]["case_close_reason"] | null
          closed_at: string | null
          conversation_id: string | null
          created_at: string
          decided_at: string | null
          guess_correct: boolean
          guessed_index: number
          id: string
          no_show_count: number
          note: string | null
          note_normalized: string | null
          repropose_deadline: string | null
          slots_declined: boolean
          slots_round: number
          status: Database["public"]["Enums"]["visit_request_status"]
          visitor_id: string
        }
        Insert: {
          bad_id: string
          casier_snapshot: Json
          choose_deadline?: string | null
          close_reason?: Database["public"]["Enums"]["case_close_reason"] | null
          closed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          decided_at?: string | null
          guess_correct: boolean
          guessed_index: number
          id?: string
          no_show_count?: number
          note?: string | null
          note_normalized?: string | null
          repropose_deadline?: string | null
          slots_declined?: boolean
          slots_round?: number
          status?: Database["public"]["Enums"]["visit_request_status"]
          visitor_id: string
        }
        Update: {
          bad_id?: string
          casier_snapshot?: Json
          choose_deadline?: string | null
          close_reason?: Database["public"]["Enums"]["case_close_reason"] | null
          closed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          decided_at?: string | null
          guess_correct?: boolean
          guessed_index?: number
          id?: string
          no_show_count?: number
          note?: string | null
          note_normalized?: string | null
          repropose_deadline?: string | null
          slots_declined?: boolean
          slots_round?: number
          status?: Database["public"]["Enums"]["visit_request_status"]
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_requests_bad_id_fkey"
            columns: ["bad_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_requests_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_slots: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          request_id: string
          round: number
          starts_at: string
          status: Database["public"]["Enums"]["slot_status"]
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          request_id: string
          round: number
          starts_at: string
          status?: Database["public"]["Enums"]["slot_status"]
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          request_id?: string
          round?: number
          starts_at?: string
          status?: Database["public"]["Enums"]["slot_status"]
        }
        Relationships: [
          {
            foreignKeyName: "visit_slots_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "visit_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      visits: {
        Row: {
          bad_id: string
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_late: boolean
          created_at: string
          ends_at: string
          id: string
          reminder_sent_at: string | null
          request_id: string
          slot_id: string
          start_notified_at: string | null
          starts_at: string
          status: Database["public"]["Enums"]["visit_status"]
          visitor_id: string
        }
        Insert: {
          bad_id: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_late?: boolean
          created_at?: string
          ends_at: string
          id?: string
          reminder_sent_at?: string | null
          request_id: string
          slot_id: string
          start_notified_at?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["visit_status"]
          visitor_id: string
        }
        Update: {
          bad_id?: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_late?: boolean
          created_at?: string
          ends_at?: string
          id?: string
          reminder_sent_at?: string | null
          request_id?: string
          slot_id?: string
          start_notified_at?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["visit_status"]
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visits_bad_id_fkey"
            columns: ["bad_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "visit_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "visit_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_visitor_id_fkey"
            columns: ["visitor_id"]
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
      accept_visit_request: {
        Args: { p_request: string; p_slots: string[] }
        Returns: undefined
      }
      admin_decide_photo: {
        Args: {
          p_approve: boolean
          p_photo: string
          p_public_large?: string
          p_public_small?: string
          p_reason?: string
        }
        Returns: string
      }
      admin_photo_queue: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          gender: Database["public"]["Enums"]["gender"]
          owner_id: string
          pending_path: string
          photo_id: string
          photo_position: number
          priority: number
          pseudo: string
          role: Database["public"]["Enums"]["member_role"]
        }[]
      }
      age_years: { Args: { at?: string; birthdate: string }; Returns: number }
      ban_email_hash: { Args: { p_email: string }; Returns: string }
      block_user: { Args: { p_target: string }; Returns: undefined }
      build_daily_promenade: {
        Args: { p_date: string; p_zone: number }
        Returns: number
      }
      can_report: {
        Args: { p_reporter: string; p_target: string }
        Returns: boolean
      }
      can_view_bad: {
        Args: { p_bad: string; p_viewer: string }
        Returns: boolean
      }
      cancel_visit: { Args: { p_visit: string }; Returns: undefined }
      change_role: {
        Args: { p_role: Database["public"]["Enums"]["member_role"] }
        Returns: undefined
      }
      charge_key: { Args: { value: string }; Returns: string }
      checked_slots: {
        Args: { p_bad: string; p_slots: string[] }
        Returns: string[]
      }
      choose_slot: { Args: { p_slot: string }; Returns: string }
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
      complicity_from_sums: {
        Args: {
          cap: boolean
          cnt: number
          d_a: number
          d_b: number
          n_a: number
          n_b: number
        }
        Returns: number
      }
      complicity_score: {
        Args: { p_a: string; p_b: string }
        Returns: {
          capped: boolean
          common_count: number
          score: number
        }[]
      }
      complicity_with: {
        Args: { p_others: string[]; p_viewer: string }
        Returns: {
          other_id: string
          score: number
        }[]
      }
      counts_for_zone: {
        Args: { p: Database["public"]["Tables"]["profiles"]["Row"] }
        Returns: boolean
      }
      criteria_match: {
        Args: {
          p_a: Database["public"]["Tables"]["profiles"]["Row"]
          p_b: Database["public"]["Tables"]["profiles"]["Row"]
        }
        Returns: boolean
      }
      decide_visit_request: {
        Args: { p_accept: boolean; p_request: string }
        Returns: undefined
      }
      decline_slots: { Args: { p_request: string }; Returns: undefined }
      discover_bads: {
        Args: {
          p_age_max?: number
          p_age_min?: number
          p_cursor_id?: string
          p_cursor_key?: number
          p_good_conduct_only?: boolean
          p_limit?: number
          p_max_km?: number
          p_recently_active?: boolean
          p_tribe_ids?: number[]
        }
        Returns: {
          age: number
          city: string
          complicity: number
          distance_km: number
          gender: Database["public"]["Enums"]["gender"]
          good_conduct: boolean
          id: string
          photo_small: string
          pseudo: string
          requests_open: boolean
          sort_key: number
        }[]
      }
      distance_km: {
        Args: {
          p_a: Database["public"]["Tables"]["profiles"]["Row"]
          p_b: Database["public"]["Tables"]["profiles"]["Row"]
        }
        Returns: number
      }
      expire_visit_requests: { Args: never; Returns: number }
      flag_keywords: {
        Args: {
          p_source: Database["public"]["Enums"]["flag_source"]
          p_source_id: string
          p_text: string
          p_user: string
        }
        Returns: undefined
      }
      get_fiche: { Args: { p_bad: string }; Returns: Json }
      get_mailbox: {
        Args: never
        Returns: {
          age: number
          city: string
          clean_record: boolean
          complicity: number
          created_at: string
          distance_km: number
          gender: Database["public"]["Enums"]["gender"]
          motive: string
          note: string
          photo_small: string
          pseudo: string
          request_id: string
          status: Database["public"]["Enums"]["visit_request_status"]
          visitor_id: string
          visits_due: number
          visits_honored: number
        }[]
      }
      get_my_blocks: {
        Args: never
        Returns: {
          blocked_at: string
          blocked_id: string
          pseudo: string
        }[]
      }
      get_my_promenade: {
        Args: never
        Returns: {
          age: number
          city: string
          complicity: number
          distance_km: number
          gender: Database["public"]["Enums"]["gender"]
          good_conduct: boolean
          id: string
          photo_small: string
          pseudo: string
          rank: number
          requests_open: boolean
          seen: boolean
          visible_until: string
        }[]
      }
      get_my_requests: {
        Args: never
        Returns: {
          bad_id: string
          cooldown_until: string
          created_at: string
          decided_at: string
          gender: Database["public"]["Enums"]["gender"]
          photo_small: string
          pseudo: string
          request_id: string
          status: Database["public"]["Enums"]["visit_request_status"]
        }[]
      }
      get_my_visits: {
        Args: never
        Returns: {
          ends_at: string
          i_am_bad: boolean
          other_gender: Database["public"]["Enums"]["gender"]
          other_id: string
          other_photo_small: string
          other_pseudo: string
          request_id: string
          starts_at: string
          status: Database["public"]["Enums"]["visit_status"]
          visit_id: string
        }[]
      }
      get_permit: { Args: { p_visitor: string }; Returns: Json }
      get_request_schedule: { Args: { p_request: string }; Returns: Json }
      has_contacts: { Args: { value: string }; Returns: boolean }
      has_open_relation: {
        Args: { p_a: string; p_b: string }
        Returns: boolean
      }
      has_permit: { Args: { p_visitor: string }; Returns: boolean }
      has_three_poses: {
        Args: { p_approved_only?: boolean; p_owner: string }
        Returns: boolean
      }
      hook_before_user_created: { Args: { event: Json }; Returns: Json }
      immutable_unaccent: { Args: { value: string }; Returns: string }
      importance_weight: {
        Args: { value: Database["public"]["Enums"]["importance"] }
        Returns: number
      }
      insert_slots: {
        Args: { p_request: string; p_round: number; p_slots: string[] }
        Returns: undefined
      }
      is_admin: { Args: never; Returns: boolean }
      is_bad_visible: {
        Args: { p: Database["public"]["Tables"]["profiles"]["Row"] }
        Returns: boolean
      }
      is_blocked_between: {
        Args: { p_a: string; p_b: string }
        Returns: boolean
      }
      is_member_active: {
        Args: { p: Database["public"]["Tables"]["profiles"]["Row"] }
        Returns: boolean
      }
      is_trusted_reporter: { Args: { p_reporter: string }; Returns: boolean }
      mark_notifications_read:
        | { Args: never; Returns: undefined }
        | {
            Args: {
              p_types: Database["public"]["Enums"]["notification_type"][]
            }
            Returns: undefined
          }
      mark_promenade_seen: { Args: { p_bad: string }; Returns: undefined }
      mask_contacts: { Args: { value: string }; Returns: string }
      my_admin_role: { Args: never; Returns: string }
      new_ecrou: { Args: never; Returns: string }
      new_referral_code: { Args: never; Returns: string }
      normalize_text: { Args: { value: string }; Returns: string }
      note_fingerprint: { Args: { p_note: string }; Returns: string }
      notify: {
        Args: {
          p_payload?: Json
          p_type: Database["public"]["Enums"]["notification_type"]
          p_user: string
        }
        Returns: undefined
      }
      pair_cooldown_until: {
        Args: { p_bad: string; p_visitor: string }
        Returns: string
      }
      photo_rejection_reasons: { Args: never; Returns: string[] }
      place_name: { Args: { p_place: number }; Returns: string }
      propose_slots: {
        Args: { p_request: string; p_slots: string[] }
        Returns: undefined
      }
      public_photos: {
        Args: { p_owner: string; p_positions: number[] }
        Returns: Json
      }
      public_tribes: { Args: { p_owner: string }; Returns: Json }
      push_claim: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          id: number
          payload: Json
          subscriptions: Json
          type: Database["public"]["Enums"]["notification_type"]
        }[]
      }
      push_device_count: { Args: never; Returns: number }
      push_dispatch: { Args: never; Returns: boolean }
      push_path: {
        Args: { p_type: Database["public"]["Enums"]["notification_type"] }
        Returns: string
      }
      push_report: { Args: { p_report: Json }; Returns: undefined }
      recompute_profile_zones: { Args: never; Returns: number }
      referral_count: { Args: never; Returns: number }
      report: {
        Args: {
          p_category: Database["public"]["Enums"]["report_category"]
          p_comment?: string
          p_target_id: string
          p_target_type: Database["public"]["Enums"]["report_target"]
        }
        Returns: number
      }
      revoke_push_row: { Args: { p_id: string }; Returns: undefined }
      revoke_push_subscription: {
        Args: { p_endpoint: string }
        Returns: undefined
      }
      run_promenades_due: { Args: never; Returns: undefined }
      run_visit_schedule: { Args: never; Returns: Json }
      save_push_subscription: {
        Args: {
          p_auth: string
          p_endpoint: string
          p_locale?: string
          p_p256dh: string
        }
        Returns: undefined
      }
      search_places: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          id: number
          name: string
          official_code: string
          postal_codes: string[]
        }[]
      }
      send_visit_request: {
        Args: { p_bad: string; p_guessed_index: number; p_note?: string }
        Returns: string
      }
      set_onboarding_role: {
        Args: { p_role: Database["public"]["Enums"]["member_role"] }
        Returns: undefined
      }
      set_push_secret: {
        Args: { p_name: string; p_value: string }
        Returns: undefined
      }
      touch_activity: { Args: never; Returns: undefined }
      unblock_user: { Args: { p_target: string }; Returns: undefined }
      visitor_reputation: {
        Args: { p_visitor: string }
        Returns: {
          clean_record: boolean
          due: number
          honored: number
        }[]
      }
      zone_for: { Args: { p_lat: number; p_lng: number }; Returns: number }
      zone_is_open: { Args: { p_zone: number }; Returns: boolean }
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
      case_close_reason:
        | "dismissed_by_bad"
        | "no_answer_7d"
        | "no_slot_chosen"
        | "no_new_slots"
        | "second_no_show"
        | "not_prolonged"
        | "no_end_choice"
        | "closed_after_release"
        | "cancelled_by_visitor"
        | "role_change"
        | "blocked"
        | "account_deleted"
        | "banned"
        | "second_cancellation"
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
      moderation_action_type:
        | "warn"
        | "suspend"
        | "ban"
        | "unban"
        | "hide_profile"
        | "unhide_profile"
        | "photo_approve"
        | "photo_reject"
        | "text_clear"
        | "text_remove"
        | "revoke_good_conduct"
      moderation_status: "pending" | "approved" | "rejected"
      notification_type:
        | "request_received"
        | "request_accepted"
        | "request_dismissed"
        | "slot_chosen"
        | "slots_declined"
        | "slots_reproposed"
        | "visit_cancelled"
        | "visit_reminder_1h"
        | "visit_starting"
        | "visit_no_show"
        | "visit_released"
        | "visit_closed"
        | "message_received"
        | "date_proposed"
        | "date_accepted"
        | "date_countered"
        | "promenade_open"
        | "permit_granted"
        | "moderation_decision"
        | "zone_opened"
        | "profile_dormant"
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
      report_target:
        | "profile"
        | "permit"
        | "photo"
        | "casier"
        | "message"
        | "visit_request"
      slot_status: "offered" | "chosen" | "declined" | "expired"
      visit_request_status:
        | "pending"
        | "accepted"
        | "released"
        | "dismissed"
        | "auto_dismissed"
        | "cancelled"
        | "closed"
      visit_status:
        | "scheduled"
        | "in_progress"
        | "ended"
        | "cancelled"
        | "no_show"
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
      case_close_reason: [
        "dismissed_by_bad",
        "no_answer_7d",
        "no_slot_chosen",
        "no_new_slots",
        "second_no_show",
        "not_prolonged",
        "no_end_choice",
        "closed_after_release",
        "cancelled_by_visitor",
        "role_change",
        "blocked",
        "account_deleted",
        "banned",
        "second_cancellation",
      ],
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
      moderation_action_type: [
        "warn",
        "suspend",
        "ban",
        "unban",
        "hide_profile",
        "unhide_profile",
        "photo_approve",
        "photo_reject",
        "text_clear",
        "text_remove",
        "revoke_good_conduct",
      ],
      moderation_status: ["pending", "approved", "rejected"],
      notification_type: [
        "request_received",
        "request_accepted",
        "request_dismissed",
        "slot_chosen",
        "slots_declined",
        "slots_reproposed",
        "visit_cancelled",
        "visit_reminder_1h",
        "visit_starting",
        "visit_no_show",
        "visit_released",
        "visit_closed",
        "message_received",
        "date_proposed",
        "date_accepted",
        "date_countered",
        "promenade_open",
        "permit_granted",
        "moderation_decision",
        "zone_opened",
        "profile_dormant",
      ],
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
      report_target: [
        "profile",
        "permit",
        "photo",
        "casier",
        "message",
        "visit_request",
      ],
      slot_status: ["offered", "chosen", "declined", "expired"],
      visit_request_status: [
        "pending",
        "accepted",
        "released",
        "dismissed",
        "auto_dismissed",
        "cancelled",
        "closed",
      ],
      visit_status: [
        "scheduled",
        "in_progress",
        "ended",
        "cancelled",
        "no_show",
      ],
      zone_status: ["waitlist", "open"],
    },
  },
} as const
