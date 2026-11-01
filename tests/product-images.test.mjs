import {test} from 'node:test'
import assert from 'node:assert/strict'
import {productImageSource,resizedDimensions} from '../lib/product-images.ts'
test('product image URLs accept HTTP/S and compressed raster data but reject executable sources',()=>{
 for(const source of ['https://example.com/a.png','http://example.com/a.webp','data:image/webp;base64,AAAA'])assert.equal(productImageSource(source),source)
 for(const source of ['javascript:alert(1)','data:text/html;base64,AAAA','data:image/svg+xml;base64,AAAA','https://example.com/a b','data:image/png;base64,'+'A'.repeat(1_500_000)])assert.equal(productImageSource(source),'')
})
test('product photo resize caps either dimension at 600 without enlarging small photos',()=>{
 assert.deepEqual(resizedDimensions(2400,1200),{width:600,height:300})
 assert.deepEqual(resizedDimensions(1200,2400),{width:300,height:600})
 assert.deepEqual(resizedDimensions(300,200),{width:300,height:200})
 for(const [w,h]of[[0,100],[-1,100],[Infinity,200]])assert.throws(()=>resizedDimensions(w,h))
})
