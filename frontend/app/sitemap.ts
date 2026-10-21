import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://pyronites.vercel.app'

/**
 * Only the public surfaces are listed. Everything else needs a session, and a
 * crawler that follows these links will be bounced to the sign-in screen.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ['/', '/login', '/terms', '/privacy']
  return paths.map((path) => ({
    url: `${SITE_URL}${path === '/' ? '' : path}`,
    changeFrequency: path === '/' ? 'weekly' : 'monthly',
    priority: path === '/' ? 1 : 0.4,
  }))
}
