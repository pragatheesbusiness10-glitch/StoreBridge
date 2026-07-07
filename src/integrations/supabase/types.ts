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
  public: {
    Tables: {
      client_members: {
        Row: {
          client_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_members_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          agency_id: string | null
          client_name: string
          created_at: string
          id: string
          primary_contact_user_id: string | null
          status: Database["public"]["Enums"]["client_status"]
          store_type: Database["public"]["Enums"]["store_platform"] | null
          store_url: string | null
          updated_at: string
        }
        Insert: {
          agency_id?: string | null
          client_name: string
          created_at?: string
          id?: string
          primary_contact_user_id?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          store_type?: Database["public"]["Enums"]["store_platform"] | null
          store_url?: string | null
          updated_at?: string
        }
        Update: {
          agency_id?: string | null
          client_name?: string
          created_at?: string
          id?: string
          primary_contact_user_id?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          store_type?: Database["public"]["Enums"]["store_platform"] | null
          store_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      import_logs: {
        Row: {
          action: Database["public"]["Enums"]["log_action"]
          actor_id: string | null
          client_id: string | null
          created_at: string
          error_message: string | null
          id: string
          platform: Database["public"]["Enums"]["store_platform"] | null
          product_id: string | null
          request_payload: Json | null
          response_payload: Json | null
          status: Database["public"]["Enums"]["log_status"]
        }
        Insert: {
          action: Database["public"]["Enums"]["log_action"]
          actor_id?: string | null
          client_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          platform?: Database["public"]["Enums"]["store_platform"] | null
          product_id?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          status: Database["public"]["Enums"]["log_status"]
        }
        Update: {
          action?: Database["public"]["Enums"]["log_action"]
          actor_id?: string | null
          client_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          platform?: Database["public"]["Enums"]["store_platform"] | null
          product_id?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          status?: Database["public"]["Enums"]["log_status"]
        }
        Relationships: [
          {
            foreignKeyName: "import_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_logs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          parent_id: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          parent_id?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          alt_text: string | null
          created_at: string
          id: string
          product_id: string
          sort_order: number
          storage_path: string
        }
        Insert: {
          alt_text?: string | null
          created_at?: string
          id?: string
          product_id: string
          sort_order?: number
          storage_path: string
        }
        Update: {
          alt_text?: string | null
          created_at?: string
          id?: string
          product_id?: string
          sort_order?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          category: string | null
          client_id: string
          collection_name: string | null
          compare_at_price: number | null
          cost_price: number | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          inventory_quantity: number | null
          platform_product_id: string | null
          price: number | null
          product_type: string | null
          published_platform:
            | Database["public"]["Enums"]["store_platform"]
            | null
          published_url: string | null
          rejection_note: string | null
          seo_description: string | null
          seo_title: string | null
          short_description: string | null
          sku: string | null
          slug: string | null
          status: Database["public"]["Enums"]["product_status"]
          tags: string[] | null
          title: string
          updated_at: string
          vendor: string | null
          woo_category: string | null
        }
        Insert: {
          barcode?: string | null
          category?: string | null
          client_id: string
          collection_name?: string | null
          compare_at_price?: number | null
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          inventory_quantity?: number | null
          platform_product_id?: string | null
          price?: number | null
          product_type?: string | null
          published_platform?:
            | Database["public"]["Enums"]["store_platform"]
            | null
          published_url?: string | null
          rejection_note?: string | null
          seo_description?: string | null
          seo_title?: string | null
          short_description?: string | null
          sku?: string | null
          slug?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          tags?: string[] | null
          title: string
          updated_at?: string
          vendor?: string | null
          woo_category?: string | null
        }
        Update: {
          barcode?: string | null
          category?: string | null
          client_id?: string
          collection_name?: string | null
          compare_at_price?: number | null
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          inventory_quantity?: number | null
          platform_product_id?: string | null
          price?: number | null
          product_type?: string | null
          published_platform?:
            | Database["public"]["Enums"]["store_platform"]
            | null
          published_url?: string | null
          rejection_note?: string | null
          seo_description?: string | null
          seo_title?: string | null
          short_description?: string | null
          sku?: string | null
          slug?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          tags?: string[] | null
          title?: string
          updated_at?: string
          vendor?: string | null
          woo_category?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          company_name: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          company_name?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      store_integrations: {
        Row: {
          api_version: string | null
          client_id: string
          created_at: string
          default_category: string | null
          default_collection: string | null
          default_location_id: string | null
          enc_access_token: string | null
          enc_consumer_key: string | null
          enc_consumer_secret: string | null
          id: string
          is_active: boolean
          last_test_status: Database["public"]["Enums"]["log_status"] | null
          last_tested_at: string | null
          platform: Database["public"]["Enums"]["store_platform"]
          store_name: string | null
          store_url: string
          updated_at: string
        }
        Insert: {
          api_version?: string | null
          client_id: string
          created_at?: string
          default_category?: string | null
          default_collection?: string | null
          default_location_id?: string | null
          enc_access_token?: string | null
          enc_consumer_key?: string | null
          enc_consumer_secret?: string | null
          id?: string
          is_active?: boolean
          last_test_status?: Database["public"]["Enums"]["log_status"] | null
          last_tested_at?: string | null
          platform: Database["public"]["Enums"]["store_platform"]
          store_name?: string | null
          store_url: string
          updated_at?: string
        }
        Update: {
          api_version?: string | null
          client_id?: string
          created_at?: string
          default_category?: string | null
          default_collection?: string | null
          default_location_id?: string | null
          enc_access_token?: string | null
          enc_consumer_key?: string | null
          enc_consumer_secret?: string | null
          id?: string
          is_active?: boolean
          last_test_status?: Database["public"]["Enums"]["log_status"] | null
          last_tested_at?: string | null
          platform?: Database["public"]["Enums"]["store_platform"]
          store_name?: string | null
          store_url?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_integrations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      user_belongs_to_client: {
        Args: { _client_id: string; _user_id: string }
        Returns: boolean
      }
      user_can_access_client: {
        Args: { _client_id: string; _user_id: string }
        Returns: boolean
      }
      user_can_manage_client: {
        Args: { _client_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "super_admin" | "agency_admin" | "client"
      client_status: "active" | "inactive"
      log_action: "publish" | "test_connection" | "export"
      log_status: "success" | "failure"
      product_status:
        | "draft"
        | "submitted"
        | "approved"
        | "published"
        | "failed"
        | "rejected"
      store_platform: "shopify" | "woocommerce"
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
      app_role: ["super_admin", "agency_admin", "client"],
      client_status: ["active", "inactive"],
      log_action: ["publish", "test_connection", "export"],
      log_status: ["success", "failure"],
      product_status: [
        "draft",
        "submitted",
        "approved",
        "published",
        "failed",
        "rejected",
      ],
      store_platform: ["shopify", "woocommerce"],
    },
  },
} as const
