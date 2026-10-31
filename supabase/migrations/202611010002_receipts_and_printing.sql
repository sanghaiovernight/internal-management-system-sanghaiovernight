begin;
create table if not exists public.pos_receipt_settings (
  id text primary key default 'default' check(id='default'),
  store_name text not null default 'SangHai Overnight', subtitle text not null default 'Convenience & F&B',
  address text not null default '', phone text not null default '', wifi_name text not null default '', wifi_password text not null default '',
  footer text not null default 'Cảm ơn quý khách. Hẹn gặp lại!', paper_width integer not null default 80 check(paper_width in(58,80)),
  show_qr boolean not null default false, auto_print boolean not null default false
);
insert into public.pos_receipt_settings(id) values('default') on conflict do nothing;
alter table public.pos_receipt_settings enable row level security;
drop policy if exists receipt_settings_read on public.pos_receipt_settings;
create policy receipt_settings_read on public.pos_receipt_settings for select to anon,authenticated using(true);
drop policy if exists receipt_settings_insert on public.pos_receipt_settings;
create policy receipt_settings_insert on public.pos_receipt_settings for insert to anon,authenticated with check(id='default');
drop policy if exists receipt_settings_update on public.pos_receipt_settings;
create policy receipt_settings_update on public.pos_receipt_settings for update to anon,authenticated using(id='default') with check(id='default');
grant select,insert,update on public.pos_receipt_settings to anon,authenticated;

create table if not exists public.pos_orders (
  id uuid primary key default gen_random_uuid(), receipt_no text not null unique, created_at timestamptz not null default now(),
  payment_method text not null, items jsonb not null check(jsonb_typeof(items)='array'),
  subtotal numeric not null check(subtotal>=0), discount numeric not null default 0 check(discount>=0), total numeric not null check(total>=0),
  cash_received numeric, change_due numeric, receipt_settings jsonb, qr_url text
);
create index if not exists pos_orders_created_idx on public.pos_orders(created_at desc,id desc);
alter table public.pos_orders enable row level security;
drop policy if exists pos_orders_read on public.pos_orders;
create policy pos_orders_read on public.pos_orders for select to anon,authenticated using(true);
drop policy if exists pos_orders_insert on public.pos_orders;
create policy pos_orders_insert on public.pos_orders for insert to anon,authenticated with check(true);
grant select,insert on public.pos_orders to anon,authenticated;

-- Historical text that is not JSON remains a readable line, without inventing a unit price.
create or replace function public.pos_receipt_items(p_items text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare parsed jsonb;
begin
  begin parsed:=p_items::jsonb; exception when invalid_text_representation then parsed:=null; end;
  if jsonb_typeof(parsed)='array' then return parsed; end if;
  if p_items is null or p_items='' then return '[]'::jsonb; end if;
  return jsonb_build_array(jsonb_build_object('name',p_items,'quantity',1,'price',null));
end; $$;
insert into public.pos_orders(receipt_no,created_at,payment_method,items,subtotal,total)
select code,date_time,method,public.pos_receipt_items(items::text),total,total from public.pos_transactions
where total>=0 on conflict(receipt_no) do nothing;

-- Receipt persistence participates in the same transaction as the existing locked checkout.
create or replace function public.pos_checkout_receipt(p_code text,p_items jsonb,p_total numeric,p_method text,p_date_time timestamptz,p_receipt jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; saved public.pos_orders%rowtype; gross numeric; received numeric; template jsonb; qr text;
begin
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Giỏ hàng không hợp lệ'; end if;
  select sum(x.price*x.quantity) into gross from jsonb_to_recordset(p_items) as x(price numeric,quantity numeric);
  received:=nullif(p_receipt->>'cash_received','')::numeric;
  if p_method='Tiền mặt' and (received is null or received<p_total or received::text in('NaN','Infinity','-Infinity')) then raise exception 'Tiền khách đưa chưa đủ hoặc không hợp lệ'; end if;
  template:=coalesce(p_receipt->'settings','{}'::jsonb);
  if jsonb_typeof(template)<>'object' or coalesce(template->>'paper_width','80') not in('58','80') then raise exception 'Mẫu in không hợp lệ'; end if;
  qr:=p_receipt->>'qr_url';
  if qr is not null and qr not like 'https://img.vietqr.io/image/%' then raise exception 'Địa chỉ QR không hợp lệ'; end if;
  result:=public.pos_checkout(p_code,p_items,p_total,p_method,p_date_time);
  insert into public.pos_orders(receipt_no,created_at,payment_method,items,subtotal,discount,total,cash_received,change_due,receipt_settings,qr_url)
  values(p_code,p_date_time,p_method,p_items,gross,gross-p_total,p_total,case when p_method='Tiền mặt' then received end,case when p_method='Tiền mặt' then received-p_total end,template,qr)
  on conflict(receipt_no) do nothing;
  select * into saved from public.pos_orders where receipt_no=p_code;
  if not found then raise exception 'Không có quyền đọc hóa đơn vừa lưu'; end if;
  return result || jsonb_build_object('order',to_jsonb(saved));
end; $$;
revoke all on function public.pos_checkout_receipt(text,jsonb,numeric,text,timestamptz,jsonb) from public;
grant execute on function public.pos_checkout_receipt(text,jsonb,numeric,text,timestamptz,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
