begin;
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


revoke all on function public.pos_checkout_order(uuid,jsonb,numeric,text,jsonb) from public;
grant execute on function public.pos_checkout_order(uuid,jsonb,numeric,text,jsonb) to anon,authenticated;

notify pgrst,'reload schema';
commit;
