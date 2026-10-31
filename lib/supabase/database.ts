import type { ReceiptSettings, ReceiptOrder } from '@/lib/receipts'

// Application contract. Keep in sync with supabase/migrations and the existing POS schema.
type Table<Row, Insert = Partial<Row>> = { Row: Row; Insert: Insert; Update: Partial<Row>; Relationships: [] }
export type Database = {
  public: {
    Tables: {
      pos_receipt_settings: Table<ReceiptSettings & {id:string}>
      pos_orders: Table<ReceiptOrder>
      pos_stock_imports: Table<{ receipt_no:string; id: string; product_id: string; product_name: string; quantity: number; unit_cost: number; total_cost: number; created_at: string; stock_before: number; cost_before: number; cost_after: number; auto_expense: boolean; voided_at: string | null; reversible: boolean }>
      pos_expenses: Table<{ id: string; description: string; amount: number; spent_at: string }>
      pos_categories: Table<{ name: string; created_at: string }, { name: string }>
      pos_products: Table<{
        id: string; name: string; category: string; tag: string | null; product_type: string | null;
        is_imported: boolean | null; price: number; cost_price: number | null; stock: number | null; barcode: string | null;
      }>
    }
    Views: { [_ in never]: never }
    Functions: {
      pos_checkout_order: {Args:{p_request_id:string;p_items:{id:string;name:string;quantity:number;price:number;note:string;category:string}[];p_total:number;p_method:string;p_receipt:{cash_received:number|null;settings:ReceiptSettings;qr_url?:string|null}};Returns:{products:{id:string;stock:number;cost_price:number}[];order:ReceiptOrder}}
      pos_adjust_order: {Args:{p_order_id:string;p_action:'void'|'refund';p_quantities:{line_id:string;quantity:number}[];p_request_id:string;p_expected_version:number};Returns:{products:{id:string;stock:number;cost_price:number}[];order:ReceiptOrder}}
      pos_checkout_receipt: { Args: { p_code:string; p_items:{id:string;name:string;quantity:number;price:number;note:string;category:string}[];p_total:number;p_method:string;p_date_time:string;p_receipt:{cash_received:number|null;settings:ReceiptSettings;qr_url:string|null} }; Returns: {products:{id:string;stock:number;cost_price:number}[];order:ReceiptOrder} }
      pos_receive_stock_v2: {
        Args: { p_product_id: string; p_quantity: number; p_total: number; p_auto_expense: boolean; p_receipt_id: string }
        Returns: { stock: number; cost_price: number; receipt: { id: string; product_id: string; product_name: string; quantity: number; unit_cost: number; total_cost: number; created_at: string; reversible: boolean } }
      }
      pos_void_stock_import: { Args: { p_id: string }; Returns: { product_id: string; stock: number; cost_price: number } }
      pos_delete_category: { Args: { p_name: string }; Returns: undefined }
      pos_checkout: { Args: { p_code: string; p_items: { id: string; quantity: number; price: number; name: string; category: string; note: string }[]; p_total: number; p_method: string; p_date_time: string }; Returns: { products: { id: string; stock: number; cost_price: number }[] } }
      pos_receive_stock: {
        Args: { p_product_id: string; p_quantity: number; p_total: number; p_auto_expense: boolean; p_receipt_id: string }
        Returns: { stock: number; cost_price: number; receipt_id: string }
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
