import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'
import PwaRegistration from '@/components/pwa-registration'
import { ConfirmProvider } from '@/components/confirm-dialog'

export const metadata: Metadata = {
  title: 'Sangha.POS · Convenience & F&B',
  description: 'Hệ thống quản lý bán hàng cho cửa hàng tiện lợi và F&B.',
  applicationName:'Sanghai Overnight POS',
  manifest:'/manifest.webmanifest',
  appleWebApp:{capable:true,statusBarStyle:'default',title:'Sanghai POS'},
  formatDetection:{telephone:false},
  other:{'apple-mobile-web-app-capable':'yes'},
  icons: {
    icon:[{url:'/icon-192.png',type:'image/png',sizes:'192x192'},{url:'/icon-512.png',type:'image/png',sizes:'512x512'}],
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  width:'device-width',initialScale:1,maximumScale:1,userScalable:false,viewportFit:'cover',
  colorScheme:'light dark',themeColor:'#d97706',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="vi">
      <body className="antialiased">
        <ConfirmProvider>{children}</ConfirmProvider>
        <PwaRegistration/>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
