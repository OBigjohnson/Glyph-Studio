import assert from 'node:assert/strict'
import test from 'node:test'
import blogPreview, { blogCoverImage, renderBlogPreview } from '../api/blog-preview.js'

test('blog preview metadata escapes article text and includes its cover image', () => {
  const html = renderBlogPreview({
    title: 'A <great> & useful story',
    description: 'Read "this" article & learn.',
    canonicalUrl: 'https://glyphstudio.cv/blog/brand-story',
    imageUrl: 'https://project.supabase.co/storage/v1/object/public/blog-covers/cover.jpg',
  })

  assert.match(html, /A &lt;great&gt; &amp; useful story/)
  assert.match(html, /Read &quot;this&quot; article &amp; learn\./)
  assert.match(html, /property="og:image" content="https:\/\/project\.supabase\.co\/storage\/v1\/object\/public\/blog-covers\/cover\.jpg"/)
  assert.match(html, /name="twitter:card" content="summary_large_image"/)
})

test('blog preview only uses HTTPS images from the public blog-covers bucket', () => {
  const fallback = 'https://glyphstudio.cv/assets/glyph-notes-cover.jpg'
  const supabaseUrl = 'https://project.supabase.co'

  assert.equal(blogCoverImage('https://images.example/cover.jpg', supabaseUrl, fallback), fallback)
  assert.equal(blogCoverImage('http://project.supabase.co/storage/v1/object/public/blog-covers/cover.jpg', supabaseUrl, fallback), fallback)
  assert.equal(blogCoverImage('https://project.supabase.co/storage/v1/object/public/blog-covers/cover.jpg', supabaseUrl, fallback), 'https://project.supabase.co/storage/v1/object/public/blog-covers/cover.jpg')
})

test('blog preview endpoint serves a published post cover to social crawlers', async () => {
  const env = globalThis.process.env
  const originalFetch = globalThis.fetch
  const originalValues = {
    VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY,
    VITE_SITE_URL: env.VITE_SITE_URL,
  }
  env.VITE_SUPABASE_URL = 'https://project.supabase.co'
  env.VITE_SUPABASE_ANON_KEY = 'public-test-key'
  env.VITE_SITE_URL = 'https://glyphstudio.cv'
  globalThis.fetch = async (url, options) => {
    const requestUrl = new URL(url)
    if (requestUrl.pathname.endsWith('/rpc/get_public_studio')) {
      assert.equal(options.method, 'POST')
      return {
        ok: true,
        json: async () => [{ workspace_id: 'workspace-1' }],
      }
    }
    assert.equal(requestUrl.searchParams.get('slug'), 'eq.brand-story')
    assert.equal(requestUrl.searchParams.get('workspace_id'), 'eq.workspace-1')
    assert.equal(requestUrl.searchParams.get('status'), 'eq.published')
    assert.equal(options.headers.apikey, 'public-test-key')
    return {
      ok: true,
      json: async () => [{
        title: 'Brand Story',
        slug: 'brand-story',
        excerpt: 'A story about clear brands.',
        cover_image_url: 'https://project.supabase.co/storage/v1/object/public/blog-covers/studio/brand-story.jpg',
      }],
    }
  }
  const response = {
    headers: {},
    statusCode: 0,
    setHeader(name, value) { this.headers[name] = value },
    status(value) { this.statusCode = value; return this },
    send(body) { this.body = body; return this },
  }

  try {
    await blogPreview({
      method: 'GET',
      url: '/api/blog-preview?slug=brand-story',
      headers: { host: 'glyphstudio.cv' },
      query: { slug: 'brand-story' },
    }, response)
    assert.equal(response.statusCode, 200)
    assert.match(response.body, /property="og:image" content="https:\/\/project\.supabase\.co\/storage\/v1\/object\/public\/blog-covers\/studio\/brand-story\.jpg"/)
    assert.match(response.body, /property="og:url" content="https:\/\/glyphstudio\.cv\/blog\/brand-story"/)
  } finally {
    globalThis.fetch = originalFetch
    for (const [name, value] of Object.entries(originalValues)) {
      if (value === undefined) delete env[name]
      else env[name] = value
    }
  }
})
