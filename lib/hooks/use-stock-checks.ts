'use client'
import useSWR from 'swr'
import {getSupabaseClient} from '@/lib/supabase/client'
import type {StocktakeSheet} from '@/lib/stocktake'
export function useStockChecks(){
 const {data,error,isLoading,mutate}=useSWR<StocktakeSheet[]>('pos-stock-checks',async()=>{
  const {data,error}=await getSupabaseClient().from('pos_stock_checks').select('*').order('created_at',{ascending:false}).limit(1000)
  if(error)throw error
  return (data??[]) as StocktakeSheet[]
 },{refreshInterval:30000})
 const remember=(sheet:StocktakeSheet)=>mutate((current)=>[sheet,...(current??[]).filter((row)=>row.id!==sheet.id)],{revalidate:false})
 return {checks:data??[],error,isLoading,remember}
}
