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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ai_chat_actions: {
        Row: {
          chat_id: string
          created_at: string
          execution_result: Json | null
          execution_status: string
          id: string
          message_id: string | null
          proposal_json: Json
          proposal_kind: string
          revert_payload: Json | null
        }
        Insert: {
          chat_id: string
          created_at?: string
          execution_result?: Json | null
          execution_status?: string
          id?: string
          message_id?: string | null
          proposal_json: Json
          proposal_kind: string
          revert_payload?: Json | null
        }
        Update: {
          chat_id?: string
          created_at?: string
          execution_result?: Json | null
          execution_status?: string
          id?: string
          message_id?: string | null
          proposal_json?: Json
          proposal_kind?: string
          revert_payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_actions_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "ai_chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_chat_actions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_attachments: {
        Row: {
          chat_id: string
          created_at: string
          file_name: string
          id: string
          message_id: string | null
          mime_type: string
          size_bytes: number
          storage_path: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          file_name: string
          id?: string
          message_id?: string | null
          mime_type: string
          size_bytes: number
          storage_path: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          file_name?: string
          id?: string
          message_id?: string | null
          mime_type?: string
          size_bytes?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_attachments_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "ai_chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_chat_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_messages: {
        Row: {
          chat_id: string
          content: string
          created_at: string
          id: string
          metadata: Json
          role: string
        }
        Insert: {
          chat_id: string
          content?: string
          created_at?: string
          id?: string
          metadata?: Json
          role: string
        }
        Update: {
          chat_id?: string
          content?: string
          created_at?: string
          id?: string
          metadata?: Json
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "ai_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chats: {
        Row: {
          archived_at: string | null
          assistant_rules: string
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          assistant_rules?: string
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          assistant_rules?: string
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          agent_status: string
          approval_mode_override: string | null
          channel_preference: string
          city: string | null
          country: string | null
          created_at: string
          domain: string
          first_seen_at: string
          id: string
          industry: string | null
          last_seen_at: string
          metadata: Json
          name: string | null
          organisation_id: string
          region: string | null
          size_range: string | null
          source: string
          updated_at: string
          visit_count: number
        }
        Insert: {
          agent_status?: string
          approval_mode_override?: string | null
          channel_preference?: string
          city?: string | null
          country?: string | null
          created_at?: string
          domain: string
          first_seen_at?: string
          id?: string
          industry?: string | null
          last_seen_at?: string
          metadata?: Json
          name?: string | null
          organisation_id: string
          region?: string | null
          size_range?: string | null
          source?: string
          updated_at?: string
          visit_count?: number
        }
        Update: {
          agent_status?: string
          approval_mode_override?: string | null
          channel_preference?: string
          city?: string | null
          country?: string | null
          created_at?: string
          domain?: string
          first_seen_at?: string
          id?: string
          industry?: string | null
          last_seen_at?: string
          metadata?: Json
          name?: string | null
          organisation_id?: string
          region?: string | null
          size_range?: string | null
          source?: string
          updated_at?: string
          visit_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "companies_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          company_id: string
          created_at: string
          do_not_contact: boolean
          email: string | null
          email_verified: boolean
          first_name: string | null
          full_name: string | null
          id: string
          is_primary: boolean
          last_name: string | null
          linkedin_url: string | null
          metadata: Json
          organisation_id: string
          phone: string | null
          score: number | null
          seniority: string | null
          source: string
          title: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          do_not_contact?: boolean
          email?: string | null
          email_verified?: boolean
          first_name?: string | null
          full_name?: string | null
          id?: string
          is_primary?: boolean
          last_name?: string | null
          linkedin_url?: string | null
          metadata?: Json
          organisation_id: string
          phone?: string | null
          score?: number | null
          seniority?: string | null
          source?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          do_not_contact?: boolean
          email?: string | null
          email_verified?: boolean
          first_name?: string | null
          full_name?: string | null
          id?: string
          is_primary?: boolean
          last_name?: string | null
          linkedin_url?: string | null
          metadata?: Json
          organisation_id?: string
          phone?: string | null
          score?: number | null
          seniority?: string | null
          source?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_raw_events: {
        Row: {
          body_json: Json | null
          body_raw: string | null
          headers: Json
          http_method: string | null
          id: string
          integration_id: string | null
          match_status: string
          organisation_id: string | null
          path: string | null
          processed_at: string | null
          provider: string
          query: Json
          received_at: string
          signature_header: string | null
          source_ip: string | null
        }
        Insert: {
          body_json?: Json | null
          body_raw?: string | null
          headers?: Json
          http_method?: string | null
          id?: string
          integration_id?: string | null
          match_status: string
          organisation_id?: string | null
          path?: string | null
          processed_at?: string | null
          provider: string
          query?: Json
          received_at?: string
          signature_header?: string | null
          source_ip?: string | null
        }
        Update: {
          body_json?: Json | null
          body_raw?: string | null
          headers?: Json
          http_method?: string | null
          id?: string
          integration_id?: string | null
          match_status?: string
          organisation_id?: string | null
          path?: string | null
          processed_at?: string | null
          provider?: string
          query?: Json
          received_at?: string
          signature_header?: string | null
          source_ip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_raw_events_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "org_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_raw_events_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          dedupe_key: string | null
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          organisation_id: string | null
          payload: Json
          result: Json | null
          run_after: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          kind: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          organisation_id?: string | null
          payload?: Json
          result?: Json | null
          run_after?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          organisation_id?: string | null
          payload?: Json
          result?: Json | null
          run_after?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_integrations: {
        Row: {
          config: Json
          created_at: string
          created_by_user_id: string
          id: string
          organisation_id: string
          provider: string
          secrets: Json
          status: string
          updated_at: string
          webhook_token: string | null
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by_user_id: string
          id?: string
          organisation_id: string
          provider: string
          secrets?: Json
          status?: string
          updated_at?: string
          webhook_token?: string | null
        }
        Update: {
          config?: Json
          created_at?: string
          created_by_user_id?: string
          id?: string
          organisation_id?: string
          provider?: string
          secrets?: Json
          status?: string
          updated_at?: string
          webhook_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_integrations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      organisation_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          id: string
          invited_by_user_id: string
          org_role: Database["public"]["Enums"]["org_role"]
          organisation_id: string
          revoked_at: string | null
          status: Database["public"]["Enums"]["invite_status"]
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by_user_id: string
          org_role?: Database["public"]["Enums"]["org_role"]
          organisation_id: string
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["invite_status"]
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by_user_id?: string
          org_role?: Database["public"]["Enums"]["org_role"]
          organisation_id?: string
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["invite_status"]
        }
        Relationships: [
          {
            foreignKeyName: "organisation_invites_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      organisation_members: {
        Row: {
          created_at: string
          created_by_user_id: string
          org_role: Database["public"]["Enums"]["org_role"]
          organisation_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by_user_id: string
          org_role?: Database["public"]["Enums"]["org_role"]
          organisation_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string
          org_role?: Database["public"]["Enums"]["org_role"]
          organisation_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisation_members_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisation_members_user_profile_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organisations: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by_user_id: string
          id: string
          name: string
          owner_user_id: string | null
          slug: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by_user_id: string
          id?: string
          name: string
          owner_user_id?: string | null
          slug?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by_user_id?: string
          id?: string
          name?: string
          owner_user_id?: string | null
          slug?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      survey_ai_user_preferences: {
        Row: {
          auto_navigate: boolean
          global_assistant_rules: string
          show_archived_chats: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_navigate?: boolean
          global_assistant_rules?: string
          show_archived_chats?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_navigate?: boolean
          global_assistant_rules?: string
          show_archived_chats?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      survey_field_questions: {
        Row: {
          answer: string | null
          answered_at: string | null
          answered_by_user_id: string | null
          asked_at: string
          asked_notification_sent_at: string | null
          field_id: string
          id: string
          kind: string
          question: string
          response_id: string
          survey_id: string
        }
        Insert: {
          answer?: string | null
          answered_at?: string | null
          answered_by_user_id?: string | null
          asked_at?: string
          asked_notification_sent_at?: string | null
          field_id: string
          id?: string
          kind?: string
          question: string
          response_id: string
          survey_id: string
        }
        Update: {
          answer?: string | null
          answered_at?: string | null
          answered_by_user_id?: string | null
          asked_at?: string
          asked_notification_sent_at?: string | null
          field_id?: string
          id?: string
          kind?: string
          question?: string
          response_id?: string
          survey_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_field_questions_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "survey_responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_field_questions_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_folders: {
        Row: {
          created_at: string
          created_by_user_id: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_user_id: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      survey_responses: {
        Row: {
          answers: Json
          completed_at: string | null
          completed_notification_sent_at: string | null
          created_at: string
          id: string
          status: Database["public"]["Enums"]["survey_response_status"]
          survey_id: string
          token_hash: string
          updated_at: string
        }
        Insert: {
          answers?: Json
          completed_at?: string | null
          completed_notification_sent_at?: string | null
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["survey_response_status"]
          survey_id: string
          token_hash: string
          updated_at?: string
        }
        Update: {
          answers?: Json
          completed_at?: string | null
          completed_notification_sent_at?: string | null
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["survey_response_status"]
          survey_id?: string
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_responses_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      surveys: {
        Row: {
          created_at: string
          created_by_user_id: string
          definition: Json
          deleted_at: string | null
          deleted_by_user_id: string | null
          description: string
          folder_id: string | null
          id: string
          notification_emails: string[]
          published_at: string | null
          slug: string | null
          title: string
          updated_at: string
          visibility: Database["public"]["Enums"]["survey_visibility"]
          organisation_id: string | null
          purpose: Database["public"]["Enums"]["survey_purpose"]
        }
        Insert: {
          created_at?: string
          created_by_user_id: string
          definition: Json
          deleted_at?: string | null
          deleted_by_user_id?: string | null
          description?: string
          folder_id?: string | null
          id?: string
          notification_emails?: string[]
          published_at?: string | null
          slug?: string | null
          title: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["survey_visibility"]
          organisation_id?: string | null
          purpose?: Database["public"]["Enums"]["survey_purpose"]
        }
        Update: {
          created_at?: string
          created_by_user_id?: string
          definition?: Json
          deleted_at?: string | null
          deleted_by_user_id?: string | null
          description?: string
          folder_id?: string | null
          id?: string
          notification_emails?: string[]
          published_at?: string | null
          slug?: string | null
          title?: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["survey_visibility"]
          organisation_id?: string | null
          purpose?: Database["public"]["Enums"]["survey_purpose"]
        }
        Relationships: [
          {
            foreignKeyName: "surveys_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "survey_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      visits: {
        Row: {
          company_id: string
          created_at: string
          duration_s: number | null
          id: string
          metadata: Json
          organisation_id: string
          pages: Json
          raw_event_id: string | null
          referrer: string | null
          source: string
          visited_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          duration_s?: number | null
          id?: string
          metadata?: Json
          organisation_id: string
          pages?: Json
          raw_event_id?: string | null
          referrer?: string | null
          source?: string
          visited_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          duration_s?: number | null
          id?: string
          metadata?: Json
          organisation_id?: string
          pages?: Json
          raw_event_id?: string | null
          referrer?: string | null
          source?: string
          visited_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "visits_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_raw_event_id_fkey"
            columns: ["raw_event_id"]
            isOneToOne: false
            referencedRelation: "integration_raw_events"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_organisation_invite: {
        Args: { invite_id: string }
        Returns: undefined
      }
      admin_create_organisation: {
        Args: { org_name: string; org_slug?: string; owner_email: string }
        Returns: string
      }
      ask_public_field_question: {
        Args: {
          p_field_id: string
          p_kind?: string
          p_question: string
          p_slug: string
        }
        Returns: string
      }
      can_invite: { Args: { org_id: string }; Returns: boolean }
      can_kick: {
        Args: { org_id: string; target_user_id: string }
        Returns: boolean
      }
      can_view_profile: { Args: { target_user_id: string }; Returns: boolean }
      claim_due_jobs: {
        Args: { p_batch: number; p_now: string; p_worker: string }
        Returns: {
          attempts: number
          completed_at: string | null
          created_at: string
          dedupe_key: string | null
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          organisation_id: string | null
          payload: Json
          result: Json | null
          run_after: string
          started_at: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_public_survey_response: {
        Args: { p_slug: string }
        Returns: {
          response_id: string
        }[]
      }
      get_public_field_remark: {
        Args: { p_field_id: string; p_slug: string }
        Returns: {
          field_id: string
          id: string
          remark: string
          updated_at: string
        }[]
      }
      get_public_survey_by_slug: {
        Args: { p_slug: string }
        Returns: {
          definition: Json
          description: string
          id: string
          published_at: string
          slug: string
          title: string
        }[]
      }
      get_public_survey_response: {
        Args: { p_slug: string }
        Returns: {
          answers: Json
          completed_at: string
          status: Database["public"]["Enums"]["survey_response_status"]
          updated_at: string
        }[]
      }
      has_pending_org_invite: {
        Args: { invited_email: string; org_id: string }
        Returns: boolean
      }
      invite_to_organisation: {
        Args: {
          invited_email: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
        }
        Returns: string
      }
      is_org_member: { Args: { org_id: string; uid: string }; Returns: boolean }
      is_platform_admin: { Args: { uid: string }; Returns: boolean }
      is_sbkm_staff_email: { Args: { p_email: string }; Returns: boolean }
      set_platform_admin_role: {
        Args: { make_admin: boolean; target_email: string }
        Returns: undefined
      }
      jobs_cron_tick: { Args: never; Returns: undefined }
      kick_from_organisation: {
        Args: { org_id: string; target_user_id: string }
        Returns: undefined
      }
      revoke_organisation_invite: {
        Args: { invite_id: string }
        Returns: undefined
      }
      list_public_field_questions: {
        Args: { p_field_id: string; p_slug: string }
        Returns: {
          answer: string
          answered_at: string
          asked_at: string
          field_id: string
          id: string
          kind: string
          question: string
        }[]
      }
      my_org_role: {
        Args: { org_id: string }
        Returns: Database["public"]["Enums"]["org_role"]
      }
      save_public_survey_response: {
        Args: { p_answers: Json; p_mark_completed?: boolean; p_slug: string }
        Returns: undefined
      }
      set_platform_admin: {
        Args: { make_admin: boolean; target_user_id: string }
        Returns: undefined
      }
      transfer_organisation_ownership: {
        Args: { new_owner_user_id: string; org_id: string }
        Returns: undefined
      }
      upsert_public_field_remark: {
        Args: { p_field_id: string; p_remark: string; p_slug: string }
        Returns: string
      }
    }
    Enums: {
      invite_status: "pending" | "accepted" | "revoked"
      org_role: "owner" | "admin" | "employee"
      survey_response_status: "in_progress" | "completed"
      survey_visibility: "private" | "public"
      survey_purpose: "persona" | "anbieter"
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
      invite_status: ["pending", "accepted", "revoked"],
      org_role: ["owner", "admin", "employee"],
      survey_response_status: ["in_progress", "completed"],
      survey_visibility: ["private", "public"],
      survey_purpose: ["persona", "anbieter"],
    },
  },
} as const
