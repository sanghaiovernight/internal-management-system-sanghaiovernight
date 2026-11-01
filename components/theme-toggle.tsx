'use client'
import {Sun,Moon} from 'lucide-react'
import {useAppTheme} from './theme-provider'
export default function ThemeToggle(){
 const {theme,toggle}=useAppTheme(),dark=theme==='dark'
 return <button type="button" data-testid="theme-toggle" aria-label={dark?'Chuyển sang giao diện sáng':'Chuyển sang giao diện tối'} aria-pressed={dark} onClick={toggle} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-line bg-field px-3.5 text-sm font-semibold text-ink shadow-sm transition-colors hover:bg-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
  {dark?<Sun className="size-[18px] text-accent-ink"/>:<Moon className="size-[18px] text-accent-ink"/>}<span className="hidden min-[360px]:inline">{dark?'Sáng':'Tối'}</span>
 </button>
}
