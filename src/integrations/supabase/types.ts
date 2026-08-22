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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      ad_campaigns: {
        Row: {
          id: string
          name: string
          status: string | null
          synced_at: string
        }
        Insert: {
          id: string
          name: string
          status?: string | null
          synced_at?: string
        }
        Update: {
          id?: string
          name?: string
          status?: string | null
          synced_at?: string
        }
        Relationships: []
      }
      ad_insights: {
        Row: {
          campaign_id: string
          clicks: number
          conversations: number
          date: string
          impressions: number
          reach: number
          spend: number
          synced_at: string
        }
        Insert: {
          campaign_id: string
          clicks?: number
          conversations?: number
          date: string
          impressions?: number
          reach?: number
          spend?: number
          synced_at?: string
        }
        Update: {
          campaign_id?: string
          clicks?: number
          conversations?: number
          date?: string
          impressions?: number
          reach?: number
          spend?: number
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_insights_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_locations: {
        Row: {
          accuracy: number | null
          courier_id: string
          lat: number
          lng: number
          updated_at: string
        }
        Insert: {
          accuracy?: number | null
          courier_id: string
          lat: number
          lng: number
          updated_at?: string
        }
        Update: {
          accuracy?: number | null
          courier_id?: string
          lat?: number
          lng?: number
          updated_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string | null
          birth_date: string | null
          city: string | null
          created_at: string
          customer_type: Database["public"]["Enums"]["customer_type"]
          document: string | null
          email: string | null
          id: string
          name: string
          neighborhood: string | null
          notes: string | null
          phone: string | null
          reference_point: string | null
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          birth_date?: string | null
          city?: string | null
          created_at?: string
          customer_type?: Database["public"]["Enums"]["customer_type"]
          document?: string | null
          email?: string | null
          id?: string
          name: string
          neighborhood?: string | null
          notes?: string | null
          phone?: string | null
          reference_point?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          birth_date?: string | null
          city?: string | null
          created_at?: string
          customer_type?: Database["public"]["Enums"]["customer_type"]
          document?: string | null
          email?: string | null
          id?: string
          name?: string
          neighborhood?: string | null
          notes?: string | null
          phone?: string | null
          reference_point?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: []
      }
      delivery_fees: {
        Row: {
          amount: number
          id: string
          neighborhood: string
        }
        Insert: {
          amount: number
          id?: string
          neighborhood: string
        }
        Update: {
          amount?: number
          id?: string
          neighborhood?: string
        }
        Relationships: []
      }
      fixed_costs: {
        Row: {
          active: boolean
          created_at: string
          id: string
          monthly_amount: number
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          monthly_amount: number
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          monthly_amount?: number
          name?: string
        }
        Relationships: []
      }
      integration_settings: {
        Row: {
          access_token: string | null
          ad_account_id: string | null
          id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          access_token?: string | null
          ad_account_id?: string | null
          id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          access_token?: string | null
          ad_account_id?: string | null
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      offer_campaigns: {
        Row: {
          campaign_id: string
          offer_id: string
        }
        Insert: {
          campaign_id: string
          offer_id: string
        }
        Update: {
          campaign_id?: string
          offer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offer_campaigns_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_campaigns_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_costs: {
        Row: {
          kit_cost: number
          offer_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          kit_cost: number
          offer_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          kit_cost?: number
          offer_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offer_costs_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: true
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          active: boolean
          created_at: string
          id: string
          item_count: number
          name: string
          price: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          item_count: number
          name: string
          price: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          item_count?: number
          name?: string
          price?: number
        }
        Relationships: []
      }
      product_categories: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          active: boolean
          available_stock: number | null
          category_id: string | null
          cost_price: number
          created_at: string
          id: string
          min_stock: number
          name: string
          price: number
          reserved_stock: number
          sku: string | null
          stock: number
          updated_at: string
          wholesale_price: number
        }
        Insert: {
          active?: boolean
          available_stock?: number | null
          category_id?: string | null
          cost_price?: number
          created_at?: string
          id?: string
          min_stock?: number
          name: string
          price?: number
          reserved_stock?: number
          sku?: string | null
          stock?: number
          updated_at?: string
          wholesale_price: number
        }
        Update: {
          active?: boolean
          available_stock?: number | null
          category_id?: string | null
          cost_price?: number
          created_at?: string
          id?: string
          min_stock?: number
          name?: string
          price?: number
          reserved_stock?: number
          sku?: string | null
          stock?: number
          updated_at?: string
          wholesale_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
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
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      routes: {
        Row: {
          closed_at: string | null
          courier_id: string
          created_at: string
          date: string
          dispatched_at: string | null
          id: string
        }
        Insert: {
          closed_at?: string | null
          courier_id: string
          created_at?: string
          date?: string
          dispatched_at?: string | null
          id?: string
        }
        Update: {
          closed_at?: string | null
          courier_id?: string
          created_at?: string
          date?: string
          dispatched_at?: string | null
          id?: string
        }
        Relationships: []
      }
      sale_items: {
        Row: {
          created_at: string
          id: string
          product_id: string | null
          product_name: string
          quantity: number
          sale_id: string
          total: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          product_id?: string | null
          product_name: string
          quantity?: number
          sale_id: string
          total?: number
          unit_price?: number
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          sale_id?: string
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_status_history: {
        Row: {
          attachment_url: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["order_status"] | null
          id: number
          reason: string | null
          sale_id: string
          to_status: Database["public"]["Enums"]["order_status"]
          user_id: string | null
        }
        Insert: {
          attachment_url?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["order_status"] | null
          id?: never
          reason?: string | null
          sale_id: string
          to_status: Database["public"]["Enums"]["order_status"]
          user_id?: string | null
        }
        Update: {
          attachment_url?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["order_status"] | null
          id?: never
          reason?: string | null
          sale_id?: string
          to_status?: Database["public"]["Enums"]["order_status"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_status_history_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          courier_id: string | null
          created_at: string
          customer_id: string | null
          delivery_address: string | null
          delivery_fee: number
          discount: number
          fee_due: boolean
          id: string
          neighborhood: string | null
          offer_id: string | null
          payment_method: string
          proof_url: string | null
          reason: string | null
          route_id: string | null
          sale_number: number
          scheduled_for: string | null
          seller_id: string | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          courier_id?: string | null
          created_at?: string
          customer_id?: string | null
          delivery_address?: string | null
          delivery_fee?: number
          discount?: number
          fee_due?: boolean
          id?: string
          neighborhood?: string | null
          offer_id?: string | null
          payment_method?: string
          proof_url?: string | null
          reason?: string | null
          route_id?: string | null
          sale_number?: number
          scheduled_for?: string | null
          seller_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Update: {
          courier_id?: string | null
          created_at?: string
          customer_id?: string | null
          delivery_address?: string | null
          delivery_fee?: number
          discount?: number
          fee_due?: boolean
          id?: string
          neighborhood?: string | null
          offer_id?: string | null
          payment_method?: string
          proof_url?: string | null
          reason?: string | null
          route_id?: string | null
          sale_number?: number
          scheduled_for?: string | null
          seller_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          id: number
          kind: Database["public"]["Enums"]["stock_move"]
          note: string | null
          product_id: string
          quantity: number
          sale_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: never
          kind: Database["public"]["Enums"]["stock_move"]
          note?: string | null
          product_id: string
          quantity: number
          sale_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: never
          kind?: Database["public"]["Enums"]["stock_move"]
          note?: string | null
          product_id?: string
          quantity?: number
          sale_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
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
      close_route: { Args: { p_route: string }; Returns: Json }
      create_order: {
        Args: {
          p_address?: string
          p_counter_sale?: boolean
          p_customer: string
          p_discount?: number
          p_items: Json
          p_neighborhood?: string
          p_offer?: string
          p_payment_method: string
        }
        Returns: {
          courier_id: string | null
          created_at: string
          customer_id: string | null
          delivery_address: string | null
          delivery_fee: number
          discount: number
          fee_due: boolean
          id: string
          neighborhood: string | null
          offer_id: string | null
          payment_method: string
          proof_url: string | null
          reason: string | null
          route_id: string | null
          sale_number: number
          scheduled_for: string | null
          seller_id: string | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sales"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_has_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      customer_stats: { Args: { p_customer: string }; Returns: Json }
      dispatch_route: { Args: { p_route: string }; Returns: number }
      financial_by_offer: {
        Args: { p_from: string; p_to: string }
        Returns: {
          ad_cost: number
          courier_cost: number
          offer_id: string
          offer_name: string
          orders: number
          product_cost: number
          revenue: number
        }[]
      }
      financial_summary: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_courier: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      ltv_by_acquisition: {
        Args: never
        Returns: {
          avg_ltv: number
          avg_orders: number
          customers: number
          offer_id: string
          offer_name: string
          total_revenue: number
        }[]
      }
      meta_settings_status: { Args: never; Returns: Json }
      offer_performance: {
        Args: { p_from: string; p_to: string }
        Returns: {
          clicks: number
          conversations: number
          customers: number
          offer_id: string
          offer_name: string
          revenue: number
          sales_count: number
          spend: number
        }[]
      }
      open_route_for: { Args: { p_courier: string }; Returns: string }
      organic_offer_match: {
        Args: { p_from: string; p_to: string }
        Returns: {
          customers: number
          offer_id: string
          offer_name: string
          revenue: number
          sales_count: number
        }[]
      }
      organic_performance: {
        Args: { p_from: string; p_to: string }
        Returns: {
          customers: number
          revenue: number
          sales_count: number
        }[]
      }
      route_day_summary: {
        Args: { p_date?: string }
        Returns: {
          cash_collected: number
          closed_at: string
          courier_id: string
          delivered: number
          dispatched_at: string
          fee_payable: number
          not_delivered: number
          pending: number
          route_id: string
          stops: number
        }[]
      }
      route_payment_breakdown: {
        Args: { p_from: string; p_to: string }
        Returns: {
          amount: number
          courier_id: string
          payment_method: string
          transactions: number
        }[]
      }
      route_range_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          cash_collected: number
          courier_id: string
          delivered: number
          fee_payable: number
          not_delivered: number
          pending: number
          stops: number
        }[]
      }
      save_meta_settings: {
        Args: { p_account: string; p_token?: string }
        Returns: Json
      }
      transition_sale: {
        Args: {
          p_proof?: string
          p_reason?: string
          p_sale: string
          p_schedule?: string
          p_to: Database["public"]["Enums"]["order_status"]
        }
        Returns: {
          courier_id: string | null
          created_at: string
          customer_id: string | null
          delivery_address: string | null
          delivery_fee: number
          discount: number
          fee_due: boolean
          id: string
          neighborhood: string | null
          offer_id: string | null
          payment_method: string
          proof_url: string | null
          reason: string | null
          route_id: string | null
          sale_number: number
          scheduled_for: string | null
          seller_id: string | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sales"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role: "admin" | "vendedor" | "attendant" | "stockist" | "courier"
      customer_type: "retail" | "wholesale"
      order_status:
        | "new"
        | "picked"
        | "on_route"
        | "delivered"
        | "scheduled"
        | "not_delivered"
        | "cancelled"
      stock_move: "inbound" | "adjustment" | "reserve" | "release" | "writeoff"
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
      app_role: ["admin", "vendedor", "attendant", "stockist", "courier"],
      customer_type: ["retail", "wholesale"],
      order_status: [
        "new",
        "picked",
        "on_route",
        "delivered",
        "scheduled",
        "not_delivered",
        "cancelled",
      ],
      stock_move: ["inbound", "adjustment", "reserve", "release", "writeoff"],
    },
  },
} as const
