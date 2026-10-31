begin;

create table if not exists public.pos_categories (
  name text primary key check (name = btrim(name) and char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);
create unique index if not exists pos_categories_name_lower_key on public.pos_categories (lower(name));
-- Seed existing labels without changing products, including custom categories.
insert into public.pos_categories (name)
select distinct btrim(category) from public.pos_products
where category is not null and char_length(btrim(category)) between 1 and 80
on conflict do nothing;

alter table public.pos_categories enable row level security;
drop policy if exists pos_categories_read on public.pos_categories;
create policy pos_categories_read on public.pos_categories for select to anon, authenticated using (true);
drop policy if exists pos_categories_create on public.pos_categories;
create policy pos_categories_create on public.pos_categories for insert to anon, authenticated with check (true);
grant select, insert on public.pos_categories to anon, authenticated;

alter table public.pos_products add column if not exists cost_price numeric;

create table if not exists public.pos_stock_receipts (
  id uuid primary key,
  product_id text not null,
  quantity integer not null check (quantity > 0),
  total numeric not null check (total >= 0),
  auto_expense boolean not null,
  stock_after numeric not null,
  cost_price numeric not null,
  received_at timestamptz not null default now()
);
alter table public.pos_stock_receipts enable row level security;
drop policy if exists pos_stock_receipts_read on public.pos_stock_receipts;
create policy pos_stock_receipts_read on public.pos_stock_receipts for select to anon, authenticated using (true);
drop policy if exists pos_stock_receipts_create on public.pos_stock_receipts;
create policy pos_stock_receipts_create on public.pos_stock_receipts for insert to anon, authenticated with check (true);
grant select, insert on public.pos_stock_receipts to anon, authenticated;

create or replace function public.pos_receive_stock(
  p_product_id text,
  p_quantity integer,
  p_total numeric,
  p_auto_expense boolean,
  p_receipt_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  product public.pos_products%rowtype;
  receipt public.pos_stock_receipts%rowtype;
  next_stock numeric;
  unit_cost numeric;
begin
  if p_quantity is null or p_quantity <= 0 or p_total is null or p_total < 0
    or p_total::text in ('NaN', 'Infinity', '-Infinity') or p_receipt_id is null or p_auto_expense is null then
    raise exception 'Số lượng hoặc tổng tiền không hợp lệ';
  end if;
  -- Lock the product first so concurrent deliveries add to the latest stock.
  select * into product from public.pos_products where id::text = p_product_id for update;
  if not found then raise exception 'Không tìm thấy sản phẩm hoặc không có quyền truy cập'; end if;
  select * into receipt from public.pos_stock_receipts where id = p_receipt_id;
  if found then
    if receipt.product_id <> p_product_id or receipt.quantity <> p_quantity or receipt.total <> p_total or receipt.auto_expense <> p_auto_expense then
      raise exception 'Mã phiếu đã được sử dụng cho nội dung khác';
    end if;
    return jsonb_build_object('stock', product.stock, 'cost_price', product.cost_price, 'receipt_id', receipt.id);
  end if;
  next_stock := coalesce(product.stock, 0) + p_quantity;
  unit_cost := p_total / p_quantity;
  update public.pos_products set stock = next_stock, cost_price = unit_cost where id = product.id;
  if not found then raise exception 'Không có quyền cập nhật sản phẩm'; end if;
  insert into public.pos_stock_receipts (id, product_id, quantity, total, auto_expense, stock_after, cost_price)
    values (p_receipt_id, p_product_id, p_quantity, p_total, p_auto_expense, next_stock, unit_cost);
  if p_auto_expense and p_total > 0 then
    insert into public.pos_expenses (id, description, amount, spent_at)
      values (p_receipt_id, 'Nhập hàng: ' || product.name || ' x ' || p_quantity::text, p_total, now());
  end if;
  return jsonb_build_object('stock', next_stock, 'cost_price', unit_cost, 'receipt_id', p_receipt_id);
end;
$$;
revoke all on function public.pos_receive_stock(text, integer, numeric, boolean, uuid) from public;
grant execute on function public.pos_receive_stock(text, integer, numeric, boolean, uuid) to anon, authenticated;

commit;
