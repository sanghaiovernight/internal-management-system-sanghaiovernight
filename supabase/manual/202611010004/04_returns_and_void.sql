begin;
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
