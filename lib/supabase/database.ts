// Application contract. Keep in sync with supabase/migrations and the existing POS schema.
type Table<Row, Insert = Partial<Row>> = { Row: Row; Insert: Insert; Update: Partial<Row>; Relationships: [] }
export type Database = {
  public: {
    Tables: {
      pos_expenses: Table<{ id: string; description: string; amount: number; spent_at: string }>
      pos_categories: Table<{ name: string; created_at: string }, { name: string }>
      pos_products: Table<{
        id: string; name: string; category: string; tag: string | null; product_type: string | null;
        price: number; cost_price: number | null; stock: number | null; barcode: string | null;
      }>
    }
    Views: { [_ in never]: never }
    Functions: {
      pos_receive_stock: {
        Args: { p_product_id: string; p_quantity: number; p_total: number; p_auto_expense: boolean; p_receipt_id: string }
        Returns: { stock: number; cost_price: number; receipt_id: string }
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
