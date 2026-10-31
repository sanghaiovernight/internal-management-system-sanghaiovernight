begin;
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


notify pgrst,'reload schema';
commit;
