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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      asset_status_history: {
        Row: {
          asset_id: string
          changed_at: string
          changed_by: string | null
          id: string
          new_condition: string | null
          new_status: string
          old_condition: string | null
          old_status: string | null
          reason: string | null
        }
        Insert: {
          asset_id: string
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_condition?: string | null
          new_status: string
          old_condition?: string | null
          old_status?: string | null
          reason?: string | null
        }
        Update: {
          asset_id?: string
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_condition?: string | null
          new_status?: string
          old_condition?: string | null
          old_status?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_status_history_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_status_history_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_status_history_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "asset_status_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: unknown
          new_values: Json | null
          old_values: Json | null
          performed_by: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          performed_by?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          performed_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      calibration_certificates: {
        Row: {
          created_at: string
          file_path: string
          id: string
          issue_date: string | null
          issued_by: string | null
          record_id: string
        }
        Insert: {
          created_at?: string
          file_path: string
          id?: string
          issue_date?: string | null
          issued_by?: string | null
          record_id: string
        }
        Update: {
          created_at?: string
          file_path?: string
          id?: string
          issue_date?: string | null
          issued_by?: string | null
          record_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calibration_certificates_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "calibration_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calibration_certificates_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "v_calibration_due"
            referencedColumns: ["id"]
          },
        ]
      }
      calibration_records: {
        Row: {
          asset_id: string
          calibrated_by: string | null
          calibration_date: string
          calibration_type_id: string | null
          certificate_path: string | null
          created_at: string
          id: string
          next_due_date: string | null
          notes: string | null
          result: string
          updated_at: string
        }
        Insert: {
          asset_id: string
          calibrated_by?: string | null
          calibration_date: string
          calibration_type_id?: string | null
          certificate_path?: string | null
          created_at?: string
          id?: string
          next_due_date?: string | null
          notes?: string | null
          result: string
          updated_at?: string
        }
        Update: {
          asset_id?: string
          calibrated_by?: string | null
          calibration_date?: string
          calibration_type_id?: string | null
          certificate_path?: string | null
          created_at?: string
          id?: string
          next_due_date?: string | null
          notes?: string | null
          result?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calibration_records_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calibration_records_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calibration_records_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "calibration_records_calibration_type_id_fkey"
            columns: ["calibration_type_id"]
            isOneToOne: false
            referencedRelation: "calibration_types"
            referencedColumns: ["id"]
          },
        ]
      }
      calibration_requests: {
        Row: {
          asset_id: string
          calibration_type_id: string | null
          created_at: string
          id: string
          notes: string | null
          request_number: string
          requested_by: string | null
          status: string
          updated_at: string
          urgency: string
        }
        Insert: {
          asset_id: string
          calibration_type_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          request_number: string
          requested_by?: string | null
          status?: string
          updated_at?: string
          urgency?: string
        }
        Update: {
          asset_id?: string
          calibration_type_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          request_number?: string
          requested_by?: string | null
          status?: string
          updated_at?: string
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "calibration_requests_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calibration_requests_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calibration_requests_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "calibration_requests_calibration_type_id_fkey"
            columns: ["calibration_type_id"]
            isOneToOne: false
            referencedRelation: "calibration_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calibration_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      calibration_types: {
        Row: {
          created_at: string
          description: string | null
          id: string
          interval_months: number
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          interval_months?: number
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          interval_months?: number
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          answer_basis: string | null
          confidence: string | null
          content: string
          created_at: string
          decision: string | null
          id: string
          intent: string | null
          metadata: Json | null
          role: string
          session_id: string
        }
        Insert: {
          answer_basis?: string | null
          confidence?: string | null
          content: string
          created_at?: string
          decision?: string | null
          id?: string
          intent?: string | null
          metadata?: Json | null
          role: string
          session_id: string
        }
        Update: {
          answer_basis?: string | null
          confidence?: string | null
          content?: string
          created_at?: string
          decision?: string | null
          id?: string
          intent?: string | null
          metadata?: Json | null
          role?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_sessions: {
        Row: {
          asset_id: string | null
          created_at: string
          department_id: string | null
          id: string
          title: string
          updated_at: string
          user_id: string
          work_order_id: string | null
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          department_id?: string | null
          id?: string
          title: string
          updated_at?: string
          user_id: string
          work_order_id?: string | null
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          department_id?: string | null
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_sessions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_sessions_equipment_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_sessions_equipment_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_sessions_equipment_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "chat_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_sessions_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "v_open_work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_sessions_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_readiness_snapshots: {
        Row: {
          created_at: string
          department_id: string
          details: Json
          essential_functional: number
          essential_total: number
          id: string
          readiness_score: number
          snapshot_date: string
        }
        Insert: {
          created_at?: string
          department_id: string
          details?: Json
          essential_functional?: number
          essential_total?: number
          id?: string
          readiness_score: number
          snapshot_date?: string
        }
        Update: {
          created_at?: string
          department_id?: string
          details?: Json
          essential_functional?: number
          essential_total?: number
          id?: string
          readiness_score?: number
          snapshot_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinical_readiness_snapshots_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      command_center_acknowledgements: {
        Row: {
          acknowledged_at: string
          asset_id: string | null
          created_at: string
          id: string
          item_key: string
          item_type: string
          profile_id: string
          reason: string | null
          signal_hash: string
          snoozed_until: string | null
        }
        Insert: {
          acknowledged_at?: string
          asset_id?: string | null
          created_at?: string
          id?: string
          item_key: string
          item_type: string
          profile_id: string
          reason?: string | null
          signal_hash: string
          snoozed_until?: string | null
        }
        Update: {
          acknowledged_at?: string
          asset_id?: string | null
          created_at?: string
          id?: string
          item_key?: string
          item_type?: string
          profile_id?: string
          reason?: string | null
          signal_hash?: string
          snoozed_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "command_center_acknowledgements_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "command_center_acknowledgements_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "command_center_acknowledgements_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "command_center_acknowledgements_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_support_refresh_log: {
        Row: {
          asset_id: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          scope: string
          started_at: string
          status: string
          triggered_by: string | null
        }
        Insert: {
          asset_id?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          scope: string
          started_at?: string
          status?: string
          triggered_by?: string | null
        }
        Update: {
          asset_id?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          scope?: string
          started_at?: string
          status?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "decision_support_refresh_log_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_support_refresh_log_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_support_refresh_log_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "decision_support_refresh_log_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      disposal_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          asset_id: string
          created_at: string
          disposal_method_proposed: string | null
          id: string
          notes: string | null
          reason: string
          request_number: string
          requested_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          asset_id: string
          created_at?: string
          disposal_method_proposed?: string | null
          id?: string
          notes?: string | null
          reason: string
          request_number: string
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          asset_id?: string
          created_at?: string
          disposal_method_proposed?: string | null
          id?: string
          notes?: string | null
          reason?: string
          request_number?: string
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "disposal_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disposal_requests_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disposal_requests_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disposal_requests_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "disposal_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      disposed_assets: {
        Row: {
          asset_id: string
          created_at: string
          disposal_date: string
          disposal_method: string
          disposal_request_id: string | null
          disposal_value: number | null
          disposed_by: string | null
          id: string
          notes: string | null
        }
        Insert: {
          asset_id: string
          created_at?: string
          disposal_date: string
          disposal_method: string
          disposal_request_id?: string | null
          disposal_value?: number | null
          disposed_by?: string | null
          id?: string
          notes?: string | null
        }
        Update: {
          asset_id?: string
          created_at?: string
          disposal_date?: string
          disposal_method?: string
          disposal_request_id?: string | null
          disposal_value?: number | null
          disposed_by?: string | null
          id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "disposed_assets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disposed_assets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disposed_assets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "disposed_assets_disposal_request_id_fkey"
            columns: ["disposal_request_id"]
            isOneToOne: false
            referencedRelation: "disposal_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disposed_assets_disposed_by_fkey"
            columns: ["disposed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      downtime_logs: {
        Row: {
          asset_id: string
          created_at: string
          duration_hours: number | null
          end_time: string | null
          event_id: string | null
          id: string
          reason: string | null
          start_time: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          duration_hours?: number | null
          end_time?: string | null
          event_id?: string | null
          id?: string
          reason?: string | null
          start_time: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          duration_hours?: number | null
          end_time?: string | null
          event_id?: string | null
          id?: string
          reason?: string | null
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "downtime_logs_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "downtime_logs_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "downtime_logs_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "downtime_logs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "maintenance_events"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_assets: {
        Row: {
          asset_code: string
          category_id: string
          condition: string
          created_at: string
          deleted_at: string | null
          department_id: string
          id: string
          installation_date: string | null
          manufacturer_id: string | null
          model_id: string | null
          name: string
          notes: string | null
          photo_url: string | null
          purchase_cost: number | null
          purchase_date: string | null
          serial_number: string | null
          service_contract_expiry: string | null
          source: string | null
          status: string
          supplier_id: string | null
          updated_at: string
          vendor_id: string | null
          warranty_expiry: string | null
        }
        Insert: {
          asset_code: string
          category_id: string
          condition?: string
          created_at?: string
          deleted_at?: string | null
          department_id: string
          id?: string
          installation_date?: string | null
          manufacturer_id?: string | null
          model_id?: string | null
          name: string
          notes?: string | null
          photo_url?: string | null
          purchase_cost?: number | null
          purchase_date?: string | null
          serial_number?: string | null
          service_contract_expiry?: string | null
          source?: string | null
          status?: string
          supplier_id?: string | null
          updated_at?: string
          vendor_id?: string | null
          warranty_expiry?: string | null
        }
        Update: {
          asset_code?: string
          category_id?: string
          condition?: string
          created_at?: string
          deleted_at?: string | null
          department_id?: string
          id?: string
          installation_date?: string | null
          manufacturer_id?: string | null
          model_id?: string | null
          name?: string
          notes?: string | null
          photo_url?: string | null
          purchase_cost?: number | null
          purchase_date?: string | null
          serial_number?: string | null
          service_contract_expiry?: string | null
          source?: string | null
          status?: string
          supplier_id?: string | null
          updated_at?: string
          vendor_id?: string | null
          warranty_expiry?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_assets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "equipment_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_assets_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_assets_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "manufacturers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_assets_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "equipment_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_assets_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_assets_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_categories: {
        Row: {
          code: string
          created_at: string
          criticality_level: string | null
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          criticality_level?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          criticality_level?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      equipment_documents: {
        Row: {
          asset_id: string | null
          created_at: string
          description: string | null
          document_type: string
          file_path: string
          file_size: number | null
          id: string
          mime_type: string | null
          title: string
          uploaded_by: string | null
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          description?: string | null
          document_type: string
          file_path: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          title: string
          uploaded_by?: string | null
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          description?: string | null
          document_type?: string
          file_path?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          title?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_documents_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_documents_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_documents_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
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
      equipment_health_snapshots: {
        Row: {
          asset_id: string
          created_at: string
          explanation: Json
          health_score: number
          id: string
          pm_component: number | null
          reliability_component: number | null
          risk_component: number | null
          snapshot_date: string
          status_component: number | null
        }
        Insert: {
          asset_id: string
          created_at?: string
          explanation?: Json
          health_score: number
          id?: string
          pm_component?: number | null
          reliability_component?: number | null
          risk_component?: number | null
          snapshot_date?: string
          status_component?: number | null
        }
        Update: {
          asset_id?: string
          created_at?: string
          explanation?: Json
          health_score?: number
          id?: string
          pm_component?: number | null
          reliability_component?: number | null
          risk_component?: number | null
          snapshot_date?: string
          status_component?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_health_snapshots_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_health_snapshots_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_health_snapshots_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
        ]
      }
      equipment_models: {
        Row: {
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          manufacturer_id: string | null
          name: string
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          manufacturer_id?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          manufacturer_id?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_models_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "equipment_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_models_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "manufacturers"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_performance_scores: {
        Row: {
          asset_id: string
          composite_score: number | null
          computed_at: string
          id: string
          normalized_availability: number | null
          normalized_downtime: number | null
          normalized_failure_rate: number | null
          normalized_mttr: number | null
          normalized_pmc: number | null
          period_end: string
          period_start: string
          weights_profile_id: string | null
        }
        Insert: {
          asset_id: string
          composite_score?: number | null
          computed_at?: string
          id?: string
          normalized_availability?: number | null
          normalized_downtime?: number | null
          normalized_failure_rate?: number | null
          normalized_mttr?: number | null
          normalized_pmc?: number | null
          period_end: string
          period_start: string
          weights_profile_id?: string | null
        }
        Update: {
          asset_id?: string
          composite_score?: number | null
          computed_at?: string
          id?: string
          normalized_availability?: number | null
          normalized_downtime?: number | null
          normalized_failure_rate?: number | null
          normalized_mttr?: number | null
          normalized_pmc?: number | null
          period_end?: string
          period_start?: string
          weights_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_performance_scores_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_performance_scores_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_performance_scores_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "equipment_performance_scores_weights_profile_id_fkey"
            columns: ["weights_profile_id"]
            isOneToOne: false
            referencedRelation: "scoring_weights"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_reliability_metrics: {
        Row: {
          asset_id: string
          availability_ratio: number | null
          computed_at: string
          failure_count: number
          id: string
          mtbf_hours: number | null
          mttr_hours: number | null
          period_end: string
          period_start: string
          repair_count: number
          total_downtime_hours: number | null
          total_operational_hours: number | null
        }
        Insert: {
          asset_id: string
          availability_ratio?: number | null
          computed_at?: string
          failure_count?: number
          id?: string
          mtbf_hours?: number | null
          mttr_hours?: number | null
          period_end: string
          period_start: string
          repair_count?: number
          total_downtime_hours?: number | null
          total_operational_hours?: number | null
        }
        Update: {
          asset_id?: string
          availability_ratio?: number | null
          computed_at?: string
          failure_count?: number
          id?: string
          mtbf_hours?: number | null
          mttr_hours?: number | null
          period_end?: string
          period_start?: string
          repair_count?: number
          total_downtime_hours?: number | null
          total_operational_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_reliability_metrics_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_reliability_metrics_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_reliability_metrics_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
        ]
      }
      equipment_risk_scores: {
        Row: {
          assessed_at: string
          assessed_by: string | null
          asset_id: string
          assignment_method: string
          computed_at: string
          detectability: number
          explanation: Json
          id: string
          notes: string | null
          occurrence: number
          override_at: string | null
          override_by: string | null
          override_reason: string | null
          risk_level: string | null
          rpn: number | null
          severity: number
          source_version: string
        }
        Insert: {
          assessed_at?: string
          assessed_by?: string | null
          asset_id: string
          assignment_method?: string
          computed_at?: string
          detectability: number
          explanation?: Json
          id?: string
          notes?: string | null
          occurrence: number
          override_at?: string | null
          override_by?: string | null
          override_reason?: string | null
          risk_level?: string | null
          rpn?: number | null
          severity: number
          source_version?: string
        }
        Update: {
          assessed_at?: string
          assessed_by?: string | null
          asset_id?: string
          assignment_method?: string
          computed_at?: string
          detectability?: number
          explanation?: Json
          id?: string
          notes?: string | null
          occurrence?: number
          override_at?: string | null
          override_by?: string | null
          override_reason?: string | null
          risk_level?: string | null
          rpn?: number | null
          severity?: number
          source_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_risk_scores_assessed_by_fkey"
            columns: ["assessed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_risk_scores_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_risk_scores_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_risk_scores_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "equipment_risk_scores_override_by_fkey"
            columns: ["override_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_training_records: {
        Row: {
          asset_id: string
          created_at: string
          id: string
          notes: string | null
          session_id: string
          topics_covered: string | null
        }
        Insert: {
          asset_id: string
          created_at?: string
          id?: string
          notes?: string | null
          session_id: string
          topics_covered?: string | null
        }
        Update: {
          asset_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          session_id?: string
          topics_covered?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_training_records_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_training_records_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_training_records_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "equipment_training_records_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "training_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      escalation_events: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          asset_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          escalation_step: number
          forwarded_to: string | null
          id: string
          last_notification_at: string | null
          metadata: Json
          next_escalation_at: string | null
          notification_id: string | null
          reason: string
          recipient_profile_id: string | null
          resolved_at: string | null
          rule_id: string | null
          severity: string
          status: string
          work_order_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          asset_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          escalation_step?: number
          forwarded_to?: string | null
          id?: string
          last_notification_at?: string | null
          metadata?: Json
          next_escalation_at?: string | null
          notification_id?: string | null
          reason: string
          recipient_profile_id?: string | null
          resolved_at?: string | null
          rule_id?: string | null
          severity: string
          status?: string
          work_order_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          asset_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          escalation_step?: number
          forwarded_to?: string | null
          id?: string
          last_notification_at?: string | null
          metadata?: Json
          next_escalation_at?: string | null
          notification_id?: string | null
          reason?: string
          recipient_profile_id?: string | null
          resolved_at?: string | null
          rule_id?: string | null
          severity?: string
          status?: string
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "escalation_events_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_events_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_events_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_events_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "escalation_events_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_events_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_events_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "escalation_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_events_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "v_open_work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_events_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      escalation_rules: {
        Row: {
          acknowledgement_minutes: number
          close_minutes: number
          created_at: string
          escalate_to_role: string | null
          escalation_minutes: number
          id: string
          is_active: boolean
          notification_category: string
          rule_name: string
          severity: string
          trigger_config: Json
          trigger_type: string
          updated_at: string
        }
        Insert: {
          acknowledgement_minutes?: number
          close_minutes?: number
          created_at?: string
          escalate_to_role?: string | null
          escalation_minutes?: number
          id?: string
          is_active?: boolean
          notification_category?: string
          rule_name: string
          severity?: string
          trigger_config?: Json
          trigger_type: string
          updated_at?: string
        }
        Update: {
          acknowledgement_minutes?: number
          close_minutes?: number
          created_at?: string
          escalate_to_role?: string | null
          escalation_minutes?: number
          id?: string
          is_active?: boolean
          notification_category?: string
          rule_name?: string
          severity?: string
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      failure_codes: {
        Row: {
          category: string | null
          code: string
          created_at: string
          description: string
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string
          description: string
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      inspection_templates: {
        Row: {
          checklist_items: Json
          created_at: string
          grading_scale: Json
          id: string
          is_active: boolean
          template_name: string
          template_type: string
          updated_at: string
        }
        Insert: {
          checklist_items?: Json
          created_at?: string
          grading_scale?: Json
          id?: string
          is_active?: boolean
          template_name: string
          template_type: string
          updated_at?: string
        }
        Update: {
          checklist_items?: Json
          created_at?: string
          grading_scale?: Json
          id?: string
          is_active?: boolean
          template_name?: string
          template_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      installation_records: {
        Row: {
          acceptance_checklist: Json | null
          asset_id: string
          commissioning_date: string | null
          created_at: string
          go_live_date: string | null
          id: string
          initial_training_done: boolean | null
          installation_date: string
          installed_by: string | null
          notes: string | null
          updated_at: string
        }
        Insert: {
          acceptance_checklist?: Json | null
          asset_id: string
          commissioning_date?: string | null
          created_at?: string
          go_live_date?: string | null
          id?: string
          initial_training_done?: boolean | null
          installation_date: string
          installed_by?: string | null
          notes?: string | null
          updated_at?: string
        }
        Update: {
          acceptance_checklist?: Json | null
          asset_id?: string
          commissioning_date?: string | null
          created_at?: string
          go_live_date?: string | null
          id?: string
          initial_training_done?: boolean | null
          installation_date?: string
          installed_by?: string | null
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "installation_records_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installation_records_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installation_records_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
        ]
      }
      installation_requests: {
        Row: {
          asset_code_hint: string | null
          asset_id: string | null
          assigned_to: string | null
          commissioning_required: boolean
          completed_at: string | null
          created_at: string
          department_id: string | null
          equipment_name: string | null
          id: string
          installation_reason: string | null
          installation_record_id: string | null
          notes: string | null
          priority: string
          procurement_request_id: string | null
          received_date: string | null
          request_number: string
          requested_by: string | null
          requested_installation_date: string | null
          scheduled_date: string | null
          source: string | null
          status: string
          target_go_live_date: string | null
          updated_at: string
          user_training_required: boolean
          vendor: string | null
        }
        Insert: {
          asset_code_hint?: string | null
          asset_id?: string | null
          assigned_to?: string | null
          commissioning_required?: boolean
          completed_at?: string | null
          created_at?: string
          department_id?: string | null
          equipment_name?: string | null
          id?: string
          installation_reason?: string | null
          installation_record_id?: string | null
          notes?: string | null
          priority?: string
          procurement_request_id?: string | null
          received_date?: string | null
          request_number: string
          requested_by?: string | null
          requested_installation_date?: string | null
          scheduled_date?: string | null
          source?: string | null
          status?: string
          target_go_live_date?: string | null
          updated_at?: string
          user_training_required?: boolean
          vendor?: string | null
        }
        Update: {
          asset_code_hint?: string | null
          asset_id?: string | null
          assigned_to?: string | null
          commissioning_required?: boolean
          completed_at?: string | null
          created_at?: string
          department_id?: string | null
          equipment_name?: string | null
          id?: string
          installation_reason?: string | null
          installation_record_id?: string | null
          notes?: string | null
          priority?: string
          procurement_request_id?: string | null
          received_date?: string | null
          request_number?: string
          requested_by?: string | null
          requested_installation_date?: string | null
          scheduled_date?: string | null
          source?: string | null
          status?: string
          target_go_live_date?: string | null
          updated_at?: string
          user_training_required?: boolean
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "installation_requests_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installation_requests_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installation_requests_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "installation_requests_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installation_requests_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installation_requests_installation_record_id_fkey"
            columns: ["installation_record_id"]
            isOneToOne: false
            referencedRelation: "installation_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installation_requests_procurement_request_id_fkey"
            columns: ["procurement_request_id"]
            isOneToOne: false
            referencedRelation: "procurement_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installation_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_action_codes: {
        Row: {
          category: string | null
          code: string
          created_at: string
          description: string
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string
          description: string
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      maintenance_events: {
        Row: {
          action_code_id: string | null
          action_taken: string | null
          asset_id: string
          completed_by: string | null
          completion_date: string | null
          created_at: string
          downtime_end: string | null
          downtime_start: string | null
          event_type: string
          failure_code_id: string | null
          failure_date: string | null
          id: string
          notes: string | null
          repair_duration_hours: number | null
          service_cost: number | null
          updated_at: string
          work_order_id: string | null
        }
        Insert: {
          action_code_id?: string | null
          action_taken?: string | null
          asset_id: string
          completed_by?: string | null
          completion_date?: string | null
          created_at?: string
          downtime_end?: string | null
          downtime_start?: string | null
          event_type?: string
          failure_code_id?: string | null
          failure_date?: string | null
          id?: string
          notes?: string | null
          repair_duration_hours?: number | null
          service_cost?: number | null
          updated_at?: string
          work_order_id?: string | null
        }
        Update: {
          action_code_id?: string | null
          action_taken?: string | null
          asset_id?: string
          completed_by?: string | null
          completion_date?: string | null
          created_at?: string
          downtime_end?: string | null
          downtime_start?: string | null
          event_type?: string
          failure_code_id?: string | null
          failure_date?: string | null
          id?: string
          notes?: string | null
          repair_duration_hours?: number | null
          service_cost?: number | null
          updated_at?: string
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_events_action_code_id_fkey"
            columns: ["action_code_id"]
            isOneToOne: false
            referencedRelation: "maintenance_action_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_events_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_events_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_events_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "maintenance_events_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_events_failure_code_id_fkey"
            columns: ["failure_code_id"]
            isOneToOne: false
            referencedRelation: "failure_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_events_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "v_open_work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_events_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_parts_used: {
        Row: {
          created_at: string
          event_id: string
          id: string
          part_name: string
          quantity_used: number
          spare_part_id: string | null
          unit_cost: number | null
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          part_name: string
          quantity_used?: number
          spare_part_id?: string | null
          unit_cost?: number | null
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          part_name?: string
          quantity_used?: number
          spare_part_id?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_maintenance_parts_spare_part"
            columns: ["spare_part_id"]
            isOneToOne: false
            referencedRelation: "spare_parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_maintenance_parts_spare_part"
            columns: ["spare_part_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock_parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_parts_used_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "maintenance_events"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_requests: {
        Row: {
          asset_id: string
          created_at: string
          department_id: string
          fault_description: string
          id: string
          notes: string | null
          reported_condition: string | null
          reported_condition_source: string | null
          request_number: string
          request_type: string
          requested_by: string | null
          resolved_at: string | null
          status: string
          updated_at: string
          urgency: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          department_id: string
          fault_description: string
          id?: string
          notes?: string | null
          reported_condition?: string | null
          reported_condition_source?: string | null
          request_number: string
          request_type?: string
          requested_by?: string | null
          resolved_at?: string | null
          status?: string
          updated_at?: string
          urgency?: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          department_id?: string
          fault_description?: string
          id?: string
          notes?: string | null
          reported_condition?: string | null
          reported_condition_source?: string | null
          request_number?: string
          request_type?: string
          requested_by?: string | null
          resolved_at?: string | null
          status?: string
          updated_at?: string
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_requests_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_requests_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_requests_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "maintenance_requests_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturers: {
        Row: {
          contact_info: Json | null
          country: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          contact_info?: Json | null
          country?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          contact_info?: Json | null
          country?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      memis_lookup_values: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          label: string
          lookup_group: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          label: string
          lookup_group: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          label?: string
          lookup_group?: string
          updated_at?: string
        }
        Relationships: []
      }
      notification_delivery_logs: {
        Row: {
          attempt_number: number
          channel: string
          created_at: string
          delivered_at: string | null
          failure_reason: string | null
          id: string
          notification_id: string
          provider_name: string
          response_payload: Json
          status: string
        }
        Insert: {
          attempt_number?: number
          channel: string
          created_at?: string
          delivered_at?: string | null
          failure_reason?: string | null
          id?: string
          notification_id: string
          provider_name: string
          response_payload?: Json
          status: string
        }
        Update: {
          attempt_number?: number
          channel?: string
          created_at?: string
          delivered_at?: string | null
          failure_reason?: string | null
          id?: string
          notification_id?: string
          provider_name?: string
          response_payload?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_delivery_logs_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_events: {
        Row: {
          action_url: string | null
          aggregate_key: string | null
          asset_id: string | null
          category: string
          created_at: string
          created_by: string | null
          dedupe_key: string | null
          department_id: string | null
          entity_id: string | null
          entity_type: string
          event_type: string
          id: string
          message: string
          payload: Json
          requires_acknowledgement: boolean
          severity: string
          source_record_id: string | null
          source_table: string | null
          summary: string | null
          title: string
          urgency_score: number
        }
        Insert: {
          action_url?: string | null
          aggregate_key?: string | null
          asset_id?: string | null
          category: string
          created_at?: string
          created_by?: string | null
          dedupe_key?: string | null
          department_id?: string | null
          entity_id?: string | null
          entity_type: string
          event_type: string
          id?: string
          message: string
          payload?: Json
          requires_acknowledgement?: boolean
          severity?: string
          source_record_id?: string | null
          source_table?: string | null
          summary?: string | null
          title: string
          urgency_score?: number
        }
        Update: {
          action_url?: string | null
          aggregate_key?: string | null
          asset_id?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          dedupe_key?: string | null
          department_id?: string | null
          entity_id?: string | null
          entity_type?: string
          event_type?: string
          id?: string
          message?: string
          payload?: Json
          requires_acknowledgement?: boolean
          severity?: string
          source_record_id?: string | null
          source_table?: string | null
          summary?: string | null
          title?: string
          urgency_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "notification_events_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_events_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_events_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "notification_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_events_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          analytics_enabled: boolean
          calibration_enabled: boolean
          created_at: string
          critical_alerts_locked: boolean
          disposal_enabled: boolean
          email_enabled: boolean
          in_app_enabled: boolean
          logistics_enabled: boolean
          maintenance_enabled: boolean
          pm_enabled: boolean
          preferred_digest_hour: number
          procurement_enabled: boolean
          profile_id: string
          quiet_low_priority: boolean
          sms_enabled: boolean
          training_enabled: boolean
          updated_at: string
          weekly_digest_enabled: boolean
          work_order_enabled: boolean
        }
        Insert: {
          analytics_enabled?: boolean
          calibration_enabled?: boolean
          created_at?: string
          critical_alerts_locked?: boolean
          disposal_enabled?: boolean
          email_enabled?: boolean
          in_app_enabled?: boolean
          logistics_enabled?: boolean
          maintenance_enabled?: boolean
          pm_enabled?: boolean
          preferred_digest_hour?: number
          procurement_enabled?: boolean
          profile_id: string
          quiet_low_priority?: boolean
          sms_enabled?: boolean
          training_enabled?: boolean
          updated_at?: string
          weekly_digest_enabled?: boolean
          work_order_enabled?: boolean
        }
        Update: {
          analytics_enabled?: boolean
          calibration_enabled?: boolean
          created_at?: string
          critical_alerts_locked?: boolean
          disposal_enabled?: boolean
          email_enabled?: boolean
          in_app_enabled?: boolean
          logistics_enabled?: boolean
          maintenance_enabled?: boolean
          pm_enabled?: boolean
          preferred_digest_hour?: number
          procurement_enabled?: boolean
          profile_id?: string
          quiet_low_priority?: boolean
          sms_enabled?: boolean
          training_enabled?: boolean
          updated_at?: string
          weekly_digest_enabled?: boolean
          work_order_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          action_url: string | null
          category: string
          channel: string
          created_at: string
          dedupe_key: string | null
          delivered_at: string | null
          escalation_step: number
          event_id: string
          failure_reason: string | null
          id: string
          is_digest: boolean
          is_pinned: boolean
          message: string
          read_at: string | null
          recipient_profile_id: string
          related_entity_id: string | null
          related_entity_type: string | null
          requires_acknowledgement: boolean
          severity: string
          status: string
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          action_url?: string | null
          category: string
          channel?: string
          created_at?: string
          dedupe_key?: string | null
          delivered_at?: string | null
          escalation_step?: number
          event_id: string
          failure_reason?: string | null
          id?: string
          is_digest?: boolean
          is_pinned?: boolean
          message: string
          read_at?: string | null
          recipient_profile_id: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          requires_acknowledgement?: boolean
          severity?: string
          status?: string
          summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          action_url?: string | null
          category?: string
          channel?: string
          created_at?: string
          dedupe_key?: string | null
          delivered_at?: string | null
          escalation_step?: number
          event_id?: string
          failure_reason?: string | null
          id?: string
          is_digest?: boolean
          is_pinned?: boolean
          message?: string
          read_at?: string | null
          recipient_profile_id?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          requires_acknowledgement?: boolean
          severity?: string
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "notification_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_sync_events: {
        Row: {
          action_type: string
          actor_user_id: string | null
          client_action_id: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          payload: Json
          sync_status: string
          synced_at: string | null
        }
        Insert: {
          action_type: string
          actor_user_id?: string | null
          client_action_id: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          payload: Json
          sync_status?: string
          synced_at?: string | null
        }
        Update: {
          action_type?: string
          actor_user_id?: string | null
          client_action_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          payload?: Json
          sync_status?: string
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offline_sync_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pm_checklists: {
        Row: {
          created_at: string
          id: string
          items: Json
          schedule_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          items?: Json
          schedule_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          items?: Json
          schedule_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pm_checklists_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "pm_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_checklists_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "v_overdue_pm"
            referencedColumns: ["id"]
          },
        ]
      }
      pm_completions: {
        Row: {
          checklist_results: Json | null
          completed_by: string | null
          completion_date: string
          created_at: string
          duration_hours: number | null
          id: string
          notes: string | null
          schedule_id: string
        }
        Insert: {
          checklist_results?: Json | null
          completed_by?: string | null
          completion_date: string
          created_at?: string
          duration_hours?: number | null
          id?: string
          notes?: string | null
          schedule_id: string
        }
        Update: {
          checklist_results?: Json | null
          completed_by?: string | null
          completion_date?: string
          created_at?: string
          duration_hours?: number | null
          id?: string
          notes?: string | null
          schedule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pm_completions_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_completions_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "pm_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_completions_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "v_overdue_pm"
            referencedColumns: ["id"]
          },
        ]
      }
      pm_compliance_metrics: {
        Row: {
          asset_id: string | null
          category_id: string | null
          completed_count: number
          computed_at: string
          department_id: string | null
          id: string
          period_end: string
          period_start: string
          pmc_percentage: number | null
          scheduled_count: number
        }
        Insert: {
          asset_id?: string | null
          category_id?: string | null
          completed_count?: number
          computed_at?: string
          department_id?: string | null
          id?: string
          period_end: string
          period_start: string
          pmc_percentage?: number | null
          scheduled_count?: number
        }
        Update: {
          asset_id?: string | null
          category_id?: string | null
          completed_count?: number
          computed_at?: string
          department_id?: string | null
          id?: string
          period_end?: string
          period_start?: string
          pmc_percentage?: number | null
          scheduled_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "pm_compliance_metrics_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_compliance_metrics_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_compliance_metrics_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "pm_compliance_metrics_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "equipment_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_compliance_metrics_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      pm_plans: {
        Row: {
          asset_id: string
          created_at: string
          created_by: string | null
          frequency_days: number
          id: string
          is_active: boolean
          last_completed_date: string | null
          name: string
          next_due_date: string | null
          template_id: string | null
          updated_at: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          created_by?: string | null
          frequency_days?: number
          id?: string
          is_active?: boolean
          last_completed_date?: string | null
          name: string
          next_due_date?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          created_by?: string | null
          frequency_days?: number
          id?: string
          is_active?: boolean
          last_completed_date?: string | null
          name?: string
          next_due_date?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pm_plans_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_plans_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_plans_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "pm_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_plans_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "pm_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      pm_schedules: {
        Row: {
          asset_id: string
          assigned_to: string | null
          completed_at: string | null
          completed_by: string | null
          completion_checklist: Json | null
          completion_notes: string | null
          corrective_action_needed: boolean
          created_at: string
          deferred_reason: string | null
          deferred_until: string | null
          final_equipment_condition: string | null
          id: string
          notes: string | null
          plan_id: string
          result: string | null
          scheduled_date: string
          skipped_reason: string | null
          source_context: Json | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          asset_id: string
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completion_checklist?: Json | null
          completion_notes?: string | null
          corrective_action_needed?: boolean
          created_at?: string
          deferred_reason?: string | null
          deferred_until?: string | null
          final_equipment_condition?: string | null
          id?: string
          notes?: string | null
          plan_id: string
          result?: string | null
          scheduled_date: string
          skipped_reason?: string | null
          source_context?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          asset_id?: string
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completion_checklist?: Json | null
          completion_notes?: string | null
          corrective_action_needed?: boolean
          created_at?: string
          deferred_reason?: string | null
          deferred_until?: string | null
          final_equipment_condition?: string | null
          id?: string
          notes?: string | null
          plan_id?: string
          result?: string | null
          scheduled_date?: string
          skipped_reason?: string | null
          source_context?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pm_schedules_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_schedules_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_schedules_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "pm_schedules_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_schedules_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_schedules_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "pm_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      pm_templates: {
        Row: {
          category_id: string | null
          checklist_items: Json
          created_at: string
          description: string | null
          frequency_days: number
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          checklist_items?: Json
          created_at?: string
          description?: string | null
          frequency_days?: number
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          checklist_items?: Json
          created_at?: string
          description?: string | null
          frequency_days?: number
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pm_templates_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "equipment_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_requests: {
        Row: {
          created_at: string
          department_id: string | null
          expected_delivery_date: string | null
          id: string
          justification: string
          priority: string
          request_number: string
          requested_by: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          expected_delivery_date?: string | null
          id?: string
          justification: string
          priority?: string
          request_number: string
          requested_by?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string | null
          expected_delivery_date?: string | null
          id?: string
          justification?: string
          priority?: string
          request_number?: string
          requested_by?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_requests_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          department_id: string | null
          email: string
          full_name: string
          id: string
          is_active: boolean
          job_title: string | null
          phone: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          department_id?: string | null
          email: string
          full_name: string
          id?: string
          is_active?: boolean
          job_title?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          department_id?: string | null
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          job_title?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_flags: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          asset_id: string
          details: Json | null
          expires_at: string | null
          flag_type: string
          generated_at: string
          id: string
          is_acknowledged: boolean
          message: string
          severity: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          asset_id: string
          details?: Json | null
          expires_at?: string | null
          flag_type: string
          generated_at?: string
          id?: string
          is_acknowledged?: boolean
          message: string
          severity?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          asset_id?: string
          details?: Json | null
          expires_at?: string | null
          flag_type?: string
          generated_at?: string
          id?: string
          is_acknowledged?: boolean
          message?: string
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_flags_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_flags_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_flags_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_flags_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
        ]
      }
      replacement_priority_scores: {
        Row: {
          age_score: number | null
          asset_id: string
          availability_score: number | null
          computed_at: string
          cost_score: number | null
          failure_score: number | null
          id: string
          justification: string | null
          maintenance_burden_score: number | null
          period_end: string
          period_start: string
          rank: number | null
          replacement_priority_index: number | null
          risk_score: number | null
          spare_part_score: number | null
          weights_profile_id: string | null
        }
        Insert: {
          age_score?: number | null
          asset_id: string
          availability_score?: number | null
          computed_at?: string
          cost_score?: number | null
          failure_score?: number | null
          id?: string
          justification?: string | null
          maintenance_burden_score?: number | null
          period_end: string
          period_start: string
          rank?: number | null
          replacement_priority_index?: number | null
          risk_score?: number | null
          spare_part_score?: number | null
          weights_profile_id?: string | null
        }
        Update: {
          age_score?: number | null
          asset_id?: string
          availability_score?: number | null
          computed_at?: string
          cost_score?: number | null
          failure_score?: number | null
          id?: string
          justification?: string | null
          maintenance_burden_score?: number | null
          period_end?: string
          period_start?: string
          rank?: number | null
          replacement_priority_index?: number | null
          risk_score?: number | null
          spare_part_score?: number | null
          weights_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "replacement_priority_scores_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replacement_priority_scores_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replacement_priority_scores_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "replacement_priority_scores_weights_profile_id_fkey"
            columns: ["weights_profile_id"]
            isOneToOne: false
            referencedRelation: "scoring_weights"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_scales: {
        Row: {
          created_at: string
          description: string | null
          dimension: string
          id: string
          label: string
          level: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          dimension: string
          id?: string
          label: string
          level: number
        }
        Update: {
          created_at?: string
          description?: string | null
          dimension?: string
          id?: string
          label?: string
          level?: number
        }
        Relationships: []
      }
      roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          permissions: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          permissions?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          permissions?: Json
          updated_at?: string
        }
        Relationships: []
      }
      scoring_weights: {
        Row: {
          created_at: string
          criteria: Json
          description: string | null
          id: string
          is_default: boolean
          profile_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          criteria?: Json
          description?: string | null
          id?: string
          is_default?: boolean
          profile_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          criteria?: Json
          description?: string | null
          id?: string
          is_default?: boolean
          profile_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      spare_parts: {
        Row: {
          category: string | null
          compatible_categories: Json | null
          created_at: string
          current_stock: number
          description: string | null
          id: string
          is_active: boolean
          name: string
          part_code: string
          reorder_level: number
          unit: string
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          compatible_categories?: Json | null
          created_at?: string
          current_stock?: number
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          part_code: string
          reorder_level?: number
          unit?: string
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          compatible_categories?: Json | null
          created_at?: string
          current_stock?: number
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          part_code?: string
          reorder_level?: number
          unit?: string
          unit_cost?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      specification_requests: {
        Row: {
          asset_id: string | null
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          department_id: string | null
          equipment_category: string | null
          id: string
          linked_document_id: string | null
          notes: string | null
          priority: string
          procurement_request_id: string | null
          purpose: string | null
          replacement_candidate_asset_id: string | null
          request_number: string
          requested_by: string | null
          requested_equipment_name: string | null
          required_by: string | null
          source: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          asset_id?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          department_id?: string | null
          equipment_category?: string | null
          id?: string
          linked_document_id?: string | null
          notes?: string | null
          priority?: string
          procurement_request_id?: string | null
          purpose?: string | null
          replacement_candidate_asset_id?: string | null
          request_number: string
          requested_by?: string | null
          requested_equipment_name?: string | null
          required_by?: string | null
          source?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          asset_id?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          department_id?: string | null
          equipment_category?: string | null
          id?: string
          linked_document_id?: string | null
          notes?: string | null
          priority?: string
          procurement_request_id?: string | null
          purpose?: string | null
          replacement_candidate_asset_id?: string | null
          request_number?: string
          requested_by?: string | null
          requested_equipment_name?: string | null
          required_by?: string | null
          source?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "specification_requests_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "specification_requests_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "specification_requests_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "specification_requests_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "specification_requests_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "specification_requests_procurement_request_id_fkey"
            columns: ["procurement_request_id"]
            isOneToOne: false
            referencedRelation: "procurement_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "specification_requests_replacement_candidate_asset_id_fkey"
            columns: ["replacement_candidate_asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "specification_requests_replacement_candidate_asset_id_fkey"
            columns: ["replacement_candidate_asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "specification_requests_replacement_candidate_asset_id_fkey"
            columns: ["replacement_candidate_asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "specification_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_training_records: {
        Row: {
          certification_date: string | null
          created_at: string
          id: string
          notes: string | null
          session_id: string
          staff_name: string
          staff_user_id: string | null
          status: string
        }
        Insert: {
          certification_date?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          session_id: string
          staff_name: string
          staff_user_id?: string | null
          status?: string
        }
        Update: {
          certification_date?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          session_id?: string
          staff_name?: string
          staff_user_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_training_records_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "training_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_training_records_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      status_labels: {
        Row: {
          code: string
          color: string | null
          created_at: string
          entity_type: string
          id: string
          label: string
          sort_order: number
        }
        Insert: {
          code: string
          color?: string | null
          created_at?: string
          entity_type: string
          id?: string
          label: string
          sort_order?: number
        }
        Update: {
          code?: string
          color?: string | null
          created_at?: string
          entity_type?: string
          id?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      stock_issues: {
        Row: {
          created_at: string
          department_id: string | null
          id: string
          issue_date: string
          issued_by: string | null
          issued_to_event_id: string | null
          notes: string | null
          part_id: string
          quantity: number
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          id?: string
          issue_date?: string
          issued_by?: string | null
          issued_to_event_id?: string | null
          notes?: string | null
          part_id: string
          quantity: number
        }
        Update: {
          created_at?: string
          department_id?: string | null
          id?: string
          issue_date?: string
          issued_by?: string | null
          issued_to_event_id?: string | null
          notes?: string | null
          part_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_issues_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_issues_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_issues_issued_to_event_id_fkey"
            columns: ["issued_to_event_id"]
            isOneToOne: false
            referencedRelation: "maintenance_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_issues_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "spare_parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_issues_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock_parts"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_receipts: {
        Row: {
          created_at: string
          id: string
          invoice_ref: string | null
          notes: string | null
          part_id: string
          quantity: number
          received_by: string | null
          received_date: string
          supplier_id: string | null
          unit_cost: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_ref?: string | null
          notes?: string | null
          part_id: string
          quantity: number
          received_by?: string | null
          received_date?: string
          supplier_id?: string | null
          unit_cost?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          invoice_ref?: string | null
          notes?: string | null
          part_id?: string
          quantity?: number
          received_by?: string | null
          received_date?: string
          supplier_id?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_receipts_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "spare_parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_receipts_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock_parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_receipts_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_receipts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      training_requests: {
        Row: {
          asset_id: string | null
          created_at: string
          department_id: string | null
          description: string | null
          id: string
          notes: string | null
          request_number: string
          requested_by: string | null
          status: string
          training_type: string
          updated_at: string
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          department_id?: string | null
          description?: string | null
          id?: string
          notes?: string | null
          request_number: string
          requested_by?: string | null
          status?: string
          training_type?: string
          updated_at?: string
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          department_id?: string | null
          description?: string | null
          id?: string
          notes?: string | null
          request_number?: string
          requested_by?: string | null
          status?: string
          training_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_requests_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_requests_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_requests_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "training_requests_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      training_sessions: {
        Row: {
          asset_id: string | null
          category_id: string | null
          created_at: string
          description: string | null
          duration_hours: number | null
          id: string
          location: string | null
          max_participants: number | null
          title: string
          trainer: string
          training_date: string
          updated_at: string
        }
        Insert: {
          asset_id?: string | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          duration_hours?: number | null
          id?: string
          location?: string | null
          max_participants?: number | null
          title: string
          trainer: string
          training_date: string
          updated_at?: string
        }
        Update: {
          asset_id?: string | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          duration_hours?: number | null
          id?: string
          location?: string | null
          max_participants?: number | null
          title?: string
          trainer?: string
          training_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_sessions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_sessions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_sessions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "training_sessions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "equipment_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      triage_action_queue: {
        Row: {
          asset_id: string
          assigned_to: string | null
          due_by: string | null
          generated_at: string
          id: string
          priority_score: number
          rationale: Json
          recommendation: string
          status: string
        }
        Insert: {
          asset_id: string
          assigned_to?: string | null
          due_by?: string | null
          generated_at?: string
          id?: string
          priority_score: number
          rationale?: Json
          recommendation: string
          status?: string
        }
        Update: {
          asset_id?: string
          assigned_to?: string | null
          due_by?: string | null
          generated_at?: string
          id?: string
          priority_score?: number
          rationale?: Json
          recommendation?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "triage_action_queue_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triage_action_queue_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triage_action_queue_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "triage_action_queue_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          role_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          role_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      weekly_digest_snapshots: {
        Row: {
          created_at: string
          digest_kind: string
          id: string
          profile_id: string
          source_metrics: Json
          summary: Json
          top_items: Json
          week_end: string
          week_start: string
        }
        Insert: {
          created_at?: string
          digest_kind: string
          id?: string
          profile_id: string
          source_metrics?: Json
          summary?: Json
          top_items?: Json
          week_end: string
          week_start: string
        }
        Update: {
          created_at?: string
          digest_kind?: string
          id?: string
          profile_id?: string
          source_metrics?: Json
          summary?: Json
          top_items?: Json
          week_end?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_digest_snapshots_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      work_orders: {
        Row: {
          action_taken: string | null
          actual_hours: number | null
          asset_id: string
          assigned_to: string | null
          closure_notes: string | null
          completed_at: string | null
          completion_outcome: string | null
          created_at: string
          estimated_hours: number | null
          external_vendor: boolean | null
          external_vendor_name: string | null
          final_equipment_condition: string | null
          id: string
          priority: string
          request_id: string | null
          root_cause: string | null
          started_at: string | null
          status: string
          updated_at: string
          work_order_number: string
          work_type: string
        }
        Insert: {
          action_taken?: string | null
          actual_hours?: number | null
          asset_id: string
          assigned_to?: string | null
          closure_notes?: string | null
          completed_at?: string | null
          completion_outcome?: string | null
          created_at?: string
          estimated_hours?: number | null
          external_vendor?: boolean | null
          external_vendor_name?: string | null
          final_equipment_condition?: string | null
          id?: string
          priority?: string
          request_id?: string | null
          root_cause?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          work_order_number: string
          work_type?: string
        }
        Update: {
          action_taken?: string | null
          actual_hours?: number | null
          asset_id?: string
          assigned_to?: string | null
          closure_notes?: string | null
          completed_at?: string | null
          completion_outcome?: string | null
          created_at?: string
          estimated_hours?: number | null
          external_vendor?: boolean | null
          external_vendor_name?: string | null
          final_equipment_condition?: string | null
          id?: string
          priority?: string
          request_id?: string | null
          root_cause?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          work_order_number?: string
          work_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_orders_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "work_orders_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "maintenance_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      workload_capacity_snapshots: {
        Row: {
          assignee_id: string | null
          backlog_delta: number
          capacity_hours: number
          estimated_hours: number
          id: string
          open_assignments: number
          overdue_assignments: number
          snapshot_date: string
        }
        Insert: {
          assignee_id?: string | null
          backlog_delta?: number
          capacity_hours?: number
          estimated_hours?: number
          id?: string
          open_assignments?: number
          overdue_assignments?: number
          snapshot_date?: string
        }
        Update: {
          assignee_id?: string | null
          backlog_delta?: number
          capacity_hours?: number
          estimated_hours?: number
          id?: string
          open_assignments?: number
          overdue_assignments?: number
          snapshot_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "workload_capacity_snapshots_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_asset_health_summary: {
        Row: {
          asset_code: string | null
          asset_id: string | null
          asset_name: string | null
          department_name: string | null
          explanation: Json | null
          health_score: number | null
          pm_component: number | null
          reliability_component: number | null
          risk_component: number | null
          snapshot_created_at: string | null
          snapshot_date: string | null
          status_component: number | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_health_snapshots_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_health_snapshots_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_health_snapshots_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
        ]
      }
      v_calibration_due: {
        Row: {
          asset_code: string | null
          asset_id: string | null
          asset_name: string | null
          calibration_date: string | null
          calibration_type: string | null
          days_until_due: number | null
          department_name: string | null
          id: string | null
          next_due_date: string | null
          result: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calibration_records_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calibration_records_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calibration_records_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
        ]
      }
      v_command_center_triage: {
        Row: {
          asset_code: string | null
          asset_id: string | null
          asset_name: string | null
          assigned_to: string | null
          department_id: string | null
          department_name: string | null
          generated_at: string | null
          priority_score: number | null
          rationale: Json | null
          recommendation: string | null
          status: string | null
          top_flag_generated_at: string | null
          top_flag_id: string | null
          top_flag_severity: string | null
          top_flag_type: string | null
          triage_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_assets_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triage_action_queue_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triage_action_queue_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triage_action_queue_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
          {
            foreignKeyName: "triage_action_queue_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_dashboard_stats: {
        Row: {
          active_critical_alerts: number | null
          calibration_due_soon: number | null
          functional_count: number | null
          low_stock_parts: number | null
          non_functional_count: number | null
          open_work_orders: number | null
          overdue_pm: number | null
          pending_disposals: number | null
          total_equipment: number | null
        }
        Relationships: []
      }
      v_department_readiness: {
        Row: {
          department_id: string | null
          department_name: string | null
          details: Json | null
          essential_functional: number | null
          essential_total: number | null
          readiness_score: number | null
          snapshot_created_at: string | null
          snapshot_date: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinical_readiness_snapshots_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      v_equipment_summary: {
        Row: {
          age_years: number | null
          asset_code: string | null
          category_name: string | null
          condition: string | null
          criticality_level: string | null
          department_code: string | null
          department_name: string | null
          id: string | null
          installation_date: string | null
          manufacturer_name: string | null
          model_name: string | null
          name: string | null
          purchase_cost: number | null
          serial_number: string | null
          status: string | null
          warranty_expiry: string | null
        }
        Relationships: []
      }
      v_low_stock_parts: {
        Row: {
          category: string | null
          current_stock: number | null
          deficit: number | null
          id: string | null
          name: string | null
          part_code: string | null
          reorder_level: number | null
          unit_cost: number | null
        }
        Insert: {
          category?: string | null
          current_stock?: number | null
          deficit?: never
          id?: string | null
          name?: string | null
          part_code?: string | null
          reorder_level?: number | null
          unit_cost?: number | null
        }
        Update: {
          category?: string | null
          current_stock?: number | null
          deficit?: never
          id?: string | null
          name?: string | null
          part_code?: string | null
          reorder_level?: number | null
          unit_cost?: number | null
        }
        Relationships: []
      }
      v_maintenance_risk_context: {
        Row: {
          asset_code: string | null
          asset_id: string | null
          asset_name: string | null
          department_name: string | null
          failure_events_365d: number | null
          last_pm_completed_at: string | null
          latest_availability: number | null
          latest_risk_level: string | null
          latest_rpn: number | null
          open_part_shortage_flags: number | null
          open_work_orders_count: number | null
          overdue_pm_max_days: number | null
          top_failure_code: string | null
        }
        Relationships: []
      }
      v_open_work_orders: {
        Row: {
          asset_code: string | null
          asset_id: string | null
          asset_name: string | null
          assigned_to_name: string | null
          created_at: string | null
          department_id: string | null
          department_name: string | null
          id: string | null
          priority: string | null
          started_at: string | null
          status: string | null
          work_order_number: string | null
          work_type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_assets_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
        ]
      }
      v_overdue_pm: {
        Row: {
          asset_code: string | null
          asset_id: string | null
          asset_name: string | null
          assigned_to_name: string | null
          category_name: string | null
          criticality_level: string | null
          days_overdue: number | null
          department_id: string | null
          department_name: string | null
          id: string | null
          plan_name: string | null
          scheduled_date: string | null
          status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_assets_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_schedules_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_schedules_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_schedules_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
        ]
      }
      v_replacement_decision: {
        Row: {
          age_score: number | null
          asset_code: string | null
          asset_id: string | null
          asset_name: string | null
          availability_score: number | null
          computed_at: string | null
          cost_score: number | null
          current_availability: number | null
          current_pmc: number | null
          current_risk_level: string | null
          current_rpn: number | null
          department_name: string | null
          failure_score: number | null
          justification: string | null
          maintenance_burden_score: number | null
          replacement_priority_index: number | null
          replacement_rank: number | null
          risk_score: number | null
          spare_part_score: number | null
        }
        Relationships: [
          {
            foreignKeyName: "replacement_priority_scores_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replacement_priority_scores_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replacement_priority_scores_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "v_maintenance_risk_context"
            referencedColumns: ["asset_id"]
          },
        ]
      }
    }
    Functions: {
      _ensure_baseline_risk_scores: { Args: never; Returns: undefined }
      _recompute_asset_metrics: {
        Args: { p_asset_id: string }
        Returns: undefined
      }
      auth_user_has_role: { Args: { required_role: string }; Returns: boolean }
      compute_replacement_priority_scores_all: {
        Args: { p_period_end?: string; p_period_start?: string }
        Returns: undefined
      }
      fn_classify_risk_level: { Args: { rpn: number }; Returns: string }
      fn_clear_fmea_manual_override: {
        Args: { asset_uuid: string }
        Returns: string
      }
      fn_compute_availability: {
        Args: { p_asset_id: string; p_end_date: string; p_start_date: string }
        Returns: number
      }
      fn_compute_fmea_risk_for_asset: {
        Args: { asset_uuid: string }
        Returns: {
          detectability: number
          explanation: Json
          occurrence: number
          severity: number
        }[]
      }
      fn_compute_mtbf: {
        Args: { p_asset_id: string; p_end_date: string; p_start_date: string }
        Returns: number
      }
      fn_compute_mttr: {
        Args: { p_asset_id: string; p_end_date: string; p_start_date: string }
        Returns: number
      }
      fn_compute_pmc: {
        Args: {
          p_category_id?: string
          p_department_id?: string
          p_end_date?: string
          p_start_date?: string
        }
        Returns: number
      }
      fn_refresh_fmea_risk_score_for_asset: {
        Args: { asset_uuid: string; force_recompute?: boolean }
        Returns: string
      }
      fn_refresh_fmea_risk_scores: { Args: never; Returns: undefined }
      fn_set_fmea_risk_manual_override: {
        Args: {
          asset_uuid: string
          p_detectability: number
          p_occurrence: number
          p_override_by?: string
          p_override_reason: string
          p_severity: number
        }
        Returns: string
      }
      recompute_all_equipment_analytics: { Args: never; Returns: undefined }
      recompute_equipment_analytics: {
        Args: { p_asset_id: string }
        Returns: undefined
      }
      refresh_decision_support_snapshots: {
        Args: { snapshot_dt?: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
