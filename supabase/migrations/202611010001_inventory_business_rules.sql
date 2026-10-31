begin;

-- Preserve explicit flags; only backfill records with no business type yet.
alter table public.pos_products add column if not exists is_imported boolean;
update public.pos_products set is_imported = coalesce(product_type = 'retail',false) where is_imported is null;
alter table public.pos_products alter column is_imported set default false;

create table if not exists public.pos_stock_imports (
  id uuid primary key,
  product_id text not null,
  product_name text not null,
  quantity integer not null,
  unit_cost numeric not null,
  total_cost numeric not null,
  created_at timestamptz not null default now()
);
alter table public.pos_stock_imports add column if not exists stock_before numeric;
alter table public.pos_stock_imports add column if not exists cost_before numeric;
alter table public.pos_stock_imports add column if not exists stock_after numeric;
alter table public.pos_stock_imports add column if not exists cost_after numeric;
alter table public.pos_stock_imports add column if not exists auto_expense boolean not null default false;
alter table public.pos_stock_imports add column if not exists voided_at timestamptz;
alter table public.pos_stock_imports add column if not exists reversible boolean not null default false;
alter table public.pos_stock_imports enable row level security;
drop policy if exists pos_stock_imports_app_read on public.pos_stock_imports;
create policy pos_stock_imports_app_read on public.pos_stock_imports for select to anon, authenticated using (true);
drop policy if exists pos_stock_imports_app_insert on public.pos_stock_imports;
create policy pos_stock_imports_app_insert on public.pos_stock_imports for insert to anon, authenticated with check (true);
drop policy if exists pos_stock_imports_app_update on public.pos_stock_imports;
create policy pos_stock_imports_app_update on public.pos_stock_imports for update to anon, authenticated using (true) with check (true);
grant select, insert, update on public.pos_stock_imports to anon, authenticated;

-- Retain legacy receipts for comparison. Their prior cost was not captured, so
-- never claim they can be reversed safely using an invented opening value.
insert into public.pos_stock_imports(id,product_id,product_name,quantity,unit_cost,total_cost,created_at,stock_after,cost_after,auto_expense,reversible)
select r.id,p.id,p.name,r.quantity,r.total/r.quantity,r.total,r.received_at,r.stock_after,r.cost_price,r.auto_expense,false
from public.pos_stock_receipts r join public.pos_products p on p.id::text = r.product_id::text
on conflict do nothing;

-- An immutable journal lets reversal replay later imports and sales, including rounding.
-- Manual stock counts are absolute adjustments; cost edits deliberately reset cost.
create table if not exists public.pos_inventory_events (
  seq bigint generated always as identity primary key,
  product_id text not null,
  kind text not null,
  receipt_id text,
  quantity numeric not null,
  is_imported boolean,
  total_cost numeric,
  stock_before numeric not null,
  cost_before numeric not null,
  stock_after numeric not null,
  cost_after numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists pos_inventory_events_product_idx on public.pos_inventory_events(product_id, seq);
alter table public.pos_inventory_events enable row level security;
drop policy if exists pos_inventory_events_read on public.pos_inventory_events;
create policy pos_inventory_events_read on public.pos_inventory_events for select to anon, authenticated using (true);
grant select on public.pos_inventory_events to anon, authenticated;

create or replace function public.pos_journal_inventory() returns trigger
language plpgsql security definer set search_path = '' as $$
declare kind text := coalesce(nullif(current_setting('pos.event_kind', true), ''), 'adjustment');
begin
  if kind = 'replay' then return new; end if;
  if kind <> 'import' and old.stock is not distinct from new.stock and old.cost_price is not distinct from new.cost_price then return new; end if;
  insert into public.pos_inventory_events(product_id, kind, receipt_id, quantity, is_imported, total_cost, stock_before, cost_before, stock_after, cost_after)
  values (new.id::text, kind, nullif(current_setting('pos.receipt_id', true), ''),
    coalesce(new.stock, 0) - coalesce(old.stock, 0), new.is_imported, nullif(current_setting('pos.import_total', true), '')::numeric,
    coalesce(old.stock, 0), coalesce(old.cost_price, 0), coalesce(new.stock, 0), coalesce(new.cost_price, 0));
  return new;
end; $$;
revoke all on function public.pos_journal_inventory() from public;
drop trigger if exists pos_inventory_journal on public.pos_products;
create trigger pos_inventory_journal after update of stock, cost_price on public.pos_products
for each row execute function public.pos_journal_inventory();

create or replace function public.pos_receive_stock_v2(
  p_product_id text, p_quantity integer, p_total numeric, p_auto_expense boolean, p_receipt_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  product public.pos_products%rowtype;
  receipt public.pos_stock_imports%rowtype;
  next_stock numeric; avg_cost numeric; weight_stock numeric;
begin
  if p_quantity is null or p_quantity <= 0 or p_total is null or p_total < 0 or p_total::text in ('NaN','Infinity','-Infinity') or p_receipt_id is null or p_auto_expense is null then
    raise exception 'Số lượng hoặc tổng tiền không hợp lệ';
  end if;
  select * into product from public.pos_products where id::text = p_product_id for update;
  if not found then raise exception 'Không tìm thấy sản phẩm hoặc không có quyền truy cập'; end if;
  select * into receipt from public.pos_stock_imports where id::text = p_receipt_id::text;
  if found then
    if receipt.product_id::text <> p_product_id or receipt.quantity <> p_quantity or receipt.total_cost <> p_total or receipt.auto_expense <> p_auto_expense or receipt.voided_at is not null then
      raise exception 'Mã phiếu đã được sử dụng hoặc đã bị xóa';
    end if;
    return jsonb_build_object('stock',product.stock,'cost_price',product.cost_price,'receipt',to_jsonb(receipt));
  end if;
  weight_stock := greatest(0, coalesce(product.stock,0));
  next_stock := coalesce(product.stock,0) + p_quantity;
  avg_cost := round((weight_stock * coalesce(product.cost_price,0) + p_total) / (weight_stock + p_quantity));
  perform set_config('pos.event_kind','import',true);
  perform set_config('pos.receipt_id',p_receipt_id::text,true);
  perform set_config('pos.import_total',p_total::text,true);
  update public.pos_products set stock = next_stock, cost_price = avg_cost where id = product.id;
  if not found then raise exception 'Không có quyền cập nhật sản phẩm'; end if;
  perform set_config('pos.event_kind','',true);
  perform set_config('pos.receipt_id','',true);
  perform set_config('pos.import_total','',true);
  insert into public.pos_stock_imports(id,product_id,product_name,quantity,unit_cost,total_cost,stock_before,cost_before,stock_after,cost_after,auto_expense,reversible)
    values(p_receipt_id,product.id,product.name,p_quantity,p_total/p_quantity,p_total,coalesce(product.stock,0),coalesce(product.cost_price,0),next_stock,avg_cost,p_auto_expense,true)
    returning * into receipt;
  if p_auto_expense and p_total > 0 then
    insert into public.pos_expenses(id,description,amount,spent_at)
    values(p_receipt_id,'Nhập hàng: ' || product.name || ' x ' || p_quantity::text,p_total,now());
  end if;
  return jsonb_build_object('stock',next_stock,'cost_price',avg_cost,'receipt',to_jsonb(receipt));
end; $$;

-- Old clients also receive the new cost rule after this migration.
create or replace function public.pos_receive_stock(p_product_id text,p_quantity integer,p_total numeric,p_auto_expense boolean,p_receipt_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
 select public.pos_receive_stock_v2(p_product_id,p_quantity,p_total,p_auto_expense,p_receipt_id);
$$;

create or replace function public.pos_void_stock_import(p_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  receipt public.pos_stock_imports%rowtype;
  product public.pos_products%rowtype;
  event public.pos_inventory_events%rowtype;
  replay_stock numeric; replay_cost numeric; started boolean := false;
begin
  -- Discover product then lock in the same product-first order as import/checkout.
  select * into receipt from public.pos_stock_imports where id::text = p_id::text;
  if not found then raise exception 'Không tìm thấy phiếu nhập'; end if;
  select * into product from public.pos_products where id::text = receipt.product_id::text for update;
  if not found then raise exception 'Không tìm thấy sản phẩm'; end if;
  select * into receipt from public.pos_stock_imports where id::text = p_id::text for update;
  if receipt.voided_at is not null then return jsonb_build_object('product_id',product.id,'stock',product.stock,'cost_price',product.cost_price); end if;
  if not receipt.reversible then raise exception 'Phiếu cũ chưa có dữ liệu đối chứng để hoàn tác an toàn'; end if;
  if not exists(select 1 from public.pos_inventory_events where receipt_id = p_id::text and kind = 'import') then raise exception 'Thiếu dữ liệu đối chứng của phiếu nhập'; end if;
  update public.pos_stock_imports set voided_at = now() where id::text = p_id::text;
  if not found then raise exception 'Không có quyền xóa phiếu nhập'; end if;
  for event in select * from public.pos_inventory_events where product_id = product.id::text order by seq loop
    if not started then replay_stock := event.stock_before; replay_cost := event.cost_before; started := true; end if;
    if event.kind = 'import' then
      if exists(select 1 from public.pos_stock_imports where id::text = event.receipt_id and voided_at is not null) then continue; end if;
      replay_cost := round((greatest(0,replay_stock) * replay_cost + event.total_cost)/(greatest(0,replay_stock)+event.quantity));
      replay_stock := replay_stock + event.quantity;
    elsif event.kind = 'sale' then
      if event.is_imported is true and replay_stock + event.quantity < 0 then
        raise exception 'Không thể xóa: hàng của phiếu đã được bán. Hãy xử lý các giao dịch liên quan trước';
      end if;
      replay_stock := greatest(0,replay_stock + event.quantity);
    else
      if event.stock_after <> event.stock_before then replay_stock := event.stock_after; end if;
      if event.cost_after <> event.cost_before then replay_cost := event.cost_after; end if;
    end if;
  end loop;
  perform set_config('pos.event_kind','replay',true);
  update public.pos_products set stock = replay_stock, cost_price = replay_cost where id = product.id;
  if not found then raise exception 'Không có quyền cập nhật sản phẩm'; end if;
  perform set_config('pos.event_kind','',true);
  if receipt.auto_expense and receipt.total_cost > 0 then
    delete from public.pos_expenses where id::text = p_id::text;
    if exists(select 1 from public.pos_expenses where id::text = p_id::text) then raise exception 'Không có quyền hoàn tác khoản chi của phiếu'; end if;
  end if;
  return jsonb_build_object('product_id',product.id,'stock',replay_stock,'cost_price',replay_cost);
end; $$;

insert into public.pos_categories(name) values ('Chưa phân loại') on conflict do nothing;
drop policy if exists pos_categories_delete on public.pos_categories;
create policy pos_categories_delete on public.pos_categories for delete to anon, authenticated using (name <> 'Chưa phân loại');
grant delete on public.pos_categories to anon, authenticated;
create or replace function public.pos_delete_category(p_name text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_name is null or btrim(p_name) = '' or p_name = 'Chưa phân loại' then raise exception 'Không thể xóa nhóm mặc định'; end if;
  insert into public.pos_categories(name) values ('Chưa phân loại') on conflict do nothing;
  -- Serialize deletion with other category deletions; product updates retain existing RLS.
  perform pg_advisory_xact_lock(hashtextextended('category:' || p_name,0));
  update public.pos_products set category = 'Chưa phân loại', tag = 'Chưa phân loại' where category = p_name;
  if exists(select 1 from public.pos_products where category = p_name) then raise exception 'Không có quyền chuyển nhóm cho tất cả mặt hàng'; end if;
  delete from public.pos_categories where name = p_name;
  if exists(select 1 from public.pos_categories where name = p_name) then raise exception 'Không có quyền xóa nhóm'; end if;
end; $$;

-- Validating and decrementing stock and inserting the bill happen in one transaction.
create or replace function public.pos_checkout(p_code text,p_items jsonb,p_total numeric,p_method text,p_date_time timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  product public.pos_products%rowtype;
  bill public.pos_transactions%rowtype;
  line record;
  updated_products jsonb := '[]'::jsonb;
  available_ids integer := 0; expected_ids integer;
  gross numeric := 0;
begin
  if p_code is null or btrim(p_code) = '' or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Giỏ hàng không hợp lệ'; end if;
  if p_total is null or p_total < 0 or p_total::text in ('NaN','Infinity','-Infinity') or p_method is null or p_method not in ('Tiền mặt','Chuyển khoản') or p_date_time is null then raise exception 'Thông tin thanh toán không hợp lệ'; end if;
  for line in select * from jsonb_to_recordset(p_items) as x(id text,quantity numeric,price numeric) loop
    if line.id is null or line.quantity is null or line.quantity <= 0 or line.quantity <> trunc(line.quantity) or line.quantity::text in ('NaN','Infinity','-Infinity') or line.price is null or line.price < 0 or line.price::text in ('NaN','Infinity','-Infinity') then raise exception 'Số lượng hoặc giá trong giỏ không hợp lệ'; end if;
    gross := gross + line.quantity * line.price;
  end loop;
  if p_total > gross then raise exception 'Tổng tiền không hợp lệ'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_code,0));
  select * into bill from public.pos_transactions where code = p_code;
  if found then
    if bill.total <> p_total or bill.method <> p_method or bill.items::jsonb <> p_items then raise exception 'Mã hóa đơn đã được sử dụng'; end if;
    return jsonb_build_object('products',coalesce((select jsonb_agg(jsonb_build_object('id',id,'stock',stock,'cost_price',cost_price)) from public.pos_products where id::text in (select x.id from jsonb_to_recordset(p_items) as x(id text))),'[]'::jsonb));
  end if;
  select count(distinct x.id) into expected_ids from jsonb_to_recordset(p_items) as x(id text);
  for product in select * from public.pos_products where id::text in (select x.id from jsonb_to_recordset(p_items) as x(id text)) order by id for update loop
    available_ids := available_ids + 1;
    select sum(x.quantity) as quantity into line from jsonb_to_recordset(p_items) as x(id text,quantity numeric) where x.id = product.id::text;
    if product.is_imported is true and coalesce(product.stock,0) < line.quantity then raise exception '%: không đủ tồn kho (còn %)',product.name,greatest(0,coalesce(product.stock,0)); end if;
    perform set_config('pos.event_kind','sale',true);
    update public.pos_products set stock = greatest(0,coalesce(stock,0)-line.quantity) where id = product.id;
    if not found then raise exception 'Không có quyền cập nhật tồn kho'; end if;
    perform set_config('pos.event_kind','',true);
    updated_products := updated_products || jsonb_build_array(jsonb_build_object('id',product.id,'stock',greatest(0,coalesce(product.stock,0)-line.quantity),'cost_price',product.cost_price));
  end loop;
  if available_ids <> expected_ids then raise exception 'Mặt hàng đã bị xóa hoặc không có quyền truy cập'; end if;
  insert into public.pos_transactions(code,date_time,total,method,items) values(p_code,p_date_time,p_total,p_method,p_items::text);
  return jsonb_build_object('products',updated_products);
end; $$;

revoke all on function public.pos_receive_stock_v2(text,integer,numeric,boolean,uuid) from public;
revoke all on function public.pos_void_stock_import(uuid) from public;
revoke all on function public.pos_delete_category(text) from public;
revoke all on function public.pos_checkout(text,jsonb,numeric,text,timestamptz) from public;
grant execute on function public.pos_receive_stock_v2(text,integer,numeric,boolean,uuid) to anon,authenticated;
grant execute on function public.pos_void_stock_import(uuid) to anon,authenticated;
grant execute on function public.pos_delete_category(text) to anon,authenticated;
grant execute on function public.pos_checkout(text,jsonb,numeric,text,timestamptz) to anon,authenticated;
notify pgrst, 'reload schema';
commit;
