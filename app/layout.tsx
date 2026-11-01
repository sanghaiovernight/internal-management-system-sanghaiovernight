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
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/icons/apple-touch-icon.png',
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
