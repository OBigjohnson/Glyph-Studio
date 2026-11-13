function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

export function blogCoverImage(value, supabaseUrl, fallbackImage) {
  if (typeof value !== 'string' || !value) return fallbackImage
  try {
    const imageUrl = new URL(value)
    const storageUrl = new URL(supabaseUrl)
    if (imageUrl.protocol !== 'https:' || imageUrl.origin !== storageUrl.origin
      || !imageUrl.pathname.startsWith('/storage/v1/object/public/blog-covers/')) {
      return fallbackImage
    }
    return imageUrl.href
  } catch {
    return fallbackImage
  }
}

export function renderBlogPreview({ title, description, canonicalUrl, imageUrl }) {
  const escapedTitle = htmlEscape(title)
  const escapedDescription = htmlEscape(description)
  const escapedUrl = htmlEscape(canonicalUrl)
  const escapedImage = htmlEscape(imageUrl)
  const escapedImageAlt = htmlEscape(`Cover image for ${title}`)
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapedTitle}</title>
    <meta name="description" content="${escapedDescription}">
    <link rel="canonical" href="${escapedUrl}">
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="GLYPH Studio">
    <meta property="og:title" content="${escapedTitle}">
    <meta property="og:description" content="${escapedDescription}">
    <meta property="og:url" content="${escapedUrl}">
    <meta property="og:image" content="${escapedImage}">
    <meta property="og:image:alt" content="${escapedImageAlt}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapedTitle}">
    <meta name="twitter:description" content="${escapedDescription}">
    <meta name="twitter:image" content="${escapedImage}">
    <meta name="twitter:image:alt" content="${escapedImageAlt}">
  </head>
  <body>
    <main>
      <h1>${escapedTitle}</h1>
      <p>${escapedDescription}</p>
      <a href="${escapedUrl}">Read the full article on GLYPH Studio</a>
    </main>
  </body>
</html>`
}

export default async function blogPreview(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return response.status(405).send('Method not allowed.')
  }

  const requestUrl = new URL(request.url, `https://${request.headers.host || 'glyphstudio.cv'}`)
  const slug = typeof request.query?.slug === 'string'
    ? request.query.slug
    : requestUrl.searchParams.get('slug') || ''
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return response.status(400).send('Choose a valid blog post.')
  }

  const env = globalThis.process?.env || {}
  const supabaseUrl = env.VITE_SUPABASE_URL
  const supabaseKey = env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!supabaseUrl || !supabaseKey) {
    console.error('Blog preview requires the public Supabase URL and key in the Vercel environment.')
    return response.status(503).send('Blog previews are temporarily unavailable.')
  }

  try {
    const lookupSignal = () => AbortSignal.timeout(4000)
    const apiHeaders = {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    }
    const studioResult = await fetch(new URL('/rest/v1/rpc/get_public_studio', supabaseUrl), {
      method: 'POST',
      headers: apiHeaders,
      body: '{}',
      signal: lookupSignal(),
    })
    if (!studioResult.ok) {
      console.error('Public studio lookup for blog preview failed with status:', studioResult.status)
      return response.status(502).send('Blog previews are temporarily unavailable.')
    }
    const studios = await studioResult.json()
    const workspaceId = Array.isArray(studios) ? studios[0]?.workspace_id : studios?.workspace_id
    if (typeof workspaceId !== 'string' || !workspaceId) {
      return response.status(404).send('This blog post is not available.')
    }

    const endpoint = new URL('/rest/v1/blog_posts', supabaseUrl)
    endpoint.searchParams.set('select', 'title,slug,excerpt,cover_image_url,seo_title,meta_description')
    endpoint.searchParams.set('slug', `eq.${slug}`)
    endpoint.searchParams.set('workspace_id', `eq.${workspaceId}`)
    endpoint.searchParams.set('status', 'eq.published')
    endpoint.searchParams.set('limit', '1')
    const result = await fetch(endpoint, {
      headers: apiHeaders,
      signal: lookupSignal(),
    })
    if (!result.ok) {
      console.error('Blog preview lookup failed with status:', result.status)
      return response.status(502).send('Blog previews are temporarily unavailable.')
    }

    const posts = await result.json()
    const post = Array.isArray(posts) ? posts[0] : null
    if (!post) return response.status(404).send('This blog post is not available.')

    const configuredSiteUrl = env.VITE_SITE_URL || env.VITE_APP_URL || env.PUBLIC_APP_URL
    const siteOrigin = new URL(configuredSiteUrl || requestUrl.origin).origin
    const canonicalUrl = new URL(`/blog/${encodeURIComponent(post.slug)}`, siteOrigin).href
    const fallbackImage = new URL('/assets/glyph-notes-cover.jpg', siteOrigin).href
    const imageUrl = blogCoverImage(post.cover_image_url, supabaseUrl, fallbackImage)
    const title = `${post.seo_title || post.title} — GLYPH Studio`
    const description = post.meta_description?.trim()
      || post.excerpt?.trim()
      || 'Clear, practical ideas to help your business look professional, earn trust, and get noticed.'
    const html = renderBlogPreview({ title, description, canonicalUrl, imageUrl })
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=300')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    return response.status(200).send(request.method === 'HEAD' ? '' : html)
  } catch (error) {
    console.error('Could not render blog preview:', error)
    return response.status(502).send('Blog previews are temporarily unavailable.')
  }
}
