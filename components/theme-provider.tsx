'use client'
import {createContext,useContext,useLayoutEffect,useMemo,useRef,useState} from 'react'
import {applyTheme,normalizedTheme,THEME_KEY,type AppTheme} from '@/lib/theme'
const ThemeContext=createContext<{theme:AppTheme;toggle:()=>void}>({theme:'light',toggle:()=>{}})
export const useAppTheme=()=>useContext(ThemeContext)
export default function ThemeProvider({children}:{children:React.ReactNode}){
 const [theme,setTheme]=useState<AppTheme>('light')
 const current=useRef<AppTheme>('light')
 useLayoutEffect(()=>{
  const initial=document.documentElement.classList.contains('dark')?'dark':'light'
  current.current=initial;setTheme(initial);applyTheme(initial)
  const observer=new MutationObserver(records=>{if(records.some(record=>Array.from(record.addedNodes).some(node=>node instanceof HTMLMetaElement&&node.name==='theme-color')))applyTheme(current.current)})
  observer.observe(document.head,{childList:true,subtree:true})
  const storage=(event:StorageEvent)=>{if(event.key===THEME_KEY||event.key===null){const next=normalizedTheme(event.newValue);current.current=next;applyTheme(next);setTheme(next)}}
  window.addEventListener('storage',storage);return()=>{observer.disconnect();window.removeEventListener('storage',storage)}
 },[])
 const value=useMemo(()=>({theme,toggle:()=>{const next=theme==='dark'?'light':'dark';current.current=next;applyTheme(next);setTheme(next);try{localStorage.setItem(THEME_KEY,next)}catch{}}}),[theme])
 return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
