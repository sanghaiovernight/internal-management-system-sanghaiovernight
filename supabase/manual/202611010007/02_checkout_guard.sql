begin;
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
    if product.product_type='ingredient' then raise exception '%: nguyên liệu không được bán trên POS',product.name; end if;
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
  insert into public.pos_transactions(code,date_time,total,method,items) values(p_code,p_date_time,p_total,p_method,p_items);
  return jsonb_build_object('products',updated_products);
end; $$;

notify pgrst,'reload schema';
commit;
