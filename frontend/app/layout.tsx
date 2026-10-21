import type { Metadata, Viewport } from 'next'
import { Archivo, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { MotionLoader } from '@/components/motion-loader'

/**
 * Fonts are self-hosted by next/font rather than pulled from the Google Fonts
 * CDN with a CSS `@import`.
 *
 * Archivo is the whole typographic voice: one variable family, two
 * personalities. Expanded 700–800 carries display and headings; 400–500
 * carries UI and body. Its `wdth` axis is the one typographic move in the
 * product — heat expands type (see DESIGN.md).
 *
 * JetBrains Mono is the data voice: every number, id, timestamp and SQL
 * statement is set in it so columns align.
 */
const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-archivo',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://pyronites.vercel.app'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'PyroCore — your backend, under your control',
    template: '%s · PyroCore',
  },
  description:
    'PyroCore is a self-hosted backend: SQLite tables, a SQL editor, API keys, file storage, users and logs, all served from one container you run yourself.',
  applicationName: 'PyroCore',
  generator: 'Next.js',
  keywords: ['self-hosted', 'backend', 'sqlite', 'rest api', 'postgrest alternative', 'docker'],
  alternates: { canonical: './' },
  openGraph: {
    type: 'website',
    siteName: 'PyroCore',
    title: 'PyroCore — your backend, under your control',
    description:
      'A self-hosted backend for SQLite tables, SQL, API keys, storage, users and logs. One container, one port, your data.',
    url: './',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'PyroCore dashboard' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PyroCore — your backend, under your control',
    description:
      'A self-hosted backend for SQLite tables, SQL, API keys, storage, users and logs. One container, one port, your data.',
    images: ['/og.png'],
  },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-dark-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: [{ color: '#0c0a09' }],
  width: 'device-width',
  initialScale: 1,
  userScalable: true,
}

/**
 * Runs before first paint: hidden-until-revealed styles only apply when JS
 * and motion are on. Without this the page flashes unrevealed content.
 */
const flags = `document.documentElement.classList.add('js');if(!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('motion')`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${jetbrainsMono.variable} dark bg-background`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: flags }} />
      </head>
      <body className="antialiased">
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div id="curtain" aria-hidden="true">
          <div className="curtain__panel" />
        </div>
        {children}
        <MotionLoader />
      </body>
    </html>
  )
}
