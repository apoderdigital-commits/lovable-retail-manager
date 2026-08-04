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
      customers: {
        Row: {
          address: string | null
          created_at: string
          customer_type: Database["public"]["Enums"]["customer_type"]
          document: string | null
          email: string | null
          id: string
          name: string
          neighborhood: string | null
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          customer_type?: Database["public"]["Enums"]["customer_type"]
          document?: string | null
          email?: string | null
          id?: string
          name: string
          neighborhood?: string | null
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          customer_type?: Database["public"]["Enums"]["customer_type"]
          document?: string | null
          email?: string | null
          id?: string
          name?: string
          neighborhood?: string | null
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          active: boolean
          available_stock: number
          category: string | null
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
          category?: string | null
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
          category?: string | null
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
        Relationships: []
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
            foreignKeyName: "sales_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
        ]
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
          id?: number
          reason?: string | null
          sale_id: string
          to_status: Database["public"]["Enums"]["order_status"]
          user_id?: string | null
        }
        Update: {
          attachment_url?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["order_status"] | null
          id?: number
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
          id?: number
          kind: Database["public"]["Enums"]["stock_move"]
          note?: string | null
          product_id: string
          quantity: number
          sale_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: number
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
      close_route: {
        Args: { p_route: string }
        Returns: Json
      }
      create_order: {
        Args: {
          p_address?: string | null
          p_counter_sale?: boolean
          p_customer: string | null
          p_discount?: number
          p_items: Json
          p_neighborhood?: string | null
          p_payment_method: string
        }
        Returns: Database["public"]["Tables"]["sales"]["Row"]
      }
      current_has_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      dispatch_route: {
        Args: { p_route: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_courier: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_staff: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      transition_sale: {
        Args: {
          p_proof?: string | null
          p_reason?: string | null
          p_sale: string
          p_schedule?: string | null
          p_to: Database["public"]["Enums"]["order_status"]
        }
        Returns: Database["public"]["Tables"]["sales"]["Row"]
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
      stock_move:
        | "inbound"
        | "adjustment"
        | "reserve"
        | "release"
        | "writeoff"
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
