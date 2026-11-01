const WINDOW_MS=15*60*1000,MAX_FAILURES=10
// Per-instance best-effort throttling; never stores PINs or raw request bodies.
const attempts=new Map<string,{count:number;until:number}>()
export function retryAfter(identity:string,now=Date.now()){
 const row=attempts.get(identity)
 if(!row||row.until<=now){attempts.delete(identity);return 0}
 return row.count>=MAX_FAILURES?Math.max(1,Math.ceil((row.until-now)/1000)):0
}
export function recordFailure(identity:string,now=Date.now()){
 for(const [key,row]of attempts)if(row.until<=now)attempts.delete(key)
 if(attempts.size>=10000&&!attempts.has(identity))attempts.delete(attempts.keys().next().value!)
 const row=attempts.get(identity)
 attempts.set(identity,row&&row.until>now?{...row,count:row.count+1}:{count:1,until:now+WINDOW_MS})
}
export function clearFailures(identity:string){attempts.delete(identity)}
