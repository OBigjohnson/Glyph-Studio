import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { storyBrandRules } from '../_shared/storybrand.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405)

  try {
    const token = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!token) return response({ error: 'Sign in to generate brand content.' }, 401)

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return response({ error: 'Request body must be valid JSON.' }, 400)
    }

    const format = body.format
    const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
    const audience = typeof body.audience === 'string' ? body.audience.trim() : ''
    const service = typeof body.service === 'string' ? body.service.trim() : ''
    const goal = typeof body.goal === 'string' ? body.goal.trim() : ''
    const extraContext = typeof body.extra_context === 'string' ? body.extra_context.trim() : ''
    const emailType = body.email_type === 'offer' ? 'offer' : 'nurture'
    let ctaLink = ''
    try {
      const parsed = new URL(typeof body.cta_link === 'string' ? body.cta_link : '')
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error()
      ctaLink = parsed.toString()
    } catch {
      return response({ error: 'Enter a valid website link for the call to action.' }, 400)
    }
    if (format !== 'blog' && format !== 'email') {
      return response({ error: 'Choose blog or email as the content format.' }, 400)
    }
    if (format === 'email' && body.email_type !== 'offer' && body.email_type !== 'nurture') {
      return response({ error: 'Choose a nurturing or offer email.' }, 400)
    }
    if (!topic || topic.length > 500 || !audience || audience.length > 300
      || !goal || goal.length > 300 || service.length > 200 || extraContext.length > 1000) {
      return response({ error: 'Complete the topic, audience, and goal fields using the allowed lengths.' }, 400)
    }

    const supabase = createClient(
      requiredEnv('SUPABASE_URL'),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { data: authData, error: authError } = await supabase.auth.getUser(token)
    if (authError || !authData.user) return response({ error: 'Your session is invalid. Sign in again.' }, 401)

    const { data: membership, error: membershipError } = await supabase
      .from('members')
      .select('workspace_id, role, workspaces!inner(studio_name)')
      .eq('user_id', authData.user.id)
      .eq('role', 'owner')
      .maybeSingle()
    if (membershipError) throw new Error(`Could not verify studio access: ${membershipError.message}`)
    if (!membership?.workspace_id) return response({ error: 'No studio workspace is available for this account.' }, 403)
    const workspace = Array.isArray(membership.workspaces) ? membership.workspaces[0] : membership.workspaces
    if (!workspace?.studio_name) return response({ error: 'The studio workspace could not be loaded.' }, 403)

    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash-lite'
    const prompt = format === 'blog'
      ? `Write one original, useful blog article for ${workspace.studio_name}. The final article body must be 700-1,200 words, with a clear title, scannable short sections, practical advice, a specific customer success picture, light stakes, and a concise CTA. Do not include an invented testimonial, statistic, client, award, price, deadline, or result. Use [PLACEHOLDER] for any missing fact. Include an SEO title, a meta description under 155 characters, 3-6 suggested keywords, exactly two alternate hooks/titles, a 3-line SB7 angle (hero_desire, villain_internal_problem, success_vision), and an image direction showing the customer as the capable hero (not a studio team portrait). Add a short excerpt. CTA link: ${ctaLink}. Include a P.S. that reinforces the same primary CTA.`
      : `Write one ${emailType === 'offer' ? 'offer' : 'nurturing'} email for ${workspace.studio_name}. ${emailType === 'offer' ? 'Use 150-250 words. State a real reason to act now only if one is supplied; never invent scarcity or a deadline.' : 'Lead with value and use 120-200 words, with no hard sell.'} Include one subject line under 50 characters, exactly two alternate subject lines under 50 characters, a concise preview text, a customer-centered body with one clear CTA, and a sign-off with the exact brand one-liner. Do not invent a free resource, testimonial, statistic, client, award, price, deadline, result, or guarantee. CTA link: ${ctaLink}.`
    const apiKey = requiredEnv('GEMINI_API_KEY')
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: `${storyBrandRules}\n\nReturn only valid JSON with these fields: title, excerpt, body, seo_title, meta_description, keywords (array of strings), alternates (array of exactly two strings), preview_text, storybrand_angle (object with hero_desire, villain_internal_problem, success_vision), visual_direction. Use empty strings or an empty array for fields not relevant to the selected format.` }],
          },
          contents: [{
            role: 'user',
            parts: [{
              text: JSON.stringify({
                format,
                emailType: format === 'email' ? emailType : null,
                topic,
                audience,
                service: service || 'Choose only a relevant Glyph Studio service',
                goal,
                extraContext,
                studio: workspace.studio_name,
                ctaLink,
                instructions: prompt,
              }),
            }],
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: format === 'blog' ? 8192 : 4096,
          },
        }),
      },
    )
    if (!geminiResponse.ok) {
      const providerError = await geminiResponse.text()
      console.error('Gemini editorial generation failed:', geminiResponse.status, providerError.slice(0, 1000))
      return response({ error: 'Gemini could not generate this draft. Check the Gemini key and try again.' }, 502)
    }
    const generated = await geminiResponse.json()
    const generatedText = generated.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text || '')
      .join('')
    if (typeof generatedText !== 'string') {
      console.error('Gemini returned no editorial content.')
      return response({ error: 'Gemini returned an empty response. Please try again.' }, 502)
    }

    let result: Record<string, unknown>
    try {
      result = JSON.parse(generatedText)
    } catch {
      console.error('Gemini returned invalid editorial JSON.')
      return response({ error: 'Gemini returned an unreadable response. Please try again.' }, 502)
    }
    const title = typeof result.title === 'string' ? result.title.trim() : ''
    const excerpt = typeof result.excerpt === 'string' ? result.excerpt.trim() : ''
    const content = typeof result.body === 'string' ? result.body.trim() : ''
    const alternates = Array.isArray(result.alternates)
      ? result.alternates.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean).slice(0, 2)
      : []
    const angle = result.storybrand_angle && typeof result.storybrand_angle === 'object'
      ? result.storybrand_angle as Record<string, unknown>
      : {}
    const storybrandAngle = {
      hero_desire: typeof angle.hero_desire === 'string' ? angle.hero_desire.trim() : '',
      villain_internal_problem: typeof angle.villain_internal_problem === 'string' ? angle.villain_internal_problem.trim() : '',
      success_vision: typeof angle.success_vision === 'string' ? angle.success_vision.trim() : '',
    }
    const wordCount = content.split(/\s+/).filter(Boolean).length
    const invalidLength = format === 'blog'
      ? wordCount < 700 || wordCount > 1200 || content.length > 30000
      : wordCount < (emailType === 'offer' ? 150 : 120) || wordCount > (emailType === 'offer' ? 250 : 200)
    const seoTitle = typeof result.seo_title === 'string' ? result.seo_title.trim() : ''
    const metaDescription = typeof result.meta_description === 'string' ? result.meta_description.trim() : ''
    const previewText = typeof result.preview_text === 'string' ? result.preview_text.trim() : ''
    const emailFieldsValid = format === 'blog'
      || (title.length < 50 && previewText.length > 0 && alternates.every((entry) => entry.length < 50))
    const keywords = Array.isArray(result.keywords)
      ? result.keywords.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean).slice(0, 6)
      : []
    if (!title || !content || invalidLength || alternates.length !== 2
      || Object.values(storybrandAngle).some((entry) => !entry)
      || !emailFieldsValid
      || (format === 'blog' && (!excerpt || !seoTitle || !metaDescription || metaDescription.length >= 155 || keywords.length < 3))
      || (format === 'email' && alternates.some((entry) => entry.length >= 50))) {
      console.error('Gemini editorial draft failed output checks:', { format, wordCount, title: Boolean(title), alternates: alternates.length })
      return response({
        error: format === 'blog'
          ? 'The generated article did not meet the required 700-1,200 word length or include all StoryBrand fields. Please generate again.'
          : `The generated ${emailType} email did not meet its required ${emailType === 'offer' ? '150-250' : '120-200'} word length or include all StoryBrand fields. Please generate again.`,
      }, 502)
    }
    return response({
      format,
      email_type: emailType,
      title: title.slice(0, format === 'email' ? 50 : 180),
      excerpt: excerpt.slice(0, 400),
      body: content,
      seo_title: seoTitle.slice(0, 180),
      meta_description: metaDescription.slice(0, 155),
      keywords,
      alternates,
      preview_text: previewText.slice(0, 200),
      storybrand_angle: storybrandAngle,
      visual_direction: typeof result.visual_direction === 'string' ? result.visual_direction.trim().slice(0, 1000) : '',
    })
  } catch (error) {
    console.error('Could not generate StoryBrand content:', error)
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return response({ error: 'Gemini took too long to respond. Please try again.' }, 504)
    }
    return response({ error: error instanceof Error ? error.message : 'Could not generate StoryBrand content.' }, 500)
  }
})
