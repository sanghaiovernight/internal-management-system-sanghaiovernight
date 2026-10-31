import {test} from 'node:test'
import assert from 'node:assert/strict'
import {stocktakePlan,formatNumber,MAX_QUANTITY,MAX_MONEY} from '../lib/stocktake.ts'
const product={id:'p',name:'Cà phê',stock:10,costPrice:6000,is_imported:true}
const draft={actual:'15',unitCost:'9000',stock:10,cost:6000,retail:true}
test('blank and identical stocktake rows produce no writes; explicit zero means complete loss',()=>{
 for(const actual of ['', '10'])assert.equal(stocktakePlan([product],{p:{...draft,actual}}).lines.length,0)
 const plan=stocktakePlan([product],{p:{...draft,actual:'0',unitCost:''}})
 assert.equal(plan.decrease,10);assert.equal(plan.lines[0].unit_cost,null)
})
test('surplus cost is mandatory for retail, including zero as an explicit valid price',()=>{
 const missing=stocktakePlan([product],{p:{...draft,unitCost:''}})
 assert.equal(missing.lines.length,0);assert.equal(missing.errors.length,1);assert.equal(missing.increase,5)
 assert.equal(stocktakePlan([product],{p:{...draft,unitCost:'0'}}).lines[0].unit_cost,0)
 const prepared=stocktakePlan([{...product,is_imported:false}],{p:{...draft,retail:false,unitCost:''}})
 assert.equal(prepared.lines[0].unit_cost,null)
})
test('stocktake rejects invalid and excessive quantities and costs, stale baselines and removed products',()=>{
 for(const actual of ['-1','1e9','1.5',String(MAX_QUANTITY+1)])assert.equal(stocktakePlan([product],{p:{...draft,actual}}).errors.length,1)
 for(const unitCost of ['-1','1e9','1.5',String(MAX_MONEY+1)])assert.equal(stocktakePlan([product],{p:{...draft,unitCost}}).errors.length,1)
 for(const changed of [{stock:11},{costPrice:7000},{is_imported:false}])assert.match(stocktakePlan([{...product,...changed}],{p:draft}).errors[0],/đã đổi/)
 assert.equal(stocktakePlan([],{p:draft}).errors.length,1)
})
test('stocktake uses all drafted products and separates gains and losses with Vietnamese grouping',()=>{
 const other={...product,id:'b',name:'Bạc xỉu',stock:5}
 const plan=stocktakePlan([product,other],{p:draft,b:{...draft,stock:5,actual:'2'}})
 assert.equal(plan.increase,5);assert.equal(plan.decrease,3);assert.equal(plan.changedCount,2)
 assert.equal(formatNumber(8161616),'8.161.616');assert.equal(formatNumber(Infinity),'—')
})
