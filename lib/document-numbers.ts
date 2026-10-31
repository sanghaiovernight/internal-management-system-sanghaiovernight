/** Display-only helpers: UUIDs remain exclusively database keys and mutation arguments. */
function parts(value:string) {
  const date=new Date(value)
  if(Number.isNaN(date.getTime())) return null
  return Object.fromEntries(new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map((part)=>[part.type,part.value]))
}
export function formatVietnamTimestamp(value:string) {
  const p=parts(value)
  return p?`${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`:'—'
}
export function shortDocumentNumber(prefix:'PN'|'HD',date:string,...candidates:(string|null|undefined)[]) {
  const p=parts(date)
  if(!p)return `${prefix}—`
  const stem=`${prefix}${p.day}${p.month}`
  return candidates.find((code)=>typeof code==='string'&&new RegExp(`^${stem}[0-9]{3,}$`).test(code))??`${stem}—`
}
