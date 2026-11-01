begin;
alter table public.pos_products add column if not exists image_url text;
-- Replace legacy type restrictions, retaining the existing inventory flag when backfilling.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.pos_products'::regclass and contype='c' and pg_get_constraintdef(oid) ~ '\mproduct_type\M' loop
  execute format('alter table public.pos_products drop constraint %I',c.conname);
 end loop;
end; $$;
update public.pos_products set product_type=case when product_type='ingredient' then 'ingredient' when is_imported is true then 'retail' else 'processed' end;
update public.pos_products set is_imported=true,price=0 where product_type='ingredient';
alter table public.pos_products add constraint pos_products_kind_check check(product_type in('retail','processed','ingredient'));
create or replace function public.pos_normalize_product_kind() returns trigger language plpgsql set search_path='' as $$
begin
 if new.product_type='ingredient' then new.is_imported:=true;new.price:=0;
 elsif new.product_type='processed' then new.is_imported:=false;
 elsif new.product_type='retail' then new.is_imported:=true;
 else new.product_type:=case when new.is_imported is true then 'retail' else 'processed' end;
 end if;
 return new;
end; $$;
drop trigger if exists pos_normalize_product_kind on public.pos_products;
create trigger pos_normalize_product_kind before insert or update of product_type,is_imported,price on public.pos_products for each row execute function public.pos_normalize_product_kind();
notify pgrst,'reload schema';
commit;
