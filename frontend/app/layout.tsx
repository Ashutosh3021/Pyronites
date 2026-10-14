import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

/**
 * Fonts are self-hosted by next/font rather than pulled from the Google Fonts
 * CDN with a CSS `@import`.
 *
 * The old `@import` sat inside globals.css *after* other at-rules, which the
 * build flagged: "@import rules must precede all rules". It was also
 * render-blocking, caused a guaranteed FOUT, and added a third-party request
 * to the critical path. next/font downloads at build time, inlines the font
 * files, and emits a preloaded <link> plus a size-adjusted fallback so text
 * does not shift.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'PyroCore Dashboard',
  description: 'Self-hosted backend infrastructure',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: [{ color: '#111111' }],
  width: 'device-width',
  initialScale: 1,
  userScalable: true,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} dark bg-background`}>
      <body className="antialiased">{children}</body>
    </html>
  )
}