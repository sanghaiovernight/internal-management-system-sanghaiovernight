begin;

alter table public.pos_stock_imports add column if not exists receipt_no text;
alter table public.pos_stock_imports add column if not exists receipt_day date;
update public.pos_stock_imports set receipt_day=(created_at at time zone 'Asia/Ho_Chi_Minh')::date where receipt_day is null;
-- Historical imports keep their UUID identity; only a human-readable number is added.
with numbered as (
 select id,receipt_day,row_number() over(partition by receipt_day order by created_at,id) as n
 from public.pos_stock_imports
)
update public.pos_stock_imports p set receipt_no='PN'||to_char(n.receipt_day,'DDMM')||lpad(n.n::text,greatest(3,length(n.n::text)),'0')
from numbered n where p.id=n.id and p.receipt_no is null;
create unique index if not exists pos_stock_imports_day_number_key on public.pos_stock_imports(receipt_day,receipt_no);

create or replace function public.pos_assign_import_number() returns trigger
language plpgsql security invoker set search_path='' as $$
declare day date:=(new.created_at at time zone 'Asia/Ho_Chi_Minh')::date; n bigint; code text;
begin
 perform pg_advisory_xact_lock(hashtextextended('import-day:'||day::text,0));
 select count(*)+1 into n from public.pos_stock_imports where receipt_day=day;
 loop
  code:='PN'||to_char(day,'DDMM')||lpad(n::text,greatest(3,length(n::text)),'0');
  exit when not exists(select 1 from public.pos_stock_imports where receipt_day=day and receipt_no=code);
  n:=n+1;
 end loop;
 new.receipt_day:=day; new.receipt_no:=code;
 return new;
end; $$;
drop trigger if exists pos_import_number on public.pos_stock_imports;
create trigger pos_import_number before insert on public.pos_stock_imports for each row execute function public.pos_assign_import_number();

-- Preserve old bill/QR snapshots. This alias is for activity display only.
alter table public.pos_orders add column if not exists activity_receipt_no text;
update public.pos_orders set activity_receipt_no=receipt_no
where activity_receipt_no is null and receipt_no ~ ('^HD'||to_char((created_at at time zone 'Asia/Ho_Chi_Minh')::date,'DDMM')||'[0-9]{3,}$');
do $$
declare bill record; code text; n bigint; day date;
begin
 for bill in select id,created_at from public.pos_orders where activity_receipt_no is null order by created_at,id loop
  day:=(bill.created_at at time zone 'Asia/Ho_Chi_Minh')::date; n:=1;
  loop
   code:='HD'||to_char(day,'DDMM')||lpad(n::text,greatest(3,length(n::text)),'0');
   exit when not exists(select 1 from public.pos_orders where (created_at at time zone 'Asia/Ho_Chi_Minh')::date=day and activity_receipt_no=code);
   n:=n+1;
  end loop;
  update public.pos_orders set activity_receipt_no=code where id=bill.id;
 end loop;
end; $$;
create unique index if not exists pos_orders_activity_number_key on public.pos_orders(((created_at at time zone 'Asia/Ho_Chi_Minh')::date),activity_receipt_no);
create or replace function public.pos_sync_activity_number() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.receipt_no ~ ('^HD'||to_char((new.created_at at time zone 'Asia/Ho_Chi_Minh')::date,'DDMM')||'[0-9]{3,}$') then new.activity_receipt_no:=new.receipt_no; end if;
 return new;
end; $$;
drop trigger if exists pos_activity_number on public.pos_orders;
create trigger pos_activity_number before insert or update of receipt_no on public.pos_orders for each row execute function public.pos_sync_activity_number();
notify pgrst,'reload schema';
commit;
