import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://pyronites.vercel.app'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/database', '/sql-editor', '/auth', '/api-keys', '/storage', '/analytics', '/logs', '/settings', '/new-project'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
