begin;
create table if not exists public.pos_stock_checks (
 id uuid primary key,check_no text not null,check_day date not null,created_at timestamptz not null default now(),
 payload jsonb not null,lines jsonb not null,total_increase numeric not null,total_decrease numeric not null,
 unique(check_day,check_no)
);
alter table public.pos_stock_checks enable row level security;
drop policy if exists stock_checks_read on public.pos_stock_checks;
create policy stock_checks_read on public.pos_stock_checks for select to anon,authenticated using(true);
drop policy if exists stock_checks_insert on public.pos_stock_checks;
create policy stock_checks_insert on public.pos_stock_checks for insert to anon,authenticated with check(true);
grant select,insert on public.pos_stock_checks to anon,authenticated;
alter table public.pos_inventory_events add column if not exists check_id uuid references public.pos_stock_checks(id);
create index if not exists pos_inventory_events_check_idx on public.pos_inventory_events(check_id);
create or replace function public.pos_journal_inventory() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text:=coalesce(nullif(current_setting('pos.event_kind',true),''),'adjustment');
begin
 if kind='replay' then return new; end if;
 if kind<>'import' and old.stock is not distinct from new.stock and old.cost_price is not distinct from new.cost_price then return new; end if;
 insert into public.pos_inventory_events(product_id,kind,receipt_id,quantity,is_imported,total_cost,stock_before,cost_before,stock_after,cost_after,check_id)
 values(new.id::text,kind,nullif(current_setting('pos.receipt_id',true),''),coalesce(new.stock,0)-coalesce(old.stock,0),new.is_imported,
 nullif(current_setting('pos.import_total',true),'')::numeric,coalesce(old.stock,0),coalesce(old.cost_price,0),coalesce(new.stock,0),coalesce(new.cost_price,0),
 nullif(current_setting('pos.check_id',true),'')::uuid);
 return new;
end; $$;
revoke all on function public.pos_journal_inventory() from public;

notify pgrst,'reload schema';
commit;
