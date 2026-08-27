import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Press_Start_2P, Silkscreen, Noto_Sans_SC } from 'next/font/google'
import './globals.css'

// True bitmap-style pixel faces — no rounded/humanist sans anywhere in the
// UI's Latin type. Press Start 2P carries big display type (titles, seals);
// Silkscreen carries small HUD/label/mono text, since it stays legible at
// 9-11px where Press Start 2P would turn to mush.
const pixelDisplay = Press_Start_2P({ subsets: ['latin'], weight: ['400'], variable: '--font-pixel' })
const pixelMono = Silkscreen({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-retro' })
// The interface copy is Chinese (lang="zh-CN"), so a CJK-capable face has to
// back --font-display — the Latin-only stack it fell back to previously
// rendered every Chinese label as tofu boxes. Neither pixel face above covers
// CJK glyphs, so Chinese text falls through to this bold, square-cut face.
const notoSansSC = Noto_Sans_SC({ subsets: ['latin'], weight: ['400', '500', '700', '900'], variable: '--font-cjk' })

export const metadata: Metadata = {
  title: 'Project Echo // Control Panel',
  description: 'A cinematic visual language prototype for an independent game.',
  generator: 'v0.app',
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#080a0c',
  userScalable: false,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className={`dark bg-background ${pixelDisplay.variable} ${pixelMono.variable} ${notoSansSC.variable}`}>
      <body className="antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
