import {test} from 'node:test'
import assert from 'node:assert/strict'
import {SESSION_SECONDS,internalPin,pinMatches,createSession,validSession,cookieOptions} from '../lib/auth-session.ts'
import {retryAfter,recordFailure,clearFailures} from '../lib/login-throttle.ts'
test('PIN configuration stays server-side, falls back as requested and compares exact values',()=>{
 const previous=process.env.POS_INTERNAL_PIN
 try{delete process.env.POS_INTERNAL_PIN;assert.equal(internalPin(),'44448888');assert.equal(pinMatches('44448888'),true);assert.equal(pinMatches(44448888),false)
  process.env.POS_INTERNAL_PIN='91827364';assert.equal(pinMatches('44448888'),false);assert.equal(pinMatches('91827364'),true);assert.equal(pinMatches('91827364 '),false)
 }finally{if(previous===undefined)delete process.env.POS_INTERNAL_PIN;else process.env.POS_INTERNAL_PIN=previous}
})
test('signed sessions last exactly 90 days and reject forged, expired and malformed cookies',()=>{
 const token=createSession(1000)
 assert.equal(validSession(token,1000),true);assert.equal(validSession(token,1000+SESSION_SECONDS-1),true);assert.equal(validSession(token,1000+SESSION_SECONDS),false)
 for(const invalid of ['',undefined,'yes','44448888',token+'.extra',token.slice(0,-3)+'abc',Buffer.from(JSON.stringify({exp:99999999999})).toString('base64url')+'.fake','x'.repeat(10000)])assert.equal(validSession(invalid,1000),false)
 assert.notEqual(createSession(1000),token)
})
test('rotating the configured PIN invalidates existing device cookies',()=>{
 const previous=process.env.POS_INTERNAL_PIN
 try{process.env.POS_INTERNAL_PIN='12345678';const token=createSession(1000);process.env.POS_INTERNAL_PIN='87654321';assert.equal(validSession(token,1000),false)}finally{if(previous===undefined)delete process.env.POS_INTERNAL_PIN;else process.env.POS_INTERNAL_PIN=previous}
})
test('cookies are HttpOnly, SameSite Lax, scoped to root and Secure in production',()=>{
 const previous=process.env.NODE_ENV
 try{process.env.NODE_ENV='production';assert.deepEqual(cookieOptions(),{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:7776000});process.env.NODE_ENV='development';assert.equal(cookieOptions().secure,false)}finally{process.env.NODE_ENV=previous}
})
test('failed PIN attempts throttle an identity temporarily and successful login clears failures',()=>{
 const key='unit-test-device';clearFailures(key)
 for(let i=0;i<10;i++)recordFailure(key,1000)
 assert.equal(retryAfter(key,1000),900);assert.equal(retryAfter(key,901000),0)
 recordFailure(key,902000);clearFailures(key);assert.equal(retryAfter(key,902000),0)
})


test('same-origin checks work behind a hostname-normalizing proxy and reject other sites',async()=>{
 const {sameOriginRequest}=await import('../lib/request-origin.ts')
 const request={url:'http://localhost:3000/api/auth/login',headers:new Headers({host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','x-forwarded-proto':'http'})}
 assert.equal(sameOriginRequest(request),true)
 request.headers.set('origin','https://untrusted.example');assert.equal(sameOriginRequest(request),false)
 request.headers.set('origin','null');assert.equal(sameOriginRequest(request),false)
 request.headers.delete('origin');request.headers.set('sec-fetch-site','cross-site');assert.equal(sameOriginRequest(request),false)
})

test('Vercel forwarded public host is used instead of the internal server host',async()=>{
 const {sameOriginRequest}=await import('../lib/request-origin.ts')
 const request={url:'http://localhost:3000/api/auth/login',headers:new Headers({host:'internal.vercel.local',origin:'https://pos.shop.example','x-forwarded-host':'pos.shop.example','x-forwarded-proto':'https'})}
 assert.equal(sameOriginRequest(request),true)
 request.headers.set('x-forwarded-host','pos.shop.example, internal.vercel.local');assert.equal(sameOriginRequest(request),true)
 request.headers.set('origin','https://untrusted.example');assert.equal(sameOriginRequest(request),false)
 request.headers.set('origin','http://pos.shop.example');assert.equal(sameOriginRequest(request),false)
 request.headers.set('origin','https://pos.shop.example');request.headers.set('sec-fetch-site','cross-site');assert.equal(sameOriginRequest(request),false)
})
test('browser same-origin metadata survives proxy rewrites without allowing cross-site or opaque requests',async()=>{
 const {sameOriginRequest}=await import('../lib/request-origin.ts')
 const request={url:'http://localhost/api/auth/login',headers:new Headers({host:'localhost',origin:'https://pos.shop.example','sec-fetch-site':'same-origin'})}
 assert.equal(sameOriginRequest(request),true)
 request.headers.set('sec-fetch-site','same-site');assert.equal(sameOriginRequest(request),false)
 request.headers.set('sec-fetch-site','cross-site');assert.equal(sameOriginRequest(request),false)
 request.headers.set('sec-fetch-site','same-origin');request.headers.set('origin','null');assert.equal(sameOriginRequest(request),false)
 request.headers.set('origin','https://pos.shop.example/path');assert.equal(sameOriginRequest(request),false)
})
