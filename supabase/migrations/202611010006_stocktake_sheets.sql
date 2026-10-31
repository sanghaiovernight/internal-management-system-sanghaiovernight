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

create or replace function public.pos_complete_stock_check(p_request_id uuid,p_lines jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare sheet public.pos_stock_checks%rowtype;product public.pos_products%rowtype;line jsonb;entry jsonb;planned jsonb:='[]'::jsonb;
 actual numeric;delta numeric;unit_cost numeric;new_cost numeric;total_up numeric:=0;total_down numeric:=0;n bigint;code text;
 day date:=(now() at time zone 'Asia/Ho_Chi_Minh')::date;found_products integer:=0;
begin
 if p_request_id is null or p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 1000 then raise exception 'Phiếu kiểm kho không hợp lệ'; end if;
 perform pg_advisory_xact_lock(hashtextextended('stock-check:'||p_request_id::text,0));
 select * into sheet from public.pos_stock_checks where id=p_request_id;
 if found then
  if sheet.payload<>p_lines then raise exception 'Mã phiếu đã dùng cho nội dung khác'; end if;
  return jsonb_build_object('sheet',to_jsonb(sheet),'products',coalesce((select jsonb_agg(jsonb_build_object('id',id,'stock',stock,'cost_price',cost_price)) from public.pos_products where id::text in(select x->>'product_id' from jsonb_array_elements(sheet.lines)x)),'[]'::jsonb));
 end if;
 if exists(select 1 from jsonb_array_elements(p_lines)x group by x->>'product_id' having count(*)>1) then raise exception 'Mặt hàng trong phiếu bị lặp'; end if;
 -- Lock every selected product first; a conflict on any line aborts the whole sheet.
 for product in select * from public.pos_products where id::text in(select x->>'product_id' from jsonb_array_elements(p_lines)x) order by id for update loop
  found_products:=found_products+1;
  select x into line from jsonb_array_elements(p_lines)x where x->>'product_id'=product.id::text;
  if line->>'actual_stock' is null then continue; end if;
  actual:=(line->>'actual_stock')::numeric;
  if actual::text in('NaN','Infinity','-Infinity') or actual<0 or actual>999999999 or actual<>trunc(actual) then raise exception '%: tồn thực tế phải là số nguyên từ 0 đến 999.999.999',product.name; end if;
  if coalesce(product.stock,0) is distinct from (line->>'expected_stock')::numeric or coalesce(product.cost_price,0) is distinct from (line->>'expected_cost')::numeric or coalesce(product.is_imported,false) is distinct from (line->>'expected_is_imported')::boolean then raise exception '%: tồn, giá vốn hoặc loại hàng đã thay đổi. Hãy tải lại dữ liệu kiểm kho',product.name; end if;
  delta:=actual-coalesce(product.stock,0);
  if delta=0 then continue; end if;
  new_cost:=coalesce(product.cost_price,0);unit_cost:=null;
  if new_cost::text in('NaN','Infinity','-Infinity') or new_cost<0 then raise exception '%: giá vốn hiện tại không hợp lệ',product.name; end if;
  if delta>0 and product.is_imported is true then
   unit_cost:=(line->>'unit_cost')::numeric;
   if unit_cost is null or unit_cost::text in('NaN','Infinity','-Infinity') or unit_cost<0 or unit_cost>999999999999 or unit_cost<>trunc(unit_cost) then raise exception '%: bắt buộc nhập giá vốn phần tăng từ 0 đến 999.999.999.999',product.name; end if;
   new_cost:=round((greatest(0,coalesce(product.stock,0))*new_cost+delta*unit_cost)/(greatest(0,coalesce(product.stock,0))+delta));
  end if;
  if delta>0 then total_up:=total_up+delta;else total_down:=total_down-delta;end if;
  planned:=planned||jsonb_build_array(jsonb_build_object('product_id',product.id,'name',product.name,'stock_before',coalesce(product.stock,0),'stock_after',actual,'cost_before',coalesce(product.cost_price,0),'cost_after',new_cost,'is_imported',coalesce(product.is_imported,false),'unit_cost',unit_cost,'delta',delta));
 end loop;
 if found_products<>jsonb_array_length(p_lines) then raise exception 'Có mặt hàng đã bị xóa hoặc không có quyền truy cập'; end if;
 if jsonb_array_length(planned)=0 then raise exception 'Phiếu không có mặt hàng chênh lệch'; end if;
 perform pg_advisory_xact_lock(hashtextextended('stock-check-day:'||day::text,0));
 select count(*)+1 into n from public.pos_stock_checks where check_day=day;
 loop
  code:='KK'||to_char(day,'DDMM')||lpad(n::text,greatest(3,length(n::text)),'0');
  exit when not exists(select 1 from public.pos_stock_checks where check_day=day and check_no=code);n:=n+1;
 end loop;
 insert into public.pos_stock_checks(id,check_no,check_day,payload,lines,total_increase,total_decrease) values(p_request_id,code,day,p_lines,planned,total_up,total_down) returning * into sheet;
 perform set_config('pos.event_kind','check',true);perform set_config('pos.check_id',p_request_id::text,true);perform set_config('pos.receipt_id','',true);
 for entry in select value from jsonb_array_elements(planned) loop
  perform set_config('pos.import_total',case when entry->>'unit_cost' is not null then ((entry->>'delta')::numeric*(entry->>'unit_cost')::numeric)::text else '' end,true);
  update public.pos_products set stock=(entry->>'stock_after')::numeric,cost_price=(entry->>'cost_after')::numeric where id::text=entry->>'product_id';
  if not found then raise exception 'Không có quyền cập nhật một mặt hàng trong phiếu'; end if;
 end loop;
 perform set_config('pos.event_kind','',true);perform set_config('pos.check_id','',true);perform set_config('pos.import_total','',true);
 return jsonb_build_object('sheet',to_jsonb(sheet),'products',coalesce((select jsonb_agg(jsonb_build_object('id',id,'stock',stock,'cost_price',cost_price)) from public.pos_products where id::text in(select x->>'product_id' from jsonb_array_elements(planned)x)),'[]'::jsonb));
end; $$;
revoke all on function public.pos_complete_stock_check(uuid,jsonb) from public;
grant execute on function public.pos_complete_stock_check(uuid,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
