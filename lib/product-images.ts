export const MAX_IMAGE_EDGE = 600
export const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024
export function productImageSource(value: string): string {
  const source=value.trim()
  if(/^https?:\/\/[^\s]+$/i.test(source))return source
  if(/^data:image\/(?:webp|png|jpeg|gif|avif);base64,[a-zA-Z0-9+/=]+$/.test(source)&&source.length<=1_500_000)return source
  return ''
}
export function resizedDimensions(width:number,height:number){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('Ảnh không hợp lệ.')
  const scale=Math.min(1,MAX_IMAGE_EDGE/Math.max(width,height))
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))}
}
export async function compressProductImage(file:File):Promise<Blob>{
  if(!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type))throw new Error('Chọn ảnh JPG, PNG, WebP, GIF hoặc AVIF.')
  if(file.size>MAX_IMAGE_FILE_BYTES)throw new Error('Ảnh gốc tối đa 20 MB.')
  const bitmap=await createImageBitmap(file).catch(()=>{throw new Error('Không đọc được ảnh. Hãy chọn một ảnh khác.')})
  try {
    const canvas=document.createElement('canvas'),size=resizedDimensions(bitmap.width,bitmap.height)
    canvas.width=size.width;canvas.height=size.height
    const context=canvas.getContext('2d');if(!context)throw new Error('Trình duyệt không hỗ trợ xử lý ảnh.')
    context.drawImage(bitmap,0,0,size.width,size.height)
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(result=>result?resolve(result):reject(new Error('Không nén được ảnh.')),'image/webp',0.8))
    if(blob.size>1048576)throw new Error('Ảnh sau nén vẫn quá lớn. Hãy chọn ảnh khác.')
    return blob
  }finally{bitmap.close()}
}
export const imageDataUrl=(blob:Blob)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Không đọc được ảnh nén.'));reader.readAsDataURL(blob)})
