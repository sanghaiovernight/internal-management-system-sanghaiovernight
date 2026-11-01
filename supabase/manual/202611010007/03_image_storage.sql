begin;
-- A missing Storage extension is supported: the client persists a compressed data URL.
do $$ begin
 if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
  execute $q$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('product-images','product-images',true,1048576,array['image/webp'])
   on conflict(id) do update set public=true,file_size_limit=1048576,allowed_mime_types=array['image/webp']$q$;
  execute 'drop policy if exists pos_product_images_read on storage.objects';
  execute 'create policy pos_product_images_read on storage.objects for select to anon,authenticated using(bucket_id=''product-images'')';
  execute 'drop policy if exists pos_product_images_insert on storage.objects';
  execute 'create policy pos_product_images_insert on storage.objects for insert to anon,authenticated with check(bucket_id=''product-images'' and (storage.foldername(name))[1]=''products'')';
 end if;
end; $$;
notify pgrst,'reload schema';
commit;
