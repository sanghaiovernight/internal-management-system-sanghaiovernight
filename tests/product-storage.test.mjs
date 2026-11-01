import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
test('product image bucket migration is repeatable and upload policy limits folders/buckets',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`create role anon;create role authenticated;create schema storage;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(bucket_id text references storage.buckets(id),name text,primary key(bucket_id,name));
   alter table storage.objects enable row level security;
   create function storage.foldername(text) returns text[] language sql immutable as 'select string_to_array($1,''/'')';
   grant usage on schema storage to anon,authenticated;grant select,insert on storage.objects to anon,authenticated;`)
  const sql=await readFile(new URL('../supabase/manual/202611010007/03_image_storage.sql',import.meta.url),'utf8')
  await db.exec(sql);await db.exec(sql)
  const bucket=(await db.query("select * from storage.buckets where id='product-images'")).rows[0]
  assert.equal(bucket.public,true);assert.equal(Number(bucket.file_size_limit),1048576);assert.deepEqual(bucket.allowed_mime_types,['image/webp'])
  await db.exec("insert into storage.buckets(id,name) values('other','other');set role anon")
  await db.exec("insert into storage.objects(bucket_id,name) values('product-images','products/test.webp')")
  assert.equal((await db.query('select * from storage.objects')).rows.length,1)
  await assert.rejects(db.exec("insert into storage.objects(bucket_id,name) values('product-images','private/test.webp')"),/row-level security/)
  await assert.rejects(db.exec("insert into storage.objects(bucket_id,name) values('other','products/test.webp')"),/row-level security/)
 }finally{await db.close()}
})
