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
    elsif event.kind = 'return' then
      replay_stock := greatest(0,replay_stock) + event.quantity;
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

create or replace function public.pos_checkout_order(p_request_id uuid,p_items jsonb,p_total numeric,p_method text,p_receipt jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved public.pos_orders%rowtype; result jsonb; code text; internal_code text; stamp timestamptz:=now();
 day date:=(now() at time zone 'Asia/Ho_Chi_Minh')::date; lines jsonb; template jsonb; qr text;
begin
 if p_request_id is null then raise exception 'Thiếu mã yêu cầu thanh toán'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into saved from public.pos_orders where request_id=p_request_id;
 if found then
  if saved.original_total<>p_total or saved.payment_method<>p_method or
   (select jsonb_agg(x.value-'line_id'-'is_imported' order by x.ordinality) from jsonb_array_elements(saved.original_items) with ordinality x(value,ordinality))<>p_items then raise exception 'Yêu cầu thanh toán đã được dùng cho giỏ khác'; end if;
  return jsonb_build_object('order',to_jsonb(saved),'products',coalesce((select jsonb_agg(jsonb_build_object('id',id,'stock',stock,'cost_price',cost_price)) from public.pos_products where id::text in(select x->>'id' from jsonb_array_elements(saved.original_items)x)),'[]'::jsonb));
 end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Giỏ hàng không hợp lệ'; end if;
 -- Keep the per-day lock until both stock and the order have committed.
 code:=public.pos_next_receipt_no(day);
 internal_code:='ORDER-'||p_request_id::text;
 select jsonb_agg(x.value||jsonb_build_object('line_id',x.ordinality::text,'is_imported',coalesce(p.is_imported,false)) order by x.ordinality)
 into lines from jsonb_array_elements(p_items) with ordinality x(value,ordinality) left join public.pos_products p on p.id::text=x.value->>'id';
 template:=coalesce(p_receipt->'settings','{}'::jsonb);
 if template->>'show_qr'='true' and btrim(coalesce(template->>'bank_name',''))<>'' and btrim(coalesce(template->>'bank_account',''))<>'' and btrim(coalesce(template->>'bank_owner',''))<>'' then
  qr:='https://img.vietqr.io/image/'||public.pos_urlencode(upper(btrim(template->>'bank_name')))||'-'||public.pos_urlencode(btrim(template->>'bank_account'))||'-compact2.png?amount='||p_total::text||'&addInfo='||public.pos_urlencode(code)||'&accountName='||public.pos_urlencode(btrim(template->>'bank_owner'));
 end if;
 result:=public.pos_checkout_receipt(internal_code,lines,p_total,p_method,stamp,coalesce(p_receipt,'{}'::jsonb)||jsonb_build_object('qr_url',qr));
 update public.pos_orders set receipt_no=code,receipt_day=day,request_id=p_request_id,original_items=lines,original_total=p_total,original_subtotal=subtotal
 where transaction_code=internal_code returning * into saved;
 if not found then raise exception 'Không có quyền lưu mã hóa đơn'; end if;
 return result||jsonb_build_object('order',to_jsonb(saved));
end; $$;

create or replace function public.pos_adjust_order(p_order_id uuid,p_action text,p_quantities jsonb,p_request_id uuid,p_expected_version integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare bill public.pos_orders%rowtype; previous public.pos_order_events%rowtype; product public.pos_products%rowtype;
 line jsonb; change jsonb; line_key text; old_qty numeric; new_qty numeric; requested jsonb;
 next_items jsonb:='[]'::jsonb; changes jsonb:='[]'::jsonb; changed boolean:=false;
 next_subtotal numeric:=0; next_total numeric; detail jsonb; result_products jsonb:='[]'::jsonb;
 payload jsonb:=jsonb_build_object('action',p_action,'quantities',p_quantities); i integer:=0; quantity numeric;
begin
 if p_request_id is null or p_action is null or p_action not in('void','refund') then raise exception 'Yêu cầu hoàn hàng không hợp lệ'; end if;
 select * into bill from public.pos_orders where id=p_order_id for update;
 if not found then raise exception 'Không tìm thấy hóa đơn'; end if;
 select * into previous from public.pos_order_events where id=p_request_id;
 if found then
  if previous.order_id<>p_order_id or previous.payload<>payload then raise exception 'Mã hoàn hàng đã dùng cho nội dung khác'; end if;
  return jsonb_build_object('order',to_jsonb(bill),'products',coalesce((select jsonb_agg(jsonb_build_object('id',id,'stock',stock,'cost_price',cost_price)) from public.pos_products where id::text in(select x->>'id' from jsonb_array_elements(coalesce(bill.original_items,bill.items))x)),'[]'::jsonb));
 end if;
 if bill.status='voided' and p_action='void' then return jsonb_build_object('order',to_jsonb(bill),'products','[]'::jsonb); end if;
 if bill.status='voided' then raise exception 'Hóa đơn đã hủy, không thể trả thêm'; end if;
 if p_expected_version is distinct from bill.version then raise exception 'Hóa đơn đã thay đổi trên máy khác. Hãy tải lại trước khi trả hàng'; end if;
 if p_action='refund' then
  if p_quantities is null or jsonb_typeof(p_quantities)<>'array' then raise exception 'Danh sách trả hàng không hợp lệ'; end if;
  if exists(select 1 from jsonb_array_elements(p_quantities)x group by x->>'line_id' having count(*)>1) then raise exception 'Dòng trả hàng bị lặp'; end if;
  for requested in select value from jsonb_array_elements(p_quantities) loop
   if not exists(select 1 from jsonb_array_elements(bill.items) with ordinality x(value,ordinality) where coalesce(x.value->>'line_id',x.ordinality::text)=requested->>'line_id') then raise exception 'Món trả hàng không có trong hóa đơn'; end if;
  end loop;
 end if;
 for line in select value from jsonb_array_elements(bill.items) loop
  i:=i+1; line_key:=coalesce(line->>'line_id',i::text); old_qty:=(line->>'quantity')::numeric;
  if old_qty is null or old_qty<0 or old_qty<>trunc(old_qty) then raise exception 'Hóa đơn cũ có số lượng không hợp lệ'; end if;
  if p_action='void' then new_qty:=0;
  else
   select x into requested from jsonb_array_elements(p_quantities)x where x->>'line_id'=line_key;
   new_qty:=case when requested is null then old_qty else (requested->>'quantity')::numeric end;
  end if;
  if new_qty is null or new_qty::text in('NaN','Infinity','-Infinity') or new_qty<0 or new_qty>old_qty or new_qty<>trunc(new_qty) then raise exception 'Chỉ được giảm số lượng trong hóa đơn'; end if;
  if new_qty<>old_qty then
   changed:=true;
   if line->>'price' is null and p_action='refund' then raise exception 'Hóa đơn cũ thiếu đơn giá, không thể tính tiền trả'; end if;
   changes:=changes||jsonb_build_array(jsonb_build_object('id',line->>'id','line_id',line_key,'name',line->>'name','quantity',old_qty-new_qty,'is_imported',line->'is_imported'));
  end if;
  next_items:=next_items||jsonb_build_array(line||jsonb_build_object('line_id',line_key,'quantity',new_qty));
  next_subtotal:=next_subtotal+coalesce((line->>'price')::numeric,0)*new_qty;
 end loop;
 if not changed and p_action='refund' then raise exception 'Chưa có số lượng nào được giảm'; end if;
 -- Lock all affected products in sorted order, then restore only retail quantities.
 for product in select * from public.pos_products where id::text in(select x->>'id' from jsonb_array_elements(changes)x) order by id for update loop
  select coalesce(sum((x->>'quantity')::numeric),0) into quantity from jsonb_array_elements(changes)x where x->>'id'=product.id::text and coalesce((x->>'is_imported')::boolean,product.is_imported,false);
  if quantity>0 then
   perform set_config('pos.event_kind','return',true);
   update public.pos_products set stock=greatest(0,coalesce(stock,0))+quantity where id=product.id;
   if not found then raise exception 'Không có quyền hoàn tồn kho'; end if;
   perform set_config('pos.event_kind','',true);
   result_products:=result_products||jsonb_build_array(jsonb_build_object('id',product.id,'stock',greatest(0,coalesce(product.stock,0))+quantity,'cost_price',product.cost_price));
  end if;
 end loop;
 for change in select value from jsonb_array_elements(changes) loop
  if (change->>'is_imported')::boolean is distinct from false and not exists(select 1 from public.pos_products where id::text=change->>'id') then raise exception 'Thiếu mặt hàng hoặc mã hàng để hoàn kho an toàn'; end if;
 end loop;
 next_total:=case when p_action='void' or coalesce(bill.original_subtotal,bill.subtotal)=0 then 0 else least(bill.total,greatest(0,round(next_subtotal*coalesce(bill.original_total,bill.total)/coalesce(bill.original_subtotal,bill.subtotal)))) end;
 detail:=jsonb_build_object('id',p_request_id,'action',p_action,'created_at',now(),'receipt_no',bill.receipt_no,'items',changes,'refund_amount',bill.total-next_total);
 update public.pos_orders set original_items=coalesce(original_items,items),original_total=coalesce(original_total,total),original_subtotal=coalesce(original_subtotal,subtotal),items=next_items,total=next_total,subtotal=next_subtotal,discount=greatest(0,next_subtotal-next_total),
  status=case when p_action='void' then 'voided' else 'refunded' end,version=version+1,updated_at=now(),activity_events=activity_events||jsonb_build_array(detail),qr_url=null
 where id=bill.id returning * into bill;
 if not found then raise exception 'Không có quyền sửa hóa đơn'; end if;
 update public.pos_transactions set items=next_items,total=bill.total,status=bill.status where code=bill.transaction_code;
 if not found then raise exception 'Không có quyền đồng bộ giao dịch'; end if;
 insert into public.pos_order_events(id,order_id,action,payload,details) values(p_request_id,bill.id,p_action,payload,detail);
 return jsonb_build_object('order',to_jsonb(bill),'products',result_products);
end; $$;
revoke all on function public.pos_checkout_order(uuid,jsonb,numeric,text,jsonb) from public;
revoke all on function public.pos_adjust_order(uuid,text,jsonb,uuid,integer) from public;
grant execute on function public.pos_checkout_order(uuid,jsonb,numeric,text,jsonb) to anon,authenticated;
grant execute on function public.pos_adjust_order(uuid,text,jsonb,uuid,integer) to anon,authenticated;
notify pgrst,'reload schema';
commit;
