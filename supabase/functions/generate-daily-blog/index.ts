import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { storyBrandRules } from '../_shared/storybrand.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-job-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const topics = [
  'How to make a small business look trustworthy before its first conversation with a customer',
  'A practical way to make your business look consistent across social media and your website',
  'How to choose brand colours that feel like your business and stay easy to use',
  'What to prepare before investing in a new business website',
  'How better product photos help customers understand what they are choosing',
  'How to turn a good business idea into a clear visual identity',
  'What makes a short business video easy to watch and understand',
  'How to make your first brand identity feel professional without adding unnecessary complexity',
  'A simple checklist for deciding whether your website is clear to a first-time visitor',
  'How to make creative content that helps customers recognize and trust your brand',
  'What to include in a useful brief for a designer, photographer, or web developer',
  'How a clear brand message helps a small business stand out without making big claims',
  'How to present your business confidently when your current visuals feel inconsistent',
  'A practical guide to planning brand images that show customers what is possible',
]

const coverImages = [
  'https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1400&q=85',
  'https://images.unsplash.com/photo-1521737711867-e3b97375f902?auto=format&fit=crop&w=1400&q=85',
  'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1400&q=85',
]

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`The ${name} Supabase function secret is not set.`)
  return value
}

function slugify(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405)

  try {
    const jobSecret = requiredEnv('DAILY_BLOG_SECRET')
    if (request.headers.get('x-job-secret') !== jobSecret) {
      return response({ error: 'This scheduled job is not authorized.' }, 401)
    }

    const supabase = createClient(
      requiredEnv('SUPABASE_URL'),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { data: workspace, error: workspaceError } = await supabase
      .from('workspaces')
      .select('id, owner_id, studio_name')
      .order('created_at')
      .limit(1)
      .maybeSingle()
    if (workspaceError) throw new Error(`Could not load the studio workspace: ${workspaceError.message}`)
    if (!workspace) return response({ error: 'No studio workspace is available.' }, 404)

    const runDate = new Date().toISOString().slice(0, 10)
    const { data: existingRun, error: runReadError } = await supabase
      .from('blog_generation_runs')
      .select('id, status, blog_post_id')
      .eq('workspace_id', workspace.id)
      .eq('run_date', runDate)
      .maybeSingle()
    if (runReadError) throw new Error(`Could not check the daily blog run: ${runReadError.message}`)
    if (existingRun?.status === 'completed') {
      return response({ ok: true, skipped: true, blog_post_id: existingRun.blog_post_id })
    }
    if (existingRun?.status === 'running') {
      return response({ error: 'A daily blog draft is already being generated.' }, 409)
    }

    const runResult = existingRun
      ? await supabase.from('blog_generation_runs').update({
        status: 'running',
        error_message: '',
        completed_at: null,
      }).eq('id', existingRun.id).select('id').single()
      : await supabase.from('blog_generation_runs').insert({
        workspace_id: workspace.id,
        run_date: runDate,
      }).select('id').single()
    if (runResult.error) throw new Error(`Could not start the daily blog run: ${runResult.error.message}`)

    try {
      const dayNumber = Math.floor(Date.parse(`${runDate}T00:00:00Z`) / 86_400_000)
      const topic = topics[((dayNumber % topics.length) + topics.length) % topics.length]
      const apiKey = requiredEnv('GEMINI_API_KEY')
      const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash-lite'
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          signal: AbortSignal.timeout(45_000),
          body: JSON.stringify({
            systemInstruction: {
              parts: [{
                text: `${storyBrandRules}\n\nReturn only valid JSON with these fields: title, excerpt, body, seo_title, meta_description, keywords (array of 3-6 strings), alternates (array of exactly two strings), storybrand_angle (object with hero_desire, villain_internal_problem, success_vision), visual_direction. The article body must be 700-1,200 words with concise markdown section headings, real practical advice, one primary CTA and a P.S. Do not invent a testimonial, statistic, client, award, price, deadline, guarantee, or business outcome. Use a [PLACEHOLDER] for any missing fact. The image direction must depict the customer as the capable hero rather than a studio portrait.`,
              }],
            },
            contents: [{
              role: 'user',
              parts: [{
                text: JSON.stringify({
                  format: 'blog',
                  topic,
                  audience: 'Business owners, founders, startups, creators, coaches, churches/nonprofits, and personal brands who want to be taken seriously',
                  service: 'Brand identity, graphic design, video editing, photography, web development, app development, or motion graphics; choose only what fits the topic',
                  goal: 'Help the reader solve a real problem, then invite them to book a free discovery call',
                  studio: workspace.studio_name,
                  ctaLink: 'https://glyphstudio.cv/contact',
                  date: runDate,
                }),
              }],
            }],
            generationConfig: {
              responseMimeType: 'application/json',
              maxOutputTokens: 8192,
            },
          }),
        },
      )
      if (!geminiResponse.ok) {
        const providerError = await geminiResponse.text()
        console.error('Gemini daily blog generation failed:', geminiResponse.status, providerError.slice(0, 800))
        throw new Error('Gemini could not generate today’s blog draft.')
      }
      const generated = await geminiResponse.json()
      const generatedText = generated.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text || '')
        .join('')
      if (typeof generatedText !== 'string') throw new Error('Gemini returned no blog content.')

      let result: Record<string, unknown>
      try {
        result = JSON.parse(generatedText)
      } catch {
        throw new Error('Gemini returned unreadable blog content.')
      }
      const title = typeof result.title === 'string' ? result.title.trim() : ''
      const excerpt = typeof result.excerpt === 'string' ? result.excerpt.trim() : ''
      const body = typeof result.body === 'string' ? result.body.trim() : ''
      const seoTitle = typeof result.seo_title === 'string' ? result.seo_title.trim() : ''
      const metaDescription = typeof result.meta_description === 'string' ? result.meta_description.trim() : ''
      const keywords = Array.isArray(result.keywords)
        ? result.keywords.filter((keyword): keyword is string => typeof keyword === 'string').map((keyword) => keyword.trim()).filter(Boolean).slice(0, 6)
        : []
      const alternateHooks = Array.isArray(result.alternates)
        ? result.alternates.filter((hook): hook is string => typeof hook === 'string').map((hook) => hook.trim()).filter(Boolean).slice(0, 2)
        : []
      const rawAngle = result.storybrand_angle && typeof result.storybrand_angle === 'object'
        ? result.storybrand_angle as Record<string, unknown>
        : {}
      const storybrandAngle = {
        hero_desire: typeof rawAngle.hero_desire === 'string' ? rawAngle.hero_desire.trim() : '',
        villain_internal_problem: typeof rawAngle.villain_internal_problem === 'string' ? rawAngle.villain_internal_problem.trim() : '',
        success_vision: typeof rawAngle.success_vision === 'string' ? rawAngle.success_vision.trim() : '',
      }
      const visualDirection = typeof result.visual_direction === 'string' ? result.visual_direction.trim().slice(0, 2000) : ''
      const wordCount = body.split(/\s+/).filter(Boolean).length
      if (!title || !excerpt || !body || body.length > 30_000 || wordCount < 700 || wordCount > 1200
        || !seoTitle || !metaDescription || metaDescription.length >= 155
        || keywords.length < 3 || alternateHooks.length !== 2
        || Object.values(storybrandAngle).some((entry) => !entry) || !visualDirection) {
        throw new Error(`The generated article failed its StoryBrand output checks (${wordCount} words).`)
      }
      const slug = slugify(title)
      if (!slug) throw new Error('The generated article title could not be made into a public link.')

      const { data: post, error: postError } = await supabase.from('blog_posts').insert({
        workspace_id: workspace.id,
        created_by: workspace.owner_id,
        title: title.slice(0, 180),
        slug,
        excerpt: excerpt.slice(0, 400),
        body,
        cover_image_url: coverImages[dayNumber % coverImages.length],
        seo_title: seoTitle.slice(0, 180),
        meta_description: metaDescription.slice(0, 155),
        keywords,
        storybrand_angle: storybrandAngle,
        alternate_hooks: alternateHooks,
        visual_direction: visualDirection,
        status: 'draft',
      }).select('id').single()
      if (postError) throw new Error(`Could not save the daily blog draft: ${postError.message}`)

      const { error: runUpdateError } = await supabase.from('blog_generation_runs').update({
        status: 'completed',
        blog_post_id: post.id,
        completed_at: new Date().toISOString(),
      }).eq('id', runResult.data.id)
      if (runUpdateError) throw new Error(`Draft saved, but daily run status could not be recorded: ${runUpdateError.message}`)
      return response({ ok: true, blog_post_id: post.id, word_count: wordCount })
    } catch (generationError) {
      const message = generationError instanceof Error ? generationError.message : 'Daily blog generation failed.'
      const { error: updateError } = await supabase.from('blog_generation_runs').update({
        status: 'failed',
        error_message: message.slice(0, 1000),
      }).eq('id', runResult.data.id)
      if (updateError) console.error('Could not record daily blog generation failure:', updateError.message)
      throw generationError
    }
  } catch (error) {
    console.error('Could not generate the daily blog draft:', error)
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return response({ error: 'The daily blog generation timed out. Check the run history before retrying.' }, 504)
    }
    return response({ error: error instanceof Error ? error.message : 'Could not generate the daily blog draft.' }, 500)
  }
})
