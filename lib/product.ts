export type Product = {
  id: string
  name: string
  category: string
  is_imported?: boolean | null
  productType?: 'retail' | 'processed' | 'ingredient'
  price: number
  cost?: number
  costPrice?: number
  barcode?: string
  imageUrl?: string
  stock?: number
  accent: string
  tag: string
  brand?: string
  distributor?: string
  unit?: string
}
