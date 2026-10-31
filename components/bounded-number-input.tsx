'use client'

import { formatNumber } from '@/lib/stocktake'
export default function BoundedNumberInput({value,onValue,max,...props}:Omit<React.InputHTMLAttributes<HTMLInputElement>,'value'|'onChange'|'type'|'max'> & {value:string;onValue:(value:string)=>void;max:number}) {
  return <input {...props} type="text" inputMode="numeric" maxLength={formatNumber(max).length} title={`Tối đa ${formatNumber(max)}`} value={value===''?'':formatNumber(Number(value))} onChange={(event)=>{
    const raw=event.target.value.replace(/[.\s]/g,'')
    if(!/^\d*$/.test(raw)||raw.length>String(max).length||Number(raw)>max)return
    onValue(raw)
  }}/>
}
