import type { Product } from './product'
export const MAX_QUANTITY = 999_999_999
export const MAX_MONEY = 999_999_999_999
export const formatNumber = (value:number) => Number.isFinite(value) ? value.toLocaleString('vi-VN',{maximumFractionDigits:2}) : '—'
export type StocktakeDraft = { actual:string; unitCost:string; stock:number; cost:number; retail:boolean }
export type StocktakeLine = { product_id:string; actual_stock:number; unit_cost:number|null; expected_stock:number; expected_cost:number; expected_is_imported:boolean }
export type StocktakeSheet = {id:string;check_no:string;created_at:string;total_increase:number;total_decrease:number;lines:{product_id:string;name:string;stock_before:number;stock_after:number;cost_before:number;cost_after:number;delta:number;unit_cost:number|null;is_imported:boolean}[]}
export function stocktakePlan(products:Product[], drafts:Record<string,StocktakeDraft>) {
  const lines:StocktakeLine[]=[];const errors:string[]=[];let increase=0,decrease=0,changedCount=0
  for(const [id,draft] of Object.entries(drafts).sort(([a],[b])=>a.localeCompare(b))) {
    if(draft.actual.trim()==='')continue
    const product=products.find((item)=>item.id===id)
    if(!product){errors.push('Một mặt hàng đang kiểm đã bị xóa. Hãy bỏ dòng đó và tải lại.');continue}
    if(!/^\d+$/.test(draft.actual)||!Number.isSafeInteger(Number(draft.actual))||Number(draft.actual)>MAX_QUANTITY){errors.push(`${product.name}: tồn thực tế tối đa ${formatNumber(MAX_QUANTITY)}.`);continue}
    if(!Number.isFinite(draft.stock)||!Number.isFinite(draft.cost)||Math.abs(draft.stock)>Number.MAX_SAFE_INTEGER||draft.cost<0||draft.cost>Number.MAX_SAFE_INTEGER){errors.push(`${product.name}: tồn hoặc giá vốn hiện tại không hợp lệ.`);continue}
    const actual=Number(draft.actual),delta=actual-draft.stock
    if(delta===0)continue
    changedCount++;if(delta>0)increase+=delta;else decrease-=delta
    if((product.stock??0)!==draft.stock||(product.costPrice??0)!==draft.cost||(product.is_imported===true)!==draft.retail){errors.push(`${product.name}: tồn kho, giá vốn hoặc loại hàng đã đổi. Xóa ô tồn thực tế để lấy dữ liệu mới.`);continue}
    let unitCost:number|null=null
    if(delta>0&&draft.retail){
      if(!/^\d+$/.test(draft.unitCost)||!Number.isSafeInteger(Number(draft.unitCost))||Number(draft.unitCost)>MAX_MONEY){errors.push(`${product.name}: bắt buộc nhập giá vốn phần tăng, từ 0 đến ${formatNumber(MAX_MONEY)}đ.`);continue}
      unitCost=Number(draft.unitCost)
    }
    lines.push({product_id:id,actual_stock:actual,unit_cost:unitCost,expected_stock:draft.stock,expected_cost:draft.cost,expected_is_imported:draft.retail})
  }
  return {lines,errors,increase,decrease,changedCount}
}
