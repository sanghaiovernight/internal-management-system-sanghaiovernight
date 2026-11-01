import type {MetadataRoute} from 'next'
export default function manifest():MetadataRoute.Manifest{
 return {id:'/',name:'Sanghai Overnight POS',short_name:'Sanghai POS',lang:'vi',start_url:'/',scope:'/',display:'standalone',background_color:'#faf7f2',theme_color:'#d97706',icons:[{src:'/icons/pos-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'/icons/pos-512.png',sizes:'512x512',type:'image/png',purpose:'any'},{src:'/icons/pos.svg',sizes:'any',type:'image/svg+xml',purpose:'maskable'}]}
}
