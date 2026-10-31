import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from './database'

let browserClient: SupabaseClient<Database> | undefined

export function getSupabaseClient() {
  if (!browserClient) {
    browserClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
  }

  return browserClient
}
