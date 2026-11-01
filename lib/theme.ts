export const THEME_KEY='sanghai_pos_theme'
export type AppTheme='light'|'dark'
export const normalizedTheme=(value:unknown):AppTheme=>value==='dark'?'dark':'light'
export function applyTheme(theme:AppTheme){
 const root=document.documentElement
 root.classList.toggle('dark',theme==='dark');root.classList.toggle('light',theme==='light');root.style.colorScheme=theme
 const color=theme==='dark'?'#12100e':'#d97706'
 const metas=document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
 if(metas.length)metas.forEach(meta=>meta.content=color)
 else {const meta=document.createElement('meta');meta.name='theme-color';meta.content=color;document.head.appendChild(meta)}
}
// Runs before the body paints; storage failures intentionally fall back to light.
export const themeBootstrap=`(()=>{let t='light';try{if(localStorage.getItem('${THEME_KEY}')==='dark')t='dark'}catch{}const r=document.documentElement;r.classList.toggle('dark',t==='dark');r.classList.toggle('light',t==='light');r.style.colorScheme=t;let m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement('meta');m.name='theme-color';document.head.appendChild(m)}m.content=t==='dark'?'#12100e':'#d97706'})()`
