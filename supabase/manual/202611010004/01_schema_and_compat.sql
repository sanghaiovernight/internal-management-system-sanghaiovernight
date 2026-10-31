begin;
alter table public.pos_orders add column if not exists status text not null default 'paid';
alter table public.pos_orders add column if not exists version integer not null default 0;
alter table public.pos_orders add column if not exists updated_at timestamptz not null default now();
alter table public.pos_orders add column if not exists original_items jsonb;
alter table public.pos_orders add column if not exists original_total numeric;
alter table public.pos_orders add column if not exists original_subtotal numeric;
alter table public.pos_orders add column if not exists activity_events jsonb not null default '[]'::jsonb;
alter table public.pos_orders add column if not exists request_id uuid;
alter table public.pos_orders add column if not exists transaction_code text;
alter table public.pos_orders add column if not exists receipt_day date;
update public.pos_orders set original_items=items,original_total=total,original_subtotal=subtotal where original_items is null;
update public.pos_orders set transaction_code=receipt_no where transaction_code is null;
update public.pos_orders set receipt_day=(created_at at time zone 'Asia/Ho_Chi_Minh')::date where receipt_day is null;
alter table public.pos_orders drop constraint if exists pos_orders_receipt_no_key;
create unique index if not exists pos_orders_day_number_key on public.pos_orders(receipt_day,receipt_no);
create unique index if not exists pos_orders_transaction_key on public.pos_orders(transaction_code);
create unique index if not exists pos_orders_request_key on public.pos_orders(request_id);
alter table public.pos_transactions add column if not exists status text not null default 'paid';
drop policy if exists pos_orders_app_update on public.pos_orders;
create policy pos_orders_app_update on public.pos_orders for update to anon,authenticated using(true) with check(true);
grant update on public.pos_orders to anon,authenticated;
grant update on public.pos_transactions to anon,authenticated;
-- Existing transaction RLS must also permit refund bookkeeping.

create table if not exists public.pos_order_events (
 id uuid primary key, order_id uuid not null references public.pos_orders(id), action text not null,
 payload jsonb not null, details jsonb not null, created_at timestamptz not null default now()
);
alter table public.pos_order_events enable row level security;
drop policy if exists pos_order_events_read on public.pos_order_events;
create policy pos_order_events_read on public.pos_order_events for select to anon,authenticated using(true);
drop policy if exists pos_order_events_insert on public.pos_order_events;
create policy pos_order_events_insert on public.pos_order_events for insert to anon,authenticated with check(true);
grant select,insert on public.pos_order_events to anon,authenticated;

-- The date includes its year for uniqueness; the visible code intentionally omits it.
create or replace function public.pos_next_receipt_no(p_day date) returns text
language plpgsql security invoker set search_path='' as $$
declare n integer; code text; start_at timestamptz;
begin
 if p_day is null then raise exception 'Ngày hóa đơn không hợp lệ'; end if;
 perform pg_advisory_xact_lock(hashtextextended('receipt-day:'||p_day::text,0));
 start_at:=p_day::timestamp at time zone 'Asia/Ho_Chi_Minh';
 select count(*)+1 into n from public.pos_orders where created_at>=start_at and created_at<start_at+interval '1 day';
 loop
  code:='HD'||to_char(p_day,'DDMM')||lpad(n::text,greatest(3,length(n::text)),'0');
  exit when not exists(select 1 from public.pos_orders where receipt_day=p_day and receipt_no=code);
  n:=n+1;
 end loop;
 return code;
end; $$;
create or replace function public.pos_urlencode(p_text text) returns text
language plpgsql immutable set search_path='' as $$
declare bytes bytea:=convert_to(coalesce(p_text,''),'UTF8'); result text:=''; i integer; n integer;
begin
 for i in 0..length(bytes)-1 loop
  n:=get_byte(bytes,i);
  if n between 48 and 57 or n between 65 and 90 or n between 97 and 122 or n in(45,46,95,126) then result:=result||chr(n);
  else result:=result||'%'||upper(lpad(to_hex(n),2,'0')); end if;
 end loop;
 return result;
end; $$;
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
  insert into public.pos_orders(receipt_no,created_at,payment_method,items,subtotal,discount,total,cash_received,change_due,receipt_settings,qr_url,transaction_code)
  values(p_code,p_date_time,p_method,p_items,gross,gross-p_total,p_total,case when p_method='Tiền mặt' then received end,case when p_method='Tiền mặt' then received-p_total end,template,qr,p_code)
  on conflict(transaction_code) do nothing;
  select * into saved from public.pos_orders where transaction_code=p_code;
  if not found then raise exception 'Không có quyền đọc hóa đơn vừa lưu'; end if;
  return result || jsonb_build_object('order',to_jsonb(saved));
end; $$;

notify pgrst,'reload schema';
commit;
